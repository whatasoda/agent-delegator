import { afterEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  appendRunEvent,
  buildObservationReport,
  captureWorktreeCheckpoint,
  classifyFailure,
  readRunEvents,
  renderObservationReport,
  validateEvaluationInput,
} from "../src/observation.js";
import { type RunState, writeRunState } from "../src/run-store.js";

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

function legacyState(runId: string, repoRoot: string): RunState {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    runId,
    status: "completed",
    objective: "Legacy run without observation events",
    repoRoot,
    baseCommit: "fixture",
    transcriptPath: "",
    transcriptSessionId: null,
    transcriptResolutionMethod: "fixture",
    createdAt: now,
    updatedAt: now,
    compilerModel: null,
    compilerSessionId: null,
    implementationModel: null,
    implementationSessionId: null,
    latestResult: null,
    failure: null,
  };
}

describe("run observation", () => {
  test("persists validated events and classifies common failures", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "agent-delegator-observation-"));
    temporaryDirectories.push(runDir);
    await appendRunEvent(runDir, {
      stage: "compile",
      event: "completed",
      attempt: 1,
      duration_ms: 42,
      model: "fixture-model",
      run_status: "compiled",
      failure_category: null,
      message: null,
      usage: { input_tokens: 10, cached_input_tokens: 3, output_tokens: 4 },
      metrics: {
        citation_count: 2,
        citation_source_correction_count: 1,
        citation_turn_correction_count: 1,
        exit_code: 0,
      },
      artifacts: ["attempts/compile/001/output.json"],
    });

    const events = await readRunEvents(runDir);
    expect(events).toHaveLength(1);
    expect(events[0]?.usage?.cached_input_tokens).toBe(3);
    expect(events[0]?.metrics.citation_source_correction_count).toBe(1);
    expect(events[0]?.metrics.citation_turn_correction_count).toBe(1);
    expect(classifyFailure(new Error("Codex exceeded the 10ms timeout"), "compile")).toBe("codex-timeout");
    expect(classifyFailure(new Error("Repository HEAD changed"), "implement")).toBe("repository-drift");

    await writeFile(join(runDir, "run-events.jsonl"), `${JSON.stringify(events[0])}\n{\"schema_version\":`);
    expect(await readRunEvents(runDir)).toEqual(events);
    await appendRunEvent(runDir, {
      stage: "status", event: "recovered", attempt: null, duration_ms: null, model: null,
      run_status: "failed", failure_category: "interrupted", message: "recovered after torn append",
      usage: null, metrics: {}, artifacts: ["state.json"],
    });
    expect(await readRunEvents(runDir)).toHaveLength(2);
    expect(await readFile(join(runDir, "run-events-torn-tails.jsonl"), "utf8"))
      .toContain("schema_version");
    await writeFile(join(runDir, "run-events.jsonl"), `{\"broken\"\n${JSON.stringify(events[0])}\n`);
    await expect(readRunEvents(runDir)).rejects.toThrow("Invalid run event JSON at line 1");
  });

  test("reports legacy runs with explicit unknown metadata and telemetry gaps", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-delegator-report-"));
    temporaryDirectories.push(root);
    const runsDir = join(root, "runs");
    const runDir = join(runsDir, "legacy");
    const invalidRunDir = join(runsDir, "invalid-evaluation");
    await mkdir(runDir, { recursive: true });
    await mkdir(invalidRunDir, { recursive: true });
    await writeRunState(runDir, legacyState("legacy", root));
    await writeRunState(invalidRunDir, legacyState("invalid-evaluation", root));
    await writeFile(join(invalidRunDir, "evaluation.json"), "{}\n");

    const report = await buildObservationReport(runsDir);

    expect(report.summary).toMatchObject({
      runs: 1,
      evaluated: 0,
      codex_calls: 0,
      usage_observed_calls: 0,
      token_observation_percent: null,
    });
    expect(report.runs[0]?.metadata).toEqual({ task_type: "other", complexity: "unknown", tags: [] });
    expect(report.runs[0]?.controller_cost).toEqual({
      tracked_invocations: 0,
      gate_rejections: 0,
      codex_failures: 0,
      review_surface_bytes: { brief_md: null, evidence_md: null, result_json: null },
    });
    expect(report.summary).toMatchObject({
      tracked_invocations: 0,
      gate_rejections: 0,
      codex_failed_calls: 0,
      review_surface_bytes: 0,
    });
    expect(report.invalid_runs).toHaveLength(1);
    expect(report.invalid_runs[0]?.error).toContain("Recorded evaluation");
    expect(report.breakdowns.task_type).toEqual({ other: 1 });
    expect(renderObservationReport(report)).toContain("Token telemetry coverage: 0 / 0 Codex calls");
    expect(renderObservationReport(report)).toContain("Controller interactions tracked: 0 (gate rejections: 0, failed Codex calls: 0)");
  });

  test("aggregates multiple runs directories and flags unavailable ones", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-delegator-all-"));
    temporaryDirectories.push(root);
    const dirA = join(root, "a-runs");
    const dirB = join(root, "b-runs");
    const missing = join(root, "deleted-worktree-runs");
    await mkdir(join(dirA, "run-a"), { recursive: true });
    await mkdir(join(dirB, "run-b"), { recursive: true });
    await writeRunState(join(dirA, "run-a"), legacyState("run-a", root));
    await writeRunState(join(dirB, "run-b"), legacyState("run-b", root));

    const report = await buildObservationReport([dirA, dirB, missing]);
    expect(report.summary.runs).toBe(2);
    expect(report.runs_dirs).toEqual([dirA, dirB, missing]);
    expect(report.unavailable_runs_dirs).toEqual([missing]);
    expect(report.runs.map((run) => run.runs_dir)).toEqual([dirA, dirB]);

    const rendered = renderObservationReport(report);
    expect(rendered).toContain("## Directories");
    expect(rendered).toContain(`| ${dirA} | 1 | available |`);
    expect(rendered).toContain(`| ${missing} | n/a | unavailable |`);

    const singleDir = await buildObservationReport(dirA);
    expect(singleDir.runs_dirs).toBeUndefined();
    expect(singleDir.runs[0]?.runs_dir).toBeUndefined();
  });

  test("counts only delegation-gate failures as gate rejections", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-delegator-gates-"));
    temporaryDirectories.push(root);
    const runsDir = join(root, "runs");
    const runDir = join(runsDir, "gated");
    await mkdir(runDir, { recursive: true });
    await writeRunState(runDir, legacyState("gated", root));
    const base = {
      attempt: 1 as const,
      duration_ms: 5 as const,
      model: null,
      usage: null,
      artifacts: [] as string[],
    };
    await appendRunEvent(runDir, {
      ...base, stage: "compile", event: "failed", run_status: "failed",
      failure_category: "validation", message: "Brief validation failed",
      metrics: { codex_invoked: false },
    });
    await appendRunEvent(runDir, {
      ...base, stage: "evaluate", event: "failed", run_status: "failed",
      failure_category: "unknown", message: "Evaluation /implementation_quality must be equal to one of the allowed values",
      metrics: {},
    });
    await appendRunEvent(runDir, {
      ...base, stage: "implement", event: "failed", run_status: "failed",
      failure_category: "codex-timeout", message: "Codex exceeded the timeout",
      metrics: { codex_invoked: true },
    });

    const report = await buildObservationReport(runsDir);
    expect(report.runs[0]?.controller_cost).toMatchObject({
      gate_rejections: 1,
      codex_failures: 1,
    });
  });

  test("separates accepted salvage from unrecovered failed runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-delegator-salvage-"));
    temporaryDirectories.push(root);
    const runsDir = join(root, "runs");
    const runDir = join(runsDir, "salvaged");
    await mkdir(runDir, { recursive: true });
    const state = legacyState("salvaged", root);
    state.status = "failed";
    state.failure = "Codex exceeded the timeout";
    await writeRunState(runDir, state);
    await writeFile(join(runDir, "evaluation.json"), JSON.stringify({
      schema_version: "1",
      evaluator: "claude",
      outcome: "accepted-with-changes",
      brief_quality: "accurate",
      implementation_quality: "minor-fixes",
      communication_quality: "acceptable",
      verification: "passed",
      ratings: { requirements_fidelity: 5, implementation_quality: 4, communication_efficiency: 4 },
      issue_categories: [],
      notes: "Recovered the completed worktree after timeout.",
      tags: ["salvaged"],
      recorded_at: new Date().toISOString(),
      automated: {
        run_status: "failed",
        compiler_attempts: 1,
        implementation_attempts: 1,
        resume_attempts: 0,
        iteration_attempts: 0,
        brief_changed_by_claude: false,
        brief_json_difference_count: 0,
        implementation_changed_after_codex: false,
        final_worktree_fingerprint: "0".repeat(64),
        final_checkpoint_path: join(runDir, "evaluations", "001", "checkpoint.json"),
      },
    }));

    const report = await buildObservationReport(runsDir);
    expect(report.summary).toMatchObject({ failed_runs: 0, salvaged_runs: 1 });
    expect(report.runs[0]?.salvaged_after_failure).toBe(true);
    expect(renderObservationReport(report)).toContain("failed (salvaged)");
  });

  test("rejects incomplete Claude evaluations and corrupt event streams", async () => {
    expect(validateEvaluationInput({ schema_version: "1", evaluator: "claude" }).length).toBeGreaterThan(0);
    const enumErrors = validateEvaluationInput({
      schema_version: "1",
      evaluator: "claude",
      outcome: "accepted-as-is",
      brief_quality: "accurate",
      implementation_quality: "looks-good",
      communication_quality: "efficient",
      verification: "passed",
      ratings: { requirements_fidelity: 5, implementation_quality: 5, communication_efficiency: 5 },
      issue_categories: [],
      notes: "",
      tags: [],
    });
    expect(enumErrors.join("\n")).toContain(
      "/implementation_quality must be equal to one of the allowed values (allowed: accepted-as-is, minor-fixes, major-fixes, rejected, not-completed, not-applicable)",
    );
    const missingImplementationRating = validateEvaluationInput({
      schema_version: "1",
      evaluator: "claude",
      outcome: "accepted-as-is",
      brief_quality: "accurate",
      implementation_quality: "accepted-as-is",
      communication_quality: "efficient",
      verification: "passed",
      ratings: { requirements_fidelity: 5, communication_efficiency: 5 },
      issue_categories: [],
      notes: "",
      tags: [],
    });
    expect(missingImplementationRating.join("\n")).toContain("/ratings must have required property 'implementation_quality'");
    const runDir = await mkdtemp(join(tmpdir(), "agent-delegator-observation-"));
    temporaryDirectories.push(runDir);
    await writeFile(join(runDir, "run-events.jsonl"), "{}\n");
    await expect(readRunEvents(runDir)).rejects.toThrow("Invalid run event at line 1");
  });

  test("captures tracked and untracked worktree content in a checkpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-delegator-checkpoint-"));
    temporaryDirectories.push(root);
    const repo = join(root, "repo");
    const checkpointDir = join(root, "checkpoint");
    await mkdir(repo);
    await execFileAsync("git", ["init", "-q"], { cwd: repo });
    await writeFile(join(repo, "tracked.txt"), "before\n");
    await execFileAsync("git", ["add", "tracked.txt"], { cwd: repo });
    await execFileAsync(
      "git",
      ["-c", "user.name=Observation Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"],
      { cwd: repo },
    );
    await writeFile(join(repo, "tracked.txt"), "after\n");
    await writeFile(join(repo, "created.txt"), "new artifact\n");

    const checkpoint = await captureWorktreeCheckpoint(repo, checkpointDir);
    const patch = await readFile(join(checkpointDir, "worktree.patch"), "utf8");

    expect(checkpoint.changedFileCount).toBe(2);
    expect(patch).toContain("+after");
    expect(patch).toContain("+new artifact");
  });
});
