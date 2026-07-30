import { randomUUID } from "node:crypto";
import { access, open, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import evaluationInputSchema from "../schemas/evaluation-input.schema.json";
import evaluationSchema from "../schemas/evaluation.schema.json";
import runEventSchema from "../schemas/run-event.schema.json";
import type { BriefDraft } from "./brief.js";
import type { CodexUsage } from "./codex.js";
import { validateEvidenceBundle, type EvidenceBundle, type TaskMetadata } from "./evidence.js";
import { appendLine, appendText, readJson, sha256File, writeJson, writeText, writeTextAtomic } from "./files.js";
import { worktreeObservation } from "./repository.js";
import { observedRunModels, readRunState, type RunState, type RunStatus } from "./run-store.js";

export type ObservationStage = "collect" | "compile" | "approve" | "implement" | "resume" | "research" | "follow-up" | "iterate" | "evaluate" | "status";
export type FailureCategory = "configuration" | "collection" | "validation" | "integrity" | "repository-drift" | "codex-spawn" | "codex-timeout" | "codex-exit" | "interrupted" | "unknown";

export interface RunEvent {
  schema_version: "1";
  id: string;
  at: string;
  stage: ObservationStage;
  event: "started" | "completed" | "failed" | "recovered";
  attempt: number | null;
  duration_ms: number | null;
  model: string | null;
  run_status: string;
  failure_category: FailureCategory | null;
  message: string | null;
  usage: CodexUsage | null;
  metrics: {
    source_count?: number;
    source_bytes?: number;
    excluded_source_count?: number;
    unresolved_item_count?: number;
    citation_count?: number;
    citation_source_correction_count?: number;
    citation_turn_correction_count?: number;
    changed_file_count?: number;
    patch_bytes?: number;
    codex_invoked?: boolean;
    exit_code?: number;
    worktree_changed?: boolean;
  };
  artifacts: string[];
}

export interface EvaluationInput {
  $schema?: string;
  schema_version: "1";
  evaluator: string;
  outcome: "accepted-as-is" | "accepted-with-changes" | "rejected" | "abandoned";
  brief_quality: "accurate" | "minor-edits" | "major-edits" | "unusable" | "not-applicable";
  implementation_quality: "accepted-as-is" | "minor-fixes" | "major-fixes" | "rejected" | "not-completed" | "not-applicable";
  communication_quality: "efficient" | "acceptable" | "excessive" | "insufficient";
  verification: "passed" | "partial" | "failed" | "not-run";
  ratings: {
    requirements_fidelity: number;
    implementation_quality?: number;
    communication_efficiency: number;
    research_quality?: number;
  };
  issue_categories: string[];
  notes: string;
  tags: string[];
}

export type EvaluationRecord = Omit<EvaluationInput, "$schema"> & {
  recorded_at: string;
  automated: {
    run_status: string;
    compiler_attempts: number;
    implementation_attempts: number;
    resume_attempts: number;
    iteration_attempts?: number;
    brief_changed_by_claude: boolean | null;
    brief_json_difference_count: number | null;
    implementation_changed_after_codex: boolean | null;
    final_worktree_fingerprint: string;
    final_checkpoint_path: string;
  };
};

const ajv = new Ajv2020({ allErrors: true, formats: { "date-time": true } });
const validateRunEventSchema = ajv.compile<RunEvent>(runEventSchema);
const validateEvaluationInputSchema = ajv.compile<EvaluationInput>(evaluationInputSchema);
const validateEvaluationSchema = ajv.compile<EvaluationRecord>(evaluationSchema);

function schemaErrors(label: string, errors: typeof validateRunEventSchema.errors): string[] {
  return (errors ?? []).map((error) => {
    const allowedValues = error.keyword === "enum" ? (error.params as { allowedValues?: unknown[] }).allowedValues : undefined;
    const allowed = Array.isArray(allowedValues) ? ` (allowed: ${allowedValues.join(", ")})` : "";
    return `${label} ${error.instancePath || "/"} ${error.message ?? "is invalid"}${allowed}`;
  });
}

export function validateEvaluationInput(value: unknown): string[] {
  return validateEvaluationInputSchema(value) ? [] : schemaErrors("Evaluation", validateEvaluationInputSchema.errors);
}

export function validateEvaluationRecord(value: unknown): string[] {
  return validateEvaluationSchema(value) ? [] : schemaErrors("Recorded evaluation", validateEvaluationSchema.errors);
}

export function classifyFailure(error: unknown, stage: ObservationStage): FailureCategory {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|exceeded/i.test(message)) return "codex-timeout";
  if (/interrupted|SIGINT|SIGTERM/i.test(message)) return "interrupted";
  if (/spawn|ENOENT.*codex|executable/i.test(message)) return "codex-spawn";
  if (/exited with code/i.test(message)) return "codex-exit";
  if (/HEAD changed|worktree changed|repository identity/i.test(message)) return "repository-drift";
  if (/changed after|hash|integrity|approval/i.test(message)) return "integrity";
  if (/schema|validation|quote|citation|result|unresolved|Brief has/i.test(message)) return "validation";
  if (stage === "collect") return "collection";
  if (/option|required|argument|configured/i.test(message)) return "configuration";
  return "unknown";
}

export async function appendRunEvent(
  runDir: string,
  event: Omit<RunEvent, "schema_version" | "id" | "at">,
): Promise<RunEvent> {
  const value: RunEvent = {
    schema_version: "1",
    id: randomUUID(),
    at: new Date().toISOString(),
    ...event,
  };
  if (!validateRunEventSchema(value)) throw new Error(schemaErrors("Run event", validateRunEventSchema.errors).join("; "));
  const eventsPath = join(runDir, "run-events.jsonl");
  await repairTornRunEventTail(runDir, eventsPath);
  await appendText(eventsPath, `${JSON.stringify(value)}\n`);
  return value;
}

async function repairTornRunEventTail(runDir: string, eventsPath: string): Promise<void> {
  let handle;
  try {
    handle = await open(eventsPath, "r");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  try {
    const metadata = await handle.stat();
    if (metadata.size === 0) return;
    const finalByte = Buffer.alloc(1);
    await handle.read(finalByte, 0, 1, metadata.size - 1);
    if (finalByte[0] === 0x0a) return;
  } finally {
    await handle.close();
  }
  const content = await readFile(eventsPath, "utf8");
  const lastNewline = content.lastIndexOf("\n");
  const tail = content.slice(lastNewline + 1);
  try {
    JSON.parse(tail);
    await appendText(eventsPath, "\n");
    return;
  } catch {}
  await appendLine(join(runDir, "run-events-torn-tails.jsonl"), JSON.stringify({
    recovered_at: new Date().toISOString(),
    tail,
  }));
  await writeTextAtomic(eventsPath, lastNewline === -1 ? "" : content.slice(0, lastNewline + 1));
}

export async function readRunEvents(runDir: string): Promise<RunEvent[]> {
  const path = join(runDir, "run-events.jsonl");
  try {
    const lines = (await readFile(path, "utf8")).split(/\r?\n/);
    const lastContentIndex = lines.findLastIndex((line) => line.trim().length > 0);
    const events: RunEvent[] = [];
    for (let index = 0; index <= lastContentIndex; index += 1) {
      const line = lines[index]!;
      if (!line.trim()) continue;
      let value: unknown;
      try {
        value = JSON.parse(line) as unknown;
      } catch (error) {
        if (index === lastContentIndex && error instanceof SyntaxError) break;
        throw new Error(`Invalid run event JSON at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!validateRunEventSchema(value)) throw new Error(`Invalid run event at line ${index + 1}: ${schemaErrors("event", validateRunEventSchema.errors).join("; ")}`);
      events.push(value);
    }
    return events;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

export function attemptDirectory(
  runDir: string,
  stage: "compile" | "implement" | "resume" | "research" | "follow-up" | "iterate",
  attempt: number,
): string {
  return join(runDir, "attempts", stage, String(attempt).padStart(3, "0"));
}

export function briefCitationCount(brief: BriefDraft): number {
  return [...brief.decisions, ...brief.constraints, ...brief.unresolved_items]
    .reduce((total, item) => total + item.sources.length, 0);
}

function jsonDifferenceCount(left: unknown, right: unknown): number {
  if (Object.is(left, right)) return 0;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return 1;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return 1;
    const length = Math.max(left.length, right.length);
    let count = 0;
    for (let index = 0; index < length; index += 1) count += jsonDifferenceCount(left[index], right[index]);
    return count;
  }
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  let count = 0;
  for (const key of keys) count += jsonDifferenceCount((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]);
  return count;
}

export async function captureWorktreeCheckpoint(repoRoot: string, directory: string): Promise<{
  path: string;
  fingerprint: string;
  changedFileCount: number;
  patchBytes: number;
}> {
  const observation = await worktreeObservation(repoRoot);
  await writeText(join(directory, "worktree.patch"), observation.patch);
  await writeText(join(directory, "worktree-status.txt"), `${observation.status}${observation.status ? "\n" : ""}`);
  const checkpoint = {
    schema_version: "1",
    captured_at: new Date().toISOString(),
    head: observation.head,
    fingerprint: observation.fingerprint,
    changed_files: observation.changedFiles,
    patch_sha256: await sha256File(join(directory, "worktree.patch")),
    patch_bytes: Buffer.byteLength(observation.patch),
  };
  await writeJson(join(directory, "checkpoint.json"), checkpoint);
  return {
    path: join(directory, "checkpoint.json"),
    fingerprint: observation.fingerprint,
    changedFileCount: observation.changedFiles.length,
    patchBytes: checkpoint.patch_bytes,
  };
}

async function optionalJson<T>(path: string): Promise<T | null> {
  try {
    return await readJson<T>(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function recordEvaluation(runDir: string, state: RunState, input: EvaluationInput): Promise<EvaluationRecord> {
  const errors = validateEvaluationInput(input);
  if (errors.length) throw new Error(errors.join("; "));
  state.evaluationCount = (state.evaluationCount ?? 0) + 1;
  const directory = join(runDir, "evaluations", String(state.evaluationCount).padStart(3, "0"));
  const checkpoint = await captureWorktreeCheckpoint(state.repoRoot, directory);
  const generated = await optionalJson<unknown>(join(runDir, "brief.generated.json"));
  const approved = await optionalJson<unknown>(join(runDir, "brief.approved.json"));
  const briefDifferenceCount = generated !== null && approved !== null
    ? jsonDifferenceCount(generated, approved)
    : null;
  const codexImplementationAttempted =
    (state.attempts?.implement ?? 0) + (state.attempts?.resume ?? 0) + (state.iterationCount ?? 0) > 0;
  const { $schema: inputSchema, ...manual } = input;
  void inputSchema;
  const value: EvaluationRecord = {
    ...manual,
    recorded_at: new Date().toISOString(),
    automated: {
      run_status: state.status,
      compiler_attempts: state.attempts?.compile ?? 0,
      implementation_attempts: state.attempts?.implement ?? 0,
      resume_attempts: state.attempts?.resume ?? 0,
      iteration_attempts: state.iterationCount ?? 0,
      brief_changed_by_claude: briefDifferenceCount === null ? null : briefDifferenceCount > 0,
      brief_json_difference_count: briefDifferenceCount,
      implementation_changed_after_codex: codexImplementationAttempted && state.lastWorktreeSha256
        ? checkpoint.fingerprint !== state.lastWorktreeSha256
        : null,
      final_worktree_fingerprint: checkpoint.fingerprint,
      final_checkpoint_path: checkpoint.path,
    },
  };
  const recordErrors = validateEvaluationRecord(value);
  if (recordErrors.length) throw new Error(recordErrors.join("; "));
  await writeJson(join(directory, "evaluation.json"), value);
  await writeJson(join(runDir, "evaluation.json"), value);
  return value;
}

export interface RunObservationSummary {
  schema_version: "1";
  run_id: string;
  runs_dir?: string;
  status: RunStatus;
  objective: string;
  delegation_pattern: "implementation" | "research" | "interactive" | "autonomous";
  experiment_variant: string | null;
  autonomous_stop_reason: string | null;
  metadata: TaskMetadata;
  created_at: string;
  updated_at: string;
  sources: { count: number; bytes: number; excluded: number };
  attempts: { collect: number; compile: number; implement: number; resume: number; iterate: number };
  duration_ms: Record<string, number>;
  usage: CodexUsage;
  usage_observed_calls: number;
  codex_calls: number;
  models: { compiler: string | null; implementation: string | null; research: string | null };
  tool: { version: string; revision: string | null; dirty: boolean | null; artifact_sha256: string | null };
  failures: Record<string, number>;
  needs_decision_count: number;
  blocked_count: number;
  research_worktree_change_count: number;
  brief_changed_by_claude: boolean | null;
  brief_json_difference_count: number | null;
  salvaged_after_failure: boolean;
  controller_cost: {
    tracked_invocations: number;
    gate_rejections: number;
    codex_failures: number;
    review_surface_bytes: {
      brief_md: number | null;
      evidence_md: number | null;
      result_json: number | null;
      research_json?: number;
    };
  };
  evaluation: EvaluationRecord | null;
}

async function fileSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

export async function buildRunObservation(runDir: string): Promise<RunObservationSummary> {
  const state = await readRunState(runDir);
  const events = await readRunEvents(runDir);
  const bundleValue = await optionalJson<unknown>(join(runDir, "evidence-bundle.json"));
  const bundleErrors = bundleValue === null ? [] : validateEvidenceBundle(bundleValue);
  if (bundleErrors.length) throw new Error(bundleErrors.join("; "));
  const bundle = bundleValue as EvidenceBundle | null;
  const generated = await optionalJson<unknown>(join(runDir, "brief.generated.json"));
  const approved = await optionalJson<unknown>(join(runDir, "brief.approved.json"));
  const briefDifferenceCount = generated !== null && approved !== null
    ? jsonDifferenceCount(generated, approved)
    : null;
  const evaluationValue = await optionalJson<unknown>(join(runDir, "evaluation.json"));
  const evaluationErrors = evaluationValue === null ? [] : validateEvaluationRecord(evaluationValue);
  if (evaluationErrors.length) throw new Error(evaluationErrors.join("; "));
  const evaluation = evaluationValue as EvaluationRecord | null;
  const salvagedAfterFailure = state.status === "failed" &&
    Boolean(evaluation && ["accepted-as-is", "accepted-with-changes"].includes(evaluation.outcome));
  const duration: Record<string, number> = {};
  const usage: CodexUsage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
  const failures: Record<string, number> = {};
  for (const event of events) {
    if (event.duration_ms !== null) duration[event.stage] = (duration[event.stage] ?? 0) + event.duration_ms;
    if (event.usage) {
      usage.input_tokens += event.usage.input_tokens;
      usage.cached_input_tokens += event.usage.cached_input_tokens;
      usage.output_tokens += event.usage.output_tokens;
    }
    if (event.failure_category) failures[event.failure_category] = (failures[event.failure_category] ?? 0) + 1;
  }
  const researchResultBytes = await fileSize(join(runDir, "research.json"));
  return {
    schema_version: "1",
    run_id: state.runId,
    status: state.status,
    objective: state.objective,
    delegation_pattern: state.delegationPattern ?? "implementation",
    experiment_variant: state.experimentVariant ?? null,
    autonomous_stop_reason: state.autonomousStopReason ?? null,
    metadata: state.taskMetadata ?? { task_type: "other", complexity: "unknown", tags: [] },
    created_at: state.createdAt,
    updated_at: state.updatedAt,
    sources: {
      count: bundle?.sources.length ?? 0,
      bytes: bundle?.sources.reduce((total, source) => total + source.bytes, 0) ?? 0,
      excluded: bundle?.excluded_sources.length ?? 0,
    },
    attempts: {
      ...(state.attempts ?? { collect: 0, compile: 0, implement: 0, resume: 0 }),
      iterate: state.iterationCount ?? 0,
    },
    duration_ms: duration,
    usage,
    usage_observed_calls: events.filter((event) =>
      (event.event === "completed" || event.event === "failed") &&
      event.metrics.codex_invoked === true && event.usage !== null).length,
    codex_calls: events.filter((event) =>
      (event.event === "completed" || event.event === "failed") && event.metrics.codex_invoked === true).length,
    models: observedRunModels(state),
    tool: {
      version: state.delegatorVersion ?? "unknown",
      revision: state.delegatorRevision ?? null,
      dirty: state.delegatorDirty ?? null,
      artifact_sha256: state.delegatorArtifactSha256 ?? null,
    },
    failures,
    needs_decision_count: events.filter((event) => event.event === "completed" && event.run_status === "needs-decision").length,
    blocked_count: events.filter((event) => event.event === "completed" && event.run_status === "blocked").length,
    research_worktree_change_count: events.filter((event) =>
      (event.stage === "research" || event.stage === "follow-up") && event.metrics.worktree_changed === true).length,
    brief_changed_by_claude: briefDifferenceCount === null ? null : briefDifferenceCount > 0,
    brief_json_difference_count: briefDifferenceCount,
    salvaged_after_failure: salvagedAfterFailure,
    controller_cost: {
      // Proxy for delegating-agent interaction volume: started/recovered events plus
      // attempt-less compile events, which mark codex-free revalidation calls.
      tracked_invocations: events.filter((event) =>
        event.event === "started" ||
        event.event === "recovered" ||
        (event.stage === "compile" && event.attempt === null)).length,
      // Only delegation-gate outcomes (brief/citation validation, integrity, worktree drift)
      // count as rejections; CLI input mistakes such as evaluate schema errors are not gates
      // and would pollute the gate-false-fire completion criterion.
      gate_rejections: events.filter((event) =>
        event.event === "failed" && event.metrics.codex_invoked !== true &&
        event.failure_category !== null &&
        ["validation", "integrity", "repository-drift"].includes(event.failure_category)).length,
      codex_failures: events.filter((event) =>
        event.event === "failed" && event.metrics.codex_invoked === true).length,
      review_surface_bytes: {
        brief_md: await fileSize(join(runDir, "brief.md")),
        evidence_md: await fileSize(join(runDir, "evidence.md")),
        result_json: await fileSize(join(runDir, "result.json")),
        ...(researchResultBytes === null ? {} : { research_json: researchResultBytes }),
      },
    },
    evaluation,
  };
}

export interface ObservationReport {
  schema_version: "1";
  generated_at: string;
  runs_dirs?: string[];
  unavailable_runs_dirs?: string[];
  summary: {
    runs: number;
    evaluated: number;
    accepted: number;
    accepted_as_is: number;
    failed_runs: number;
    salvaged_runs: number;
    needs_decision_events: number;
    blocked_events: number;
    research_worktree_changes: number;
    codex_calls: number;
    usage_observed_calls: number;
    token_observation_percent: number | null;
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    briefs_compared: number;
    briefs_edited: number;
    tracked_invocations: number;
    gate_rejections: number;
    codex_failed_calls: number;
    review_surface_bytes: number;
  };
  averages: {
    source_count: number | null;
    source_bytes: number | null;
    brief_json_difference_count: number | null;
    stage_duration_ms: Record<string, number | null>;
    ratings: {
      requirements_fidelity: number | null;
      implementation_quality: number | null;
      communication_efficiency: number | null;
      research_quality: number | null;
    };
  };
  breakdowns: {
    task_type: Record<string, number>;
    complexity: Record<string, number>;
    final_status: Record<string, number>;
    evaluation_outcome: Record<string, number>;
    brief_quality: Record<string, number>;
    implementation_quality: Record<string, number>;
    communication_quality: Record<string, number>;
    failure_category: Record<string, number>;
    compiler_model: Record<string, number>;
    implementation_model: Record<string, number>;
    research_model: Record<string, number>;
    delegation_pattern: Record<string, number>;
    experiment_variant: Record<string, number>;
    autonomous_stop_reason: Record<string, number>;
    delegator_revision: Record<string, number>;
  };
  comparisons: {
    delegation_pattern: Record<string, ObservationCohort>;
    experiment_variant: Record<string, ObservationCohort>;
  };
  runs: RunObservationSummary[];
  invalid_runs: { run_dir: string; error: string }[];
}

export interface ObservationCohort {
  runs: number;
  evaluated: number;
  accepted: number;
  codex_calls: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  tracked_invocations: number;
  review_surface_bytes: number;
  average_ratings: {
    requirements_fidelity: number | null;
    implementation_quality: number | null;
    communication_efficiency: number | null;
    research_quality: number | null;
  };
}

function increment(target: Record<string, number>, key: unknown, amount = 1): void {
  const normalized = typeof key === "string" && key ? key : "unknown";
  target[normalized] = (target[normalized] ?? 0) + amount;
}

function mean(values: number[], decimalPlaces = 0): number | null {
  if (!values.length) return null;
  const value = values.reduce((sum, item) => sum + item, 0) / values.length;
  return Number(value.toFixed(decimalPlaces));
}

function evaluationField(
  run: RunObservationSummary,
  field: "outcome" | "brief_quality" | "implementation_quality" | "communication_quality",
): unknown {
  return run.evaluation?.[field];
}

function rating(run: RunObservationSummary, field: string): number | null {
  const ratings = run.evaluation?.ratings;
  if (!ratings || typeof ratings !== "object") return null;
  const value = (ratings as Record<string, unknown>)[field];
  return typeof value === "number" ? value : null;
}

function averageRating(
  runs: RunObservationSummary[],
  field: "requirements_fidelity" | "implementation_quality" | "communication_efficiency" | "research_quality",
): number | null {
  const applicable = field === "implementation_quality"
    ? runs.filter((run) => run.evaluation?.implementation_quality !== "not-applicable")
    : runs;
  return mean(applicable.map((run) => rating(run, field)).filter((value): value is number => value !== null), 2);
}

function buildCohorts(
  runs: RunObservationSummary[],
  keyFor: (run: RunObservationSummary) => string | null,
): Record<string, ObservationCohort> {
  const groups = new Map<string, RunObservationSummary[]>();
  for (const run of runs) {
    const key = keyFor(run) || "unknown";
    const group = groups.get(key) ?? [];
    group.push(run);
    groups.set(key, group);
  }
  return Object.fromEntries([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, group]) => {
    const evaluated = group.filter((run) => run.evaluation !== null);
    return [key, {
      runs: group.length,
      evaluated: evaluated.length,
      accepted: evaluated.filter((run) =>
        ["accepted-as-is", "accepted-with-changes"].includes(String(evaluationField(run, "outcome")))).length,
      codex_calls: group.reduce((sum, run) => sum + run.codex_calls, 0),
      input_tokens: group.reduce((sum, run) => sum + run.usage.input_tokens, 0),
      cached_input_tokens: group.reduce((sum, run) => sum + run.usage.cached_input_tokens, 0),
      output_tokens: group.reduce((sum, run) => sum + run.usage.output_tokens, 0),
      tracked_invocations: group.reduce((sum, run) => sum + run.controller_cost.tracked_invocations, 0),
      review_surface_bytes: group.reduce((sum, run) => sum +
        (run.controller_cost.review_surface_bytes.brief_md ?? 0) +
        (run.controller_cost.review_surface_bytes.evidence_md ?? 0) +
        (run.controller_cost.review_surface_bytes.result_json ?? 0) +
        (run.controller_cost.review_surface_bytes.research_json ?? 0), 0),
      average_ratings: {
        requirements_fidelity: averageRating(evaluated, "requirements_fidelity"),
        implementation_quality: averageRating(evaluated, "implementation_quality"),
        communication_efficiency: averageRating(evaluated, "communication_efficiency"),
        research_quality: averageRating(evaluated, "research_quality"),
      },
    } satisfies ObservationCohort];
  }));
}

export async function buildObservationReport(runsDirInput: string | string[]): Promise<ObservationReport> {
  const multi = Array.isArray(runsDirInput);
  const runsDirs = multi ? runsDirInput : [runsDirInput];
  const runs: RunObservationSummary[] = [];
  const invalid: { run_dir: string; error: string }[] = [];
  const unavailable: string[] = [];
  for (const runsDir of runsDirs) {
    const entries = await readdir(runsDir, { withFileTypes: true }).catch(() => null);
    if (entries === null) {
      // A registered dir that no longer exists usually means a deleted disposable
      // worktree; surfacing it beats silently shrinking the aggregate.
      if (multi) unavailable.push(runsDir);
      continue;
    }
    for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const runDir = join(runsDir, entry.name);
      try {
        await access(join(runDir, "state.json"));
        const run = await buildRunObservation(runDir);
        runs.push(multi ? { ...run, runs_dir: runsDir } : run);
      } catch (error) {
        invalid.push({ run_dir: runDir, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  const evaluated = runs.filter((run) => run.evaluation !== null);
  const accepted = evaluated.filter((run) =>
    ["accepted-as-is", "accepted-with-changes"].includes(String(evaluationField(run, "outcome"))));
  const compared = runs.filter((run) => run.brief_json_difference_count !== null);
  const breakdowns: ObservationReport["breakdowns"] = {
    task_type: {}, complexity: {}, final_status: {}, evaluation_outcome: {}, brief_quality: {},
    implementation_quality: {}, communication_quality: {}, failure_category: {}, compiler_model: {},
    implementation_model: {}, research_model: {}, delegation_pattern: {}, experiment_variant: {},
    autonomous_stop_reason: {}, delegator_revision: {},
  };
  for (const run of runs) {
    increment(breakdowns.task_type, run.metadata.task_type);
    increment(breakdowns.complexity, run.metadata.complexity);
    increment(breakdowns.final_status, run.status);
    increment(breakdowns.compiler_model, run.models.compiler);
    increment(breakdowns.implementation_model, run.models.implementation);
    increment(breakdowns.research_model, run.models.research);
    increment(breakdowns.delegation_pattern, run.delegation_pattern);
    increment(breakdowns.experiment_variant, run.experiment_variant);
    if (run.autonomous_stop_reason) increment(breakdowns.autonomous_stop_reason, run.autonomous_stop_reason);
    increment(
      breakdowns.delegator_revision,
      `${run.tool.version}@${run.tool.revision ?? (run.tool.artifact_sha256
        ? `artifact-${run.tool.artifact_sha256.slice(0, 12)}`
        : "unknown")}${run.tool.dirty === true ? "+dirty" : run.tool.dirty === null ? "+dirty-unknown" : ""}`,
    );
    for (const [category, count] of Object.entries(run.failures)) increment(breakdowns.failure_category, category, count);
    if (run.evaluation) {
      increment(breakdowns.evaluation_outcome, evaluationField(run, "outcome"));
      increment(breakdowns.brief_quality, evaluationField(run, "brief_quality"));
      increment(breakdowns.implementation_quality, evaluationField(run, "implementation_quality"));
      increment(breakdowns.communication_quality, evaluationField(run, "communication_quality"));
    }
  }
  const codexCalls = runs.reduce((sum, run) => sum + run.codex_calls, 0);
  const usageObservedCalls = runs.reduce((sum, run) => sum + run.usage_observed_calls, 0);
  const stages = ["collect", "compile", "approve", "implement", "resume", "research", "follow-up", "iterate", "evaluate"];
  const stageDuration = Object.fromEntries(stages.map((stage) => [
    stage,
    mean(runs.map((run) => run.duration_ms[stage]).filter((value): value is number => value !== undefined)),
  ]));
  return {
    schema_version: "1",
    generated_at: new Date().toISOString(),
    ...(multi ? { runs_dirs: runsDirs, unavailable_runs_dirs: unavailable } : {}),
    summary: {
      runs: runs.length,
      evaluated: evaluated.length,
      accepted: accepted.length,
      accepted_as_is: evaluated.filter((run) => evaluationField(run, "outcome") === "accepted-as-is").length,
      failed_runs: runs.filter((run) => run.status === "failed" && !run.salvaged_after_failure).length,
      salvaged_runs: runs.filter((run) => run.salvaged_after_failure).length,
      needs_decision_events: runs.reduce((sum, run) => sum + run.needs_decision_count, 0),
      blocked_events: runs.reduce((sum, run) => sum + run.blocked_count, 0),
      research_worktree_changes: runs.reduce((sum, run) => sum + run.research_worktree_change_count, 0),
      codex_calls: codexCalls,
      usage_observed_calls: usageObservedCalls,
      token_observation_percent: codexCalls ? Math.round(usageObservedCalls / codexCalls * 100) : null,
      input_tokens: runs.reduce((sum, run) => sum + run.usage.input_tokens, 0),
      cached_input_tokens: runs.reduce((sum, run) => sum + run.usage.cached_input_tokens, 0),
      output_tokens: runs.reduce((sum, run) => sum + run.usage.output_tokens, 0),
      briefs_compared: compared.length,
      briefs_edited: compared.filter((run) => run.brief_changed_by_claude).length,
      tracked_invocations: runs.reduce((sum, run) => sum + run.controller_cost.tracked_invocations, 0),
      gate_rejections: runs.reduce((sum, run) => sum + run.controller_cost.gate_rejections, 0),
      codex_failed_calls: runs.reduce((sum, run) => sum + run.controller_cost.codex_failures, 0),
      review_surface_bytes: runs.reduce((sum, run) =>
        sum +
        (run.controller_cost.review_surface_bytes.brief_md ?? 0) +
        (run.controller_cost.review_surface_bytes.evidence_md ?? 0) +
        (run.controller_cost.review_surface_bytes.result_json ?? 0) +
        (run.controller_cost.review_surface_bytes.research_json ?? 0), 0),
    },
    averages: {
      source_count: mean(runs.map((run) => run.sources.count)),
      source_bytes: mean(runs.map((run) => run.sources.bytes)),
      brief_json_difference_count: mean(compared.map((run) => run.brief_json_difference_count!)),
      stage_duration_ms: stageDuration,
      ratings: {
        requirements_fidelity: averageRating(evaluated, "requirements_fidelity"),
        implementation_quality: averageRating(evaluated, "implementation_quality"),
        communication_efficiency: averageRating(evaluated, "communication_efficiency"),
        research_quality: averageRating(evaluated, "research_quality"),
      },
    },
    breakdowns,
    comparisons: {
      delegation_pattern: buildCohorts(runs, (run) => run.delegation_pattern),
      experiment_variant: buildCohorts(runs, (run) => run.experiment_variant),
    },
    runs,
    invalid_runs: invalid,
  };
}

function breakdownRows(values: Record<string, number>): string {
  const rows = Object.entries(values).sort(([left], [right]) => left.localeCompare(right));
  return rows.length ? rows.map(([key, count]) => `| ${key} | ${count} |`).join("\n") : "| n/a | 0 |";
}

function markdownCell(value: unknown): string {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function cohortRows(values: Record<string, ObservationCohort>): string {
  const rows = Object.entries(values);
  return rows.length ? rows.map(([key, cohort]) =>
    `| ${markdownCell(key)} | ${cohort.runs} | ${cohort.evaluated} | ${cohort.accepted} | ${cohort.codex_calls} | ${cohort.input_tokens} / ${cohort.cached_input_tokens} / ${cohort.output_tokens} | ${cohort.tracked_invocations} | ${cohort.review_surface_bytes} | ${cohort.average_ratings.implementation_quality ?? "n/a"} / ${cohort.average_ratings.research_quality ?? "n/a"} |`,
  ).join("\n") : "| n/a | 0 | 0 | 0 | 0 | 0 / 0 / 0 | 0 | 0 | n/a / n/a |";
}

export function renderObservationReport(report: ObservationReport): string {
  const stageRows = Object.entries(report.averages.stage_duration_ms)
    .map(([stage, value]) => `| ${stage} | ${value ?? "n/a"} |`).join("\n");
  const acceptedPercent = report.summary.evaluated
    ? Math.round(report.summary.accepted / report.summary.evaluated * 100)
    : null;
  return `# agent-delegator observation report

- Runs: ${report.summary.runs}
- Evaluated: ${report.summary.evaluated}
- Accepted: ${report.summary.accepted}${acceptedPercent === null ? "" : ` (${acceptedPercent}%)`}
- Accepted as-is: ${report.summary.accepted_as_is}
- Failed runs: ${report.summary.failed_runs}
- Failed-state runs accepted after salvage: ${report.summary.salvaged_runs}
- Needs-decision / blocked events: ${report.summary.needs_decision_events} / ${report.summary.blocked_events}
- Read-only research worktree changes: ${report.summary.research_worktree_changes}
- Briefs edited by Claude: ${report.summary.briefs_edited} / ${report.summary.briefs_compared} compared
- Token telemetry coverage: ${report.summary.usage_observed_calls} / ${report.summary.codex_calls} Codex calls${report.summary.token_observation_percent === null ? "" : ` (${report.summary.token_observation_percent}%)`}
- Input / cached input / output tokens observed: ${report.summary.input_tokens} / ${report.summary.cached_input_tokens} / ${report.summary.output_tokens}
- Controller interactions tracked: ${report.summary.tracked_invocations} (gate rejections: ${report.summary.gate_rejections}, failed Codex calls: ${report.summary.codex_failed_calls})
- Review surface bytes (brief.md + evidence.md + result.json/research.json): ${report.summary.review_surface_bytes}
- Average ratings (requirements / implementation / communication / research): ${report.averages.ratings.requirements_fidelity ?? "n/a"} / ${report.averages.ratings.implementation_quality ?? "n/a"} / ${report.averages.ratings.communication_efficiency ?? "n/a"} / ${report.averages.ratings.research_quality ?? "n/a"}

## Average stage duration

| Stage | Milliseconds |
| --- | ---: |
${stageRows}

## Task mix

| Task type | Runs |
| --- | ---: |
${breakdownRows(report.breakdowns.task_type)}

## Delegation patterns

| Pattern | Runs |
| --- | ---: |
${breakdownRows(report.breakdowns.delegation_pattern)}

## Autonomous stop reasons

| Reason | Runs |
| --- | ---: |
${breakdownRows(report.breakdowns.autonomous_stop_reason)}

## Pattern comparison

| Pattern | Runs | Evaluated | Accepted | Codex calls | Input / cached / output tokens | Interactions | Review bytes | Implementation / research rating |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: |
${cohortRows(report.comparisons.delegation_pattern)}

## Variant comparison

| Variant | Runs | Evaluated | Accepted | Codex calls | Input / cached / output tokens | Interactions | Review bytes | Implementation / research rating |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: |
${cohortRows(report.comparisons.experiment_variant)}

## Outcomes

| Outcome | Runs |
| --- | ---: |
${breakdownRows(report.breakdowns.evaluation_outcome)}

## Failure categories

| Category | Events |
| --- | ---: |
${breakdownRows(report.breakdowns.failure_category)}

## Runs

| Run | Pattern | Variant | Type | Complexity | Status | Brief edits | Gate rejections | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${report.runs.map((run) => `| ${markdownCell(run.run_id)} | ${markdownCell(run.delegation_pattern)} | ${markdownCell(run.experiment_variant ?? "-")} | ${markdownCell(run.metadata.task_type)} | ${markdownCell(run.metadata.complexity)} | ${markdownCell(run.salvaged_after_failure ? `${run.status} (salvaged)` : run.status)} | ${run.brief_json_difference_count ?? "n/a"} | ${run.controller_cost.gate_rejections} | ${markdownCell(run.evaluation?.outcome ?? "not-evaluated")} |`).join("\n")}

${directoriesSection(report)}${report.invalid_runs.length ? `## Invalid runs\n\n${report.invalid_runs.map((item) => `- ${item.run_dir}: ${item.error}`).join("\n")}\n` : ""}`;
}

function directoriesSection(report: ObservationReport): string {
  if (!report.runs_dirs) return "";
  const unavailable = new Set(report.unavailable_runs_dirs ?? []);
  const rows = report.runs_dirs.map((dir) =>
    unavailable.has(dir)
      ? `| ${dir} | n/a | unavailable |`
      : `| ${dir} | ${report.runs.filter((run) => run.runs_dir === dir).length} | available |`);
  return `## Directories

| Runs dir | Runs | Status |
| --- | ---: | --- |
${rows.join("\n")}

`;
}
