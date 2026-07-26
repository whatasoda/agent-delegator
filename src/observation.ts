import { randomUUID } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import evaluationInputSchema from "../schemas/evaluation-input.schema.json";
import evaluationSchema from "../schemas/evaluation.schema.json";
import runEventSchema from "../schemas/run-event.schema.json";
import type { BriefDraft } from "./brief.js";
import type { CodexUsage } from "./codex.js";
import { validateEvidenceBundle, type EvidenceBundle, type TaskMetadata } from "./evidence.js";
import { appendText, readJson, sha256File, writeJson, writeText } from "./files.js";
import { worktreeObservation } from "./repository.js";
import { readRunState, type RunState, type RunStatus } from "./run-store.js";

export type ObservationStage = "collect" | "compile" | "approve" | "implement" | "resume" | "evaluate" | "status";
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
  };
  artifacts: string[];
}

export interface EvaluationInput {
  $schema?: string;
  schema_version: "1";
  evaluator: string;
  outcome: "accepted-as-is" | "accepted-with-changes" | "rejected" | "abandoned";
  brief_quality: "accurate" | "minor-edits" | "major-edits" | "unusable";
  implementation_quality: "accepted-as-is" | "minor-fixes" | "major-fixes" | "rejected" | "not-completed";
  communication_quality: "efficient" | "acceptable" | "excessive" | "insufficient";
  verification: "passed" | "partial" | "failed" | "not-run";
  ratings: { requirements_fidelity: number; implementation_quality: number; communication_efficiency: number };
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
  return (errors ?? []).map((error) => `${label} ${error.instancePath || "/"} ${error.message ?? "is invalid"}`);
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
  await appendText(join(runDir, "run-events.jsonl"), `${JSON.stringify(value)}\n`);
  return value;
}

export async function readRunEvents(runDir: string): Promise<RunEvent[]> {
  const path = join(runDir, "run-events.jsonl");
  try {
    const lines = (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean);
    return lines.map((line, index) => {
      const value = JSON.parse(line) as unknown;
      if (!validateRunEventSchema(value)) throw new Error(`Invalid run event at line ${index + 1}: ${schemaErrors("event", validateRunEventSchema.errors).join("; ")}`);
      return value;
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

export function attemptDirectory(runDir: string, stage: "compile" | "implement" | "resume", attempt: number): string {
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
  const codexImplementationAttempted = (state.attempts?.implement ?? 0) + (state.attempts?.resume ?? 0) > 0;
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
  status: RunStatus;
  objective: string;
  metadata: TaskMetadata;
  created_at: string;
  updated_at: string;
  sources: { count: number; bytes: number; excluded: number };
  attempts: { collect: number; compile: number; implement: number; resume: number };
  duration_ms: Record<string, number>;
  usage: CodexUsage;
  usage_observed_calls: number;
  codex_calls: number;
  models: { compiler: string | null; implementation: string | null };
  tool: { version: string; revision: string | null; dirty: boolean | null };
  failures: Record<string, number>;
  needs_decision_count: number;
  blocked_count: number;
  brief_changed_by_claude: boolean | null;
  brief_json_difference_count: number | null;
  evaluation: EvaluationRecord | null;
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
  return {
    schema_version: "1",
    run_id: state.runId,
    status: state.status,
    objective: state.objective,
    metadata: state.taskMetadata ?? { task_type: "other", complexity: "unknown", tags: [] },
    created_at: state.createdAt,
    updated_at: state.updatedAt,
    sources: {
      count: bundle?.sources.length ?? 0,
      bytes: bundle?.sources.reduce((total, source) => total + source.bytes, 0) ?? 0,
      excluded: bundle?.excluded_sources.length ?? 0,
    },
    attempts: state.attempts ?? { collect: 0, compile: 0, implement: 0, resume: 0 },
    duration_ms: duration,
    usage,
    usage_observed_calls: events.filter((event) =>
      (event.event === "completed" || event.event === "failed") &&
      event.metrics.codex_invoked === true && event.usage !== null).length,
    codex_calls: events.filter((event) =>
      (event.event === "completed" || event.event === "failed") && event.metrics.codex_invoked === true).length,
    models: { compiler: state.compilerModel, implementation: state.implementationModel },
    tool: {
      version: state.delegatorVersion ?? "unknown",
      revision: state.delegatorRevision ?? null,
      dirty: state.delegatorDirty ?? null,
    },
    failures,
    needs_decision_count: events.filter((event) => event.event === "completed" && event.run_status === "needs-decision").length,
    blocked_count: events.filter((event) => event.event === "completed" && event.run_status === "blocked").length,
    brief_changed_by_claude: briefDifferenceCount === null ? null : briefDifferenceCount > 0,
    brief_json_difference_count: briefDifferenceCount,
    evaluation,
  };
}

export interface ObservationReport {
  schema_version: "1";
  generated_at: string;
  summary: {
    runs: number;
    evaluated: number;
    accepted: number;
    accepted_as_is: number;
    failed_runs: number;
    needs_decision_events: number;
    blocked_events: number;
    codex_calls: number;
    usage_observed_calls: number;
    token_observation_percent: number | null;
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    briefs_compared: number;
    briefs_edited: number;
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
    delegator_revision: Record<string, number>;
  };
  runs: RunObservationSummary[];
  invalid_runs: { run_dir: string; error: string }[];
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

export async function buildObservationReport(runsDir: string): Promise<ObservationReport> {
  const entries = await readdir(runsDir, { withFileTypes: true }).catch(() => []);
  const runs: RunObservationSummary[] = [];
  const invalid: { run_dir: string; error: string }[] = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const runDir = join(runsDir, entry.name);
    try {
      await access(join(runDir, "state.json"));
      runs.push(await buildRunObservation(runDir));
    } catch (error) {
      invalid.push({ run_dir: runDir, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const evaluated = runs.filter((run) => run.evaluation !== null);
  const accepted = evaluated.filter((run) =>
    ["accepted-as-is", "accepted-with-changes"].includes(String(evaluationField(run, "outcome"))));
  const compared = runs.filter((run) => run.brief_json_difference_count !== null);
  const breakdowns: ObservationReport["breakdowns"] = {
    task_type: {}, complexity: {}, final_status: {}, evaluation_outcome: {}, brief_quality: {},
    implementation_quality: {}, communication_quality: {}, failure_category: {}, compiler_model: {},
    implementation_model: {}, delegator_revision: {},
  };
  for (const run of runs) {
    increment(breakdowns.task_type, run.metadata.task_type);
    increment(breakdowns.complexity, run.metadata.complexity);
    increment(breakdowns.final_status, run.status);
    increment(breakdowns.compiler_model, run.models.compiler);
    increment(breakdowns.implementation_model, run.models.implementation);
    increment(
      breakdowns.delegator_revision,
      `${run.tool.version}@${run.tool.revision ?? "unknown"}${run.tool.dirty === true ? "+dirty" : run.tool.dirty === null ? "+dirty-unknown" : ""}`,
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
  const stages = ["collect", "compile", "approve", "implement", "resume", "evaluate"];
  const stageDuration = Object.fromEntries(stages.map((stage) => [
    stage,
    mean(runs.map((run) => run.duration_ms[stage]).filter((value): value is number => value !== undefined)),
  ]));
  return {
    schema_version: "1",
    generated_at: new Date().toISOString(),
    summary: {
      runs: runs.length,
      evaluated: evaluated.length,
      accepted: accepted.length,
      accepted_as_is: evaluated.filter((run) => evaluationField(run, "outcome") === "accepted-as-is").length,
      failed_runs: runs.filter((run) => run.status === "failed").length,
      needs_decision_events: runs.reduce((sum, run) => sum + run.needs_decision_count, 0),
      blocked_events: runs.reduce((sum, run) => sum + run.blocked_count, 0),
      codex_calls: codexCalls,
      usage_observed_calls: usageObservedCalls,
      token_observation_percent: codexCalls ? Math.round(usageObservedCalls / codexCalls * 100) : null,
      input_tokens: runs.reduce((sum, run) => sum + run.usage.input_tokens, 0),
      cached_input_tokens: runs.reduce((sum, run) => sum + run.usage.cached_input_tokens, 0),
      output_tokens: runs.reduce((sum, run) => sum + run.usage.output_tokens, 0),
      briefs_compared: compared.length,
      briefs_edited: compared.filter((run) => run.brief_changed_by_claude).length,
    },
    averages: {
      source_count: mean(runs.map((run) => run.sources.count)),
      source_bytes: mean(runs.map((run) => run.sources.bytes)),
      brief_json_difference_count: mean(compared.map((run) => run.brief_json_difference_count!)),
      stage_duration_ms: stageDuration,
      ratings: {
        requirements_fidelity: mean(evaluated.map((run) => rating(run, "requirements_fidelity")).filter((value): value is number => value !== null), 2),
        implementation_quality: mean(evaluated.map((run) => rating(run, "implementation_quality")).filter((value): value is number => value !== null), 2),
        communication_efficiency: mean(evaluated.map((run) => rating(run, "communication_efficiency")).filter((value): value is number => value !== null), 2),
      },
    },
    breakdowns,
    runs,
    invalid_runs: invalid,
  };
}

function breakdownRows(values: Record<string, number>): string {
  const rows = Object.entries(values).sort(([left], [right]) => left.localeCompare(right));
  return rows.length ? rows.map(([key, count]) => `| ${key} | ${count} |`).join("\n") : "| n/a | 0 |";
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
- Needs-decision / blocked events: ${report.summary.needs_decision_events} / ${report.summary.blocked_events}
- Briefs edited by Claude: ${report.summary.briefs_edited} / ${report.summary.briefs_compared} compared
- Token telemetry coverage: ${report.summary.usage_observed_calls} / ${report.summary.codex_calls} Codex calls${report.summary.token_observation_percent === null ? "" : ` (${report.summary.token_observation_percent}%)`}
- Input / cached input / output tokens observed: ${report.summary.input_tokens} / ${report.summary.cached_input_tokens} / ${report.summary.output_tokens}
- Average ratings (requirements / implementation / communication): ${report.averages.ratings.requirements_fidelity ?? "n/a"} / ${report.averages.ratings.implementation_quality ?? "n/a"} / ${report.averages.ratings.communication_efficiency ?? "n/a"}

## Average stage duration

| Stage | Milliseconds |
| --- | ---: |
${stageRows}

## Task mix

| Task type | Runs |
| --- | ---: |
${breakdownRows(report.breakdowns.task_type)}

## Outcomes

| Outcome | Runs |
| --- | ---: |
${breakdownRows(report.breakdowns.evaluation_outcome)}

## Failure categories

| Category | Events |
| --- | ---: |
${breakdownRows(report.breakdowns.failure_category)}

## Runs

| Run | Type | Complexity | Status | Brief edits | Outcome |
| --- | --- | --- | --- | --- | --- |
${report.runs.map((run) => `| ${run.run_id} | ${run.metadata.task_type} | ${run.metadata.complexity} | ${run.status} | ${run.brief_json_difference_count ?? "n/a"} | ${String(run.evaluation?.outcome ?? "not-evaluated")} |`).join("\n")}

${report.invalid_runs.length ? `## Invalid runs\n\n${report.invalid_runs.map((item) => `- ${item.run_dir}: ${item.error}`).join("\n")}\n` : ""}`;
}
