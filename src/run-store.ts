import { randomUUID } from "node:crypto";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import stateSchema from "../schemas/state.schema.json";
import { readJson, writeJsonAtomic } from "./files.js";
import type { TaskMetadata } from "./evidence.js";

export type RunStatus =
  | "collecting"
  | "prepared"
  | "compiling"
  | "compiled"
  | "approved"
  | "implementing"
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
  failurePhase?: "collect" | "compile" | "implement" | "resume" | null;
  activeOperation?: "collect" | "compile" | "implement" | "resume" | null;
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
  try {
    await access(runDir);
    throw new Error(`Run already exists: ${runId}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Run already exists:")) throw error;
  }
  await mkdir(runDir, { recursive: true, mode: 0o700 });
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
  const value = await readJson<unknown>(join(runDir, "state.json"));
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
}
