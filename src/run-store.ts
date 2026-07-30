import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import stateSchema from "../schemas/state.schema.json";
import { readJson, writeJsonAtomic } from "./files.js";
import { appendRunHistoryEntry, type RunHistoryEntry } from "./registry.js";
import type { TaskMetadata } from "./evidence.js";
import type { CodexAuthStore, CodexHomeMode } from "./codex-environment.js";

export type RunStatus =
  | "collecting"
  | "prepared"
  | "compiling"
  | "compiled"
  | "approved"
  | "implementing"
  | "researching"
  | "verifying"
  | "completed"
  | "needs-decision"
  | "blocked"
  | "failed";

export interface RunState {
  schemaVersion: 1;
  runId: string;
  status: RunStatus;
  objective: string;
  repoRoot: string;
  baseCommit: string;
  transcriptPath: string;
  transcriptSessionId: string | null;
  transcriptResolutionMethod: string;
  createdAt: string;
  updatedAt: string;
  compilerModel: string | null;
  compilerSessionId: string | null;
  implementationModel: string | null;
  implementationSessionId: string | null;
  latestResult: string | null;
  failure: string | null;
  failurePhase?: "collect" | "compile" | "implement" | "resume" | "research" | "follow-up" | "iterate" | "verify" | null;
  activeOperation?: "collect" | "compile" | "implement" | "resume" | "research" | "follow-up" | "iterate" | "verify" | null;
  controllerPid?: number | null;
  attempts?: { collect: number; compile: number; implement: number; resume: number };
  approvedWorktreeSha256?: string | null;
  lastWorktreeSha256?: string | null;
  contextRequestPath?: string | null;
  evidenceBundlePath?: string | null;
  evidenceBundleSha256?: string | null;
  projectProfilePath?: string | null;
  taskMetadata?: TaskMetadata;
  approvalCount?: number;
  evaluationCount?: number;
  latestCheckpointPath?: string | null;
  observationVersion?: 1;
  delegatorVersion?: string;
  delegatorRevision?: string | null;
  delegatorDirty?: boolean | null;
  delegatorArtifactSha256?: string | null;
  delegationPattern?: "implementation" | "research" | "interactive" | "autonomous";
  experimentVariant?: string | null;
  researchModel?: string | null;
  researchSessionId?: string | null;
  researchTurnCount?: number;
  iterationCount?: number;
  autonomousStopReason?: "converged" | "needs-decision" | "blocked" | "turn-limit" | "time-limit" | "checkpoint-error" | null;
  codexHomeMode?: CodexHomeMode;
  codexHome?: string | null;
  codexAuthStore?: CodexAuthStore;
  verificationModel?: string | null;
  verificationSessionId?: string | null;
  verificationCount?: number;
  latestVerificationPath?: string | null;
  verificationStatus?: "passed" | "failed" | "partial" | "not-run" | null;
  verificationFailure?: string | null;
}

export function observedRunModels(state: RunState): {
  compiler: string | null;
  implementation: string | null;
  research: string | null;
  verification?: string | null;
} {
  return {
    compiler: (state.attempts?.compile ?? 0) > 0 ? state.compilerModel ?? "codex-default" : null,
    implementation: (state.attempts?.implement ?? 0) + (state.attempts?.resume ?? 0) +
        (state.iterationCount ?? 0) > 0
      ? state.implementationModel ?? "codex-default"
      : null,
    research: (state.researchTurnCount ?? 0) > 0 ? state.researchModel ?? "codex-default" : null,
    ...((state.verificationCount ?? 0) > 0
      ? { verification: state.verificationModel ?? "codex-default" }
      : {}),
  };
}

const validateRunStateSchema = new Ajv2020({ allErrors: true, formats: { "date-time": true } })
  .compile<RunState>(stateSchema);

export function makeRunId(now = new Date()): string {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${timestamp}-${randomUUID().slice(0, 8)}`;
}

export async function createRunDirectory(runsDir: string, runId: string): Promise<string> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId) || runId === "." || runId === "..") {
    throw new Error("--run-id must be 1-128 safe filename characters (letters, digits, dot, underscore, or hyphen)");
  }
  const root = resolve(runsDir);
  const runDir = resolve(root, runId);
  const fromRoot = relative(root, runDir);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Run directory escapes --runs-dir: ${runId}`);
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  try {
    await mkdir(runDir, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") throw new Error(`Run already exists: ${runId}`);
    throw error;
  }
  await chmod(runDir, 0o700);
  await ensureRunsRootIgnored(root);
  return runDir;
}

// Run artifacts must stay untracked in the target repository; otherwise every approve/implement
// write enters the worktree fingerprint and invalidates the approval gate it protects.
async function ensureRunsRootIgnored(root: string): Promise<void> {
  try {
    await writeFile(join(root, ".gitignore"), "*\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
  }
}

export function resolveRunDirectory(runsDir: string, run: string): string {
  return isAbsolute(run) || run.includes("/") ? resolve(run) : join(resolve(runsDir), basename(run));
}

export async function readRunState(runDir: string): Promise<RunState> {
  let value: unknown;
  try {
    value = await readJson<unknown>(join(runDir, "state.json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new Error(`Run not found: no state.json under ${runDir}; check --run and --runs-dir`);
    }
    throw error;
  }
  if (!validateRunStateSchema(value)) {
    const details = (validateRunStateSchema.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
      .join("; ");
    throw new Error(`state.json does not match the supported run-state schema: ${details}`);
  }
  return value;
}

export async function writeRunState(runDir: string, state: RunState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await writeJsonAtomic(join(runDir, "state.json"), state);
  if (state.observationVersion !== 1) return;
  const evaluation = await historyEvaluation(runDir);
  await appendRunHistoryEntry({
    run_id: state.runId,
    run_dir: resolve(runDir),
    repo_root: state.repoRoot,
    objective: state.objective,
    status: state.status,
    created_at: state.createdAt,
    updated_at: state.updatedAt,
    delegation_pattern: state.delegationPattern ?? "implementation",
    experiment_variant: state.experimentVariant ?? null,
    task_metadata: state.taskMetadata ?? { task_type: "other", complexity: "unknown", tags: [] },
    models: observedRunModels(state),
    attempts: {
      collect: state.attempts?.collect ?? 0,
      compile: state.attempts?.compile ?? 0,
      implement: state.attempts?.implement ?? 0,
      resume: state.attempts?.resume ?? 0,
      research_turns: state.researchTurnCount ?? 0,
      iteration_turns: state.iterationCount ?? 0,
      ...((state.verificationCount ?? 0) > 0 ? { verification_calls: state.verificationCount } : {}),
    },
    failure: state.failure,
    salvaged: state.status === "failed" && Boolean(
      evaluation && ["accepted-as-is", "accepted-with-changes"].includes(evaluation.outcome),
    ),
    autonomous_stop_reason: state.autonomousStopReason ?? null,
    codex_environment: {
      mode: state.codexHomeMode ?? "shared",
      auth_store: state.codexAuthStore ?? "auto",
    },
    evaluation,
  });
}

async function historyEvaluation(runDir: string): Promise<RunHistoryEntryEvaluation | null> {
  let value: unknown;
  try {
    value = await readJson<unknown>(join(runDir, "evaluation.json"));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const ratings = record.ratings;
  if (!ratings || typeof ratings !== "object") return null;
  return {
    recorded_at: String(record.recorded_at ?? ""),
    outcome: String(record.outcome ?? ""),
    brief_quality: String(record.brief_quality ?? ""),
    implementation_quality: String(record.implementation_quality ?? ""),
    communication_quality: String(record.communication_quality ?? ""),
    verification: String(record.verification ?? ""),
    ratings: Object.fromEntries(
      Object.entries(ratings).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
    ),
    issue_categories: Array.isArray(record.issue_categories)
      ? record.issue_categories.filter((item): item is string => typeof item === "string")
      : [],
    tags: Array.isArray(record.tags) ? record.tags.filter((item): item is string => typeof item === "string") : [],
  };
}

type RunHistoryEntryEvaluation = NonNullable<RunHistoryEntry["evaluation"]>;
