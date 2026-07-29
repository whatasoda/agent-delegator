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
      "/implementation_quality must be equal to one of the allowed values (allowed: accepted-as-is, minor-fixes, major-fixes, rejected, not-completed)",
    );
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
