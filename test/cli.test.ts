import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import packageJson from "../package.json";

const temporaryDirectories: string[] = [];
const cli = resolve(import.meta.dir, "../src/cli.ts");

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function run(command: string[], cwd: string, env: Record<string, string> = {}): Promise<CommandResult> {
  const child = Bun.spawn([process.execPath, cli, ...command], {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  const child = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const stderr = await new Response(child.stderr).text();
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
}

async function fixture(): Promise<{
  repo: string;
  runs: string;
  transcript: string;
  codex: string;
  env: Record<string, string>;
  log: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "agent-delegator-cli-"));
  temporaryDirectories.push(root);
  const repo = join(root, "fixture repo");
  const bin = join(root, "bin");
  const runs = join(root, "runs");
  const transcript = join(root, "transcript.jsonl");
  const log = join(root, "codex-calls.jsonl");
  await mkdir(repo, { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(join(repo, "CLAUDE.md"), "# Fixture guidance\n");
  await writeFile(join(repo, "AGENTS.md"), "Do not commit.\n");
  await writeFile(
    transcript,
    [
      JSON.stringify({ type: "user", message: { content: "Add a greeting, but ask which wording to use." } }),
      JSON.stringify({
        type: "assistant",
        message: { content: "Agreed. Implementation must wait for the exact greeting wording." },
      }),
    ].join("\n"),
  );
  const fakeCodex = join(bin, "codex");
  await writeFile(
    fakeCodex,
    `#!/usr/bin/env bun
import { appendFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("codex-cli fixture\\n");
  process.exit(0);
}
appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify(args) + "\\n");
const outputIndex = args.indexOf("--output-last-message");
const output = args[outputIndex + 1];
const isResume = args.includes("resume");
const isBrief = args.some((arg) => arg.endsWith("brief.schema.json"));
const isResearch = args.some((arg) => arg.endsWith("research-result.schema.json"));
const isIteration = args.some((arg) => arg.endsWith("iteration-result.schema.json"));
const isVerification = args.some((arg) => arg.endsWith("verification-result.schema.json"));
const citationTurn = Number(process.env.FAKE_CODEX_CITATION_TURN ?? "2");
const citationSourceId = process.env.FAKE_CODEX_CITATION_SOURCE_ID ?? "source-001";
const constraintQuote = process.env.FAKE_CODEX_CONSTRAINT_QUOTE ?? "must wait for the exact greeting wording";
const brief = process.env.FAKE_CODEX_INVALID_BRIEF === "1" ? {} : {
  schema_version: "1",
  objective: "Add a greeting",
  motivation: "Exercise the delegation lifecycle",
  current_behavior: ["No greeting exists"],
  desired_behavior: ["A selected greeting exists"],
  decisions: [{
    statement: "Ask for exact wording before editing",
    status: "accepted",
    rationale: "The wording is a product decision",
    sources: [{ source_id: citationSourceId, turn: citationTurn, quote: "must wait for the exact greeting wording" }]
  }],
  constraints: [{
    level: "must",
    rule: "Do not choose the greeting without a decision",
    rationale: "The wording is deliberately unresolved",
    failure_mode: "The implementer invents product copy",
    sources: [{ source_id: citationSourceId, turn: citationTurn, quote: constraintQuote }]
  }],
  scope: { in_scope: ["fixture greeting"], out_of_scope: ["deployment"] },
  implementation_guidance: [],
  acceptance_criteria: ["The chosen greeting is recorded"],
  verification: ["Inspect the fixture"],
  escalation_conditions: ["No exact wording has been selected"],
  unresolved_items: [{
    question: "What exact greeting should be used?",
    why_it_matters: "Codex must not invent product copy",
    sources: [{ source_id: citationSourceId, turn: citationTurn, quote: "must wait for the exact greeting wording" }]
  }]
};
const result = process.env.FAKE_CODEX_INVALID_RESULT === "1" ? { status: "completed" } : {
  status: isResume || process.env.FAKE_CODEX_IMPLEMENT_COMPLETED === "1" ? "completed" : "needs-decision",
  summary: isResume || process.env.FAKE_CODEX_IMPLEMENT_COMPLETED === "1" ? "Applied the supplied decision" : "Waiting for wording",
  changed_files: [],
  implementation_decisions: [],
  brief_deviations: [],
  verification: [],
  remaining_risks: [],
  question: isResume || process.env.FAKE_CODEX_IMPLEMENT_COMPLETED === "1" ? "" : "What exact greeting should be used?"
};
const research = process.env.FAKE_CODEX_INVALID_RESEARCH === "1" ? { status: "answered" } : {
  status: "answered",
  summary: isResume ? "Refined the investigation" : "Investigated the fixture",
  findings: [{ finding: "The fixture has durable guidance", basis: ["CLAUDE.md"] }],
  recommendations: ["Keep the research path read-only"],
  uncertainties: [],
  follow_up_question: ""
};
const iterationOutcome = process.env.FAKE_CODEX_ITERATION_OUTCOME ?? "converged";
const iteration = {
  outcome: iterationOutcome,
  summary: iterationOutcome === "improved" ? "Improved the implementation" : "The implementation converged",
  changed_files: iterationOutcome === "improved" ? ["autonomous.txt"] : [],
  implementation_decisions: [],
  brief_deviations: [],
  verification: [{ command: "inspect fixture", status: "passed", details: "fixture checked" }],
  remaining_risks: [],
  question: ""
};
const verification = {
  status: process.env.FAKE_CODEX_VERIFICATION_STATUS ?? "passed",
  summary: "Repository-policy smoke checks completed",
  policy_sources: ["AGENTS.md", "package.json"],
  checks: [{ command: "bun run test", status: "passed", details: "fixture passed", basis: "AGENTS.md" }],
  remaining_risks: []
};
if (isIteration && iterationOutcome === "improved" && process.env.FAKE_CODEX_ITERATION_SKIP_WRITE !== "1") {
  appendFileSync("autonomous.txt", "iteration\\n");
}
if (!isBrief && !isResearch && process.env.FAKE_CODEX_COMMIT === "1") {
  writeFileSync("delegated-commit.txt", "unexpected\\n");
  Bun.spawnSync(["git", "add", "delegated-commit.txt"]);
  Bun.spawnSync([
    "git", "-c", "user.name=Delegated Agent", "-c", "user.email=delegated@example.invalid",
    "commit", "-qm", "unexpected delegated commit",
  ]);
}
if (!isBrief && !isResearch && !isIteration && process.env.FAKE_CODEX_PARTIAL_WRITE === "1") {
  writeFileSync("partial-work.txt", "partial implementation\\n");
}
if (isVerification && process.env.FAKE_CODEX_VERIFY_WRITE === "1") {
  writeFileSync("verification-side-effect.txt", "unexpected\\n");
}
if (process.env.FAKE_CODEX_EARLY_EVENTS === "1") {
  if (!(process.env.FAKE_CODEX_NO_IMPLEMENT_THREAD === "1" && !isBrief && !isResume)) {
    process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: isResume ? "thread-resumed" : isBrief ? "thread-compiler" : "thread-implementer" }) + "\\n");
  }
  process.stdout.write(JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: isBrief ? 100 : 200, cached_input_tokens: isBrief ? 25 : 50, output_tokens: isBrief ? 40 : 60 }
  }) + "\\n");
}
if (process.env.FAKE_CODEX_DELAY_MS) await Bun.sleep(Number(process.env.FAKE_CODEX_DELAY_MS));
process.stderr.write("fake codex stderr noise\\n");
writeFileSync(output, JSON.stringify(isBrief ? brief : isResearch ? research : isIteration ? iteration : isVerification ? verification : result));
if (isResearch && process.env.FAKE_CODEX_WRITE === "1") writeFileSync("research-side-effect.txt", "unexpected\\n");
if (process.env.FAKE_CODEX_EARLY_EVENTS !== "1" && !(process.env.FAKE_CODEX_NO_IMPLEMENT_THREAD === "1" && !isBrief && !isResume)) {
  process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: isResume ? "thread-resumed" : isBrief ? "thread-compiler" : "thread-implementer" }) + "\\n");
}
if (process.env.FAKE_CODEX_EARLY_EVENTS !== "1") {
  process.stdout.write(JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: isBrief ? 100 : 200, cached_input_tokens: isBrief ? 25 : 50, output_tokens: isBrief ? 40 : 60 }
  }) + "\\n");
}
`,
  );
  await chmod(fakeCodex, 0o755);
  await git(repo, "init", "-q");
  await git(repo, "add", ".");
  await git(repo, "-c", "user.name=Agent Delegator Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture");
  return {
    repo,
    runs,
    transcript,
    codex: fakeCodex,
    log,
    env: {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      FAKE_CODEX_LOG: log,
      // Keep fixture runs out of the developer's machine-level registry.
      AGENT_DELEGATOR_REGISTRY_PATH: join(root, "registry.jsonl"),
    },
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("agent-delegator CLI", () => {
  test("repairs a unique evidence source mismatch before repairing transcript turns", async () => {
    const { repo, runs, transcript, env } = await fixture();
    const compile = await run(
      [
        "compile",
        "--objective",
        "Repair citation sources",
        "--transcript",
        transcript,
        "--runs-dir",
        runs,
        "--run-id",
        "citation-source-repair",
      ],
      repo,
      { ...env, FAKE_CODEX_CITATION_SOURCE_ID: "source-999", FAKE_CODEX_CITATION_TURN: "1" },
    );

    expect(compile.exitCode).toBe(0);
    const output = JSON.parse(compile.stdout);
    expect(output.citation_source_corrections).toBe(3);
    expect(output.citation_turn_corrections).toBe(3);
    const runDir = join(runs, "citation-source-repair");
    const raw = JSON.parse(await readFile(join(runDir, "attempts", "compile", "001", "output.json"), "utf8"));
    const canonical = JSON.parse(await readFile(join(runDir, "brief.json"), "utf8"));
    expect(raw.decisions[0].sources[0]).toMatchObject({ source_id: "source-999", turn: 1 });
    expect(canonical.decisions[0].sources[0]).toMatchObject({ source_id: "source-001", turn: 2 });
    const sourceCorrections = JSON.parse(
      await readFile(join(runDir, "attempts", "compile", "001", "citation-source-corrections.json"), "utf8"),
    );
    expect(sourceCorrections.corrections).toHaveLength(3);
    expect(sourceCorrections.corrections[0]).toMatchObject({
      cited_source_id: "source-999",
      corrected_source_id: "source-001",
    });
    const events = await readFile(join(runDir, "run-events.jsonl"), "utf8");
    expect(events).toContain('\"citation_source_correction_count\":3');
    expect(events).toContain('\"attempts/compile/001/citation-source-corrections.json\"');
  });

  test("repairs unique transcript turn mismatches while preserving the raw compiler output", async () => {
    const { repo, runs, transcript, env } = await fixture();
    const compile = await run(
      [
        "compile",
        "--objective",
        "Repair citation turns",
        "--transcript",
        transcript,
        "--runs-dir",
        runs,
        "--run-id",
        "citation-repair",
      ],
      repo,
      { ...env, FAKE_CODEX_CITATION_TURN: "1" },
    );

    expect(compile.exitCode).toBe(0);
    expect(JSON.parse(compile.stdout).citation_turn_corrections).toBe(3);
    const runDir = join(runs, "citation-repair");
    const raw = JSON.parse(await readFile(join(runDir, "attempts", "compile", "001", "output.json"), "utf8"));
    const canonical = JSON.parse(await readFile(join(runDir, "brief.json"), "utf8"));
    expect(raw.decisions[0].sources[0].turn).toBe(1);
    expect(canonical.decisions[0].sources[0].turn).toBe(2);
    const correctionArtifact = JSON.parse(
      await readFile(join(runDir, "attempts", "compile", "001", "citation-turn-corrections.json"), "utf8"),
    );
    expect(correctionArtifact.corrections).toHaveLength(3);
    const events = await readFile(join(runDir, "run-events.jsonl"), "utf8");
    expect(events).toContain('"citation_turn_correction_count":3');
    expect(events).toContain('"attempts/compile/001/citation-turn-corrections.json"');
  });

  test("records successful turn corrections even when another citation still rejects the compile", async () => {
    const { repo, runs, transcript, env } = await fixture();
    const compile = await run(
      [
        "compile",
        "--objective",
        "Preserve partial citation repair",
        "--transcript",
        transcript,
        "--runs-dir",
        runs,
        "--run-id",
        "partial-citation-repair",
      ],
      repo,
      {
        ...env,
        FAKE_CODEX_CITATION_TURN: "1",
        FAKE_CODEX_CONSTRAINT_QUOTE: "fabricated constraint quote",
      },
    );

    expect(compile.exitCode).toBe(1);
    expect(compile.stderr).toContain("quote does not occur");
    const runDir = join(runs, "partial-citation-repair");
    const correctionArtifact = JSON.parse(
      await readFile(join(runDir, "attempts", "compile", "001", "citation-turn-corrections.json"), "utf8"),
    );
    expect(correctionArtifact.corrections).toHaveLength(2);
    const events = await readFile(join(runDir, "run-events.jsonl"), "utf8");
    expect(events).toContain('"event":"failed"');
    expect(events).toContain('"citation_turn_correction_count":2');
    expect(events).toContain('"attempts/compile/001/citation-turn-corrections.json"');
  });

  test("stops before compiler spend when the objective appears to delegate integration", async () => {
    const { repo, runs, transcript, env, log } = await fixture();
    const warned = await run(
      [
        "compile", "--objective=Run git push after implementation", "--transcript", transcript,
        "--runs-dir", runs, "--run-id", "policy-preflight",
      ],
      repo,
      env,
    );
    expect(warned.exitCode).toBe(1);
    expect(warned.stderr).toContain("no Codex compiler was invoked");
    expect(warned.stderr).toContain("does not authorize Codex");
    expect(await stat(log).then(() => true, () => false)).toBe(false);
    expect(JSON.parse(await readFile(join(runs, "policy-preflight", "state.json"), "utf8")))
      .toMatchObject({ status: "prepared", attempts: { compile: 0 } });
    expect(JSON.parse(await readFile(join(runs, "policy-preflight", "policy-warnings.json"), "utf8")))
      .toMatchObject({ warnings: [{ source: "objective", action: "push" }] });

    const acknowledged = await run(
      [
        "compile", "--run", "policy-preflight", "--runs-dir", runs,
        "--acknowledge-policy-warning",
      ],
      repo,
      env,
    );
    expect(acknowledged.exitCode).toBe(0);
    expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(1);
  });

  test("runs compile, approval, decision, and resume lifecycle", async () => {
    const { repo, runs, transcript, env, log } = await fixture();
    const compile = await run(
      [
        "compile",
        "--objective",
        "Exercise lifecycle",
        "--transcript",
        transcript,
        "--runs-dir",
        runs,
        "--run-id",
        "lifecycle",
        "--task-type",
        "tooling",
        "--complexity",
        "small",
        "--tags",
        "observability,fixture",
      ],
      repo,
      env,
    );
    expect(compile.exitCode).toBe(0);
    expect(JSON.parse(compile.stdout).status).toBe("compiled");

    const rejectedApproval = await run(["approve", "--run", "lifecycle", "--runs-dir", runs], repo, env);
    expect(rejectedApproval.exitCode).toBe(1);
    expect(rejectedApproval.stderr).toContain("Brief has 1 unresolved item");

    const approval = await run(
      ["approve", "--run", "lifecycle", "--runs-dir", runs, "--allow-unresolved"],
      repo,
      env,
    );
    expect(approval.exitCode).toBe(0);
    expect(JSON.parse(approval.stdout).status).toBe("approved");

    const implementation = await run(["implement", "--run", "lifecycle", "--runs-dir", runs], repo, env);
    expect(implementation.exitCode).toBe(0);
    expect(JSON.parse(implementation.stdout).status).toBe("needs-decision");

    const resumed = await run(
      ["resume", "--run", "lifecycle", "--runs-dir", runs, "--message=Use --allow-base-change literally."],
      repo,
      env,
    );
    expect(resumed.exitCode).toBe(0);
    expect(JSON.parse(resumed.stdout).status).toBe("completed");

    const state = JSON.parse(await readFile(join(runs, "lifecycle", "state.json"), "utf8"));
    expect(state.status).toBe("completed");
    expect(state.compilerSessionId).toBe("thread-compiler");
    expect(state.implementationSessionId).toBe("thread-resumed");
    expect(state.attempts).toEqual({ collect: 1, compile: 1, implement: 1, resume: 1 });
    expect((await stat(join(runs, "lifecycle", "state.json"))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(runs, "lifecycle", "transcript.md"), "utf8")).toContain(
      "Untrusted Claude transcript evidence",
    );

    const calls = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(calls[0]).toContain("read-only");
    expect(calls[1]).toContain("workspace-write");
    expect(calls[1]?.at(-1)).not.toContain("evidence.md");
    expect(calls[1]?.at(-1)).toContain("Implement only the approved Brief");
    expect(calls[2]).toContain("resume");
    expect(calls[2]).toContain("thread-implementer");
    expect(calls[2]).toContain("--config");
    expect(calls[2]).toContain('sandbox_mode="workspace-write"');
    expect(calls[2]?.at(-1)).toContain("Use --allow-base-change literally.");

    const runDir = join(runs, "lifecycle");
    expect(await stat(join(runDir, "attempts", "compile", "001", "output.json"))).toBeDefined();
    expect(await stat(join(runDir, "attempts", "implement", "001", "checkpoint.json"))).toBeDefined();
    expect(await stat(join(runDir, "attempts", "resume", "001", "checkpoint.json"))).toBeDefined();
    for (const stage of ["compile", "implement", "resume"] as const) {
      const metadata = JSON.parse(
        await readFile(join(runDir, "attempts", stage, "001", "attempt-metadata.json"), "utf8"),
      );
      expect(metadata).toMatchObject({ schema_version: "1", stage, attempt: 1 });
      expect(metadata.tool.version).toBe(packageJson.version);
      expect(metadata.tool.revision).toMatch(/^[a-f0-9]{40}$/);
      expect(metadata.tool.checkout_worktree_fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(metadata.tool.artifact_sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(await readFile(join(runDir, "brief.generated.json"), "utf8")).toBe(
      await readFile(join(runDir, "brief.approved.json"), "utf8"),
    );

    const evaluationInput = join(runs, "evaluation-input.json");
    await writeFile(evaluationInput, JSON.stringify({
      schema_version: "1",
      evaluator: "claude-test",
      outcome: "accepted-as-is",
      brief_quality: "accurate",
      implementation_quality: "accepted-as-is",
      communication_quality: "efficient",
      verification: "passed",
      ratings: { requirements_fidelity: 5, implementation_quality: 5, communication_efficiency: 5 },
      issue_categories: [],
      notes: "Fixture accepted.",
      tags: ["automated"],
    }));
    const evaluation = await run(
      ["evaluate", "--run", "lifecycle", "--runs-dir", runs, "--evaluation", evaluationInput],
      repo,
      env,
    );
    expect(evaluation.exitCode).toBe(0);
    const observed = JSON.parse(evaluation.stdout).observation;
    expect(observed.delegation_pattern).toBe("implementation");
    expect(observed.experiment_variant).toBeNull();
    expect(observed.metadata).toEqual({ task_type: "tooling", complexity: "small", tags: ["observability", "fixture"] });
    expect(observed.usage).toEqual({ input_tokens: 500, cached_input_tokens: 125, output_tokens: 160 });
    expect(observed.usage_observed_calls).toBe(3);
    expect(observed.models).toEqual({
      compiler: "codex-default",
      implementation: "codex-default",
      research: null,
    });
    expect(observed.brief_changed_by_claude).toBe(false);
    expect(observed.evaluation.automated.implementation_changed_after_codex).toBe(false);

    const report = await run(["report", "--cwd", repo, "--runs-dir", runs, "--format", "json"], repo, env);
    expect(report.exitCode).toBe(0);
    const reportValue = JSON.parse(report.stdout);
    expect(reportValue.summary).toMatchObject({
      runs: 1,
      evaluated: 1,
      accepted: 1,
      accepted_as_is: 1,
      codex_calls: 3,
      usage_observed_calls: 3,
      token_observation_percent: 100,
    });
    expect(reportValue.breakdowns.task_type).toEqual({ tooling: 1 });
    expect(reportValue.breakdowns.compiler_model).toEqual({ "codex-default": 1 });
    expect(reportValue.breakdowns.implementation_model).toEqual({ "codex-default": 1 });
    expect(reportValue.comparisons.delegation_pattern.implementation).toMatchObject({
      runs: 1,
      evaluated: 1,
      accepted: 1,
      codex_calls: 3,
    });
    expect(reportValue.averages.ratings).toEqual({
      requirements_fidelity: 5,
      implementation_quality: 5,
      communication_efficiency: 5,
      research_quality: null,
    });

    const aggregate = await run(["report", "--all", "--format", "json"], repo, env);
    expect(aggregate.exitCode).toBe(0);
    const aggregateValue = JSON.parse(aggregate.stdout);
    expect(aggregateValue.runs_dirs).toEqual([runs]);
    expect(aggregateValue.unavailable_runs_dirs).toEqual([]);
    expect(aggregateValue.summary.runs).toBe(1);
    expect(aggregateValue.runs[0].runs_dir).toBe(runs);
    expect(await readFile(join(runDir, "run-events.jsonl"), "utf8")).toContain('"stage":"evaluate"');
    expect(await readFile(join(runDir, "run-events.jsonl"), "utf8")).toContain(
      '"attempts/compile/001/attempt-metadata.json"',
    );
  });

  test("runs read-only research, continues it interactively, and records machine history", async () => {
    const { repo, runs, transcript, env, log } = await fixture();
    const started = await run(
      [
        "research", "--objective", "Investigate the fixture", "--transcript", transcript,
        "--runs-dir", runs, "--run-id", "research-flow", "--variant", "one-shot-a",
        "--model", "research-fixture",
      ],
      repo,
      env,
    );
    expect(started.exitCode).toBe(0);
    expect(JSON.parse(started.stdout)).toMatchObject({ status: "completed", research_status: "answered", turn: 1 });

    const continued = await run(
      ["follow-up", "--run", "research-flow", "--message=Check the durable guidance again."],
      resolve(repo, ".."),
      env,
    );
    expect(continued.exitCode).toBe(0);
    expect(JSON.parse(continued.stdout)).toMatchObject({ status: "completed", turn: 2 });

    const state = JSON.parse(await readFile(join(runs, "research-flow", "state.json"), "utf8"));
    expect(state).toMatchObject({
      delegationPattern: "interactive",
      experimentVariant: "one-shot-a",
      researchSessionId: "thread-resumed",
      researchTurnCount: 2,
      compilerModel: null,
      researchModel: "research-fixture",
    });
    const calls = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("read-only");
    expect(calls[1]).toContain('sandbox_mode="read-only"');
    expect(calls[1]).toContain("resume");
    expect(await readFile(join(runs, "research-flow", "research-dialogue.jsonl"), "utf8")).toContain(
      "Check the durable guidance again.",
    );
    expect(JSON.parse(
      await readFile(join(runs, "research-flow", "attempts", "research", "001", "worktree-observation.json"), "utf8"),
    ).changed).toBe(false);

    const evaluationInput = join(runs, "research-evaluation.json");
    await writeFile(evaluationInput, JSON.stringify({
      schema_version: "1",
      evaluator: "claude-test",
      outcome: "accepted-as-is",
      brief_quality: "not-applicable",
      implementation_quality: "not-applicable",
      communication_quality: "efficient",
      verification: "passed",
      ratings: {
        requirements_fidelity: 5,
        communication_efficiency: 5,
        research_quality: 5,
      },
      issue_categories: [],
      notes: "Research fixture accepted.",
      tags: ["research"],
    }));
    const evaluated = await run(
      ["evaluate", "--run", "research-flow", "--evaluation", evaluationInput],
      resolve(repo, ".."),
      env,
    );
    expect(evaluated.exitCode).toBe(0);
    expect(JSON.parse(evaluated.stdout).observation.evaluation.ratings.research_quality).toBe(5);

    const history = await run(["history", "--format", "json", "--pattern", "interactive"], resolve(repo, ".."), env);
    expect(history.exitCode).toBe(0);
    const historyValue = JSON.parse(history.stdout);
    expect(historyValue.runs).toHaveLength(1);
    expect(historyValue.runs[0]).toMatchObject({
      run_id: "research-flow",
      delegation_pattern: "interactive",
      experiment_variant: "one-shot-a",
      status: "completed",
      evaluation: { outcome: "accepted-as-is", ratings: { research_quality: 5 } },
    });

    const report = await run(["report", "--runs-dir", runs, "--format", "json"], repo, env);
    const reportValue = JSON.parse(report.stdout);
    expect(reportValue.breakdowns.delegation_pattern).toEqual({ interactive: 1 });
    expect(reportValue.breakdowns.experiment_variant).toEqual({ "one-shot-a": 1 });
    expect(reportValue.summary.codex_calls).toBe(2);
    expect(reportValue.summary.research_worktree_changes).toBe(0);
    expect(reportValue.comparisons.delegation_pattern.interactive).toMatchObject({
      runs: 1,
      evaluated: 1,
      accepted: 1,
      codex_calls: 2,
      average_ratings: { implementation_quality: null, research_quality: 5 },
    });
    expect(reportValue.comparisons.experiment_variant["one-shot-a"].tracked_invocations).toBe(4);
  });

  test("delegates repository-policy verification without changing implementation lifecycle state", async () => {
    const { repo, runs, transcript, env, log } = await fixture();
    await run(
      [
        "compile", "--objective", "Verify the completed fixture", "--transcript", transcript,
        "--runs-dir", runs, "--run-id", "verification-flow",
      ],
      repo,
      env,
    );
    await run(["approve", "--run", "verification-flow", "--runs-dir", runs, "--allow-unresolved"], repo, env);
    await run(
      ["implement", "--run", "verification-flow", "--runs-dir", runs, "--network-access", "enabled"],
      repo,
      { ...env, FAKE_CODEX_IMPLEMENT_COMPLETED: "1" },
    );

    const verified = await run(
      [
        "verify", "--run", "verification-flow", "--runs-dir", runs,
        "--network-access", "disabled", "--ui-session", "verification-browser-1",
      ],
      repo,
      env,
    );
    expect(verified.exitCode).toBe(0);
    expect(JSON.parse(verified.stdout)).toMatchObject({ status: "completed", verification_status: "passed" });
    const verification = JSON.parse(await readFile(join(runs, "verification-flow", "verification.json"), "utf8"));
    expect(verification.policy_sources).toEqual(["AGENTS.md", "package.json"]);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(calls.at(-1)).toContain("workspace-write");
    expect(calls.at(-1)).toContain("sandbox_workspace_write.network_access=false");
    expect(calls.at(-1)?.at(-1)).toContain("repository's own durable policy");
    expect(calls.at(-1)?.at(-1)).toContain("Sandbox mode: workspace-write");
    expect(calls.at(-1)?.at(-1)).toContain("Sandbox network access: DISABLED");
    expect(calls.at(-1)?.at(-1)).toContain('session "verification-browser-1"');
    const separatedPolicyState = JSON.parse(
      await readFile(join(runs, "verification-flow", "state.json"), "utf8"),
    );
    expect(separatedPolicyState).toMatchObject({
      workspaceWriteNetworkAccess: "enabled",
      verificationNetworkAccess: "disabled",
      verificationUiSession: "verification-browser-1",
      verificationUiSessions: ["verification-browser-1"],
    });

    const clearedHandoff = await run(
      [
        "verify", "--run", "verification-flow", "--runs-dir", runs,
        "--network-access", "disabled", "--ui-session", "none",
      ],
      repo,
      env,
    );
    expect(clearedHandoff.exitCode).toBe(0);
    const clearedState = JSON.parse(await readFile(join(runs, "verification-flow", "state.json"), "utf8"));
    expect(clearedState.verificationUiSession).toBeNull();
    expect(clearedState.verificationUiSessions).toEqual(["verification-browser-1"]);
    const clearedCalls = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(clearedCalls.at(-1)?.at(-1)).toContain("UI session handoff: none was declared");

    const changedNetwork = await run(
      ["verify", "--run", "verification-flow", "--runs-dir", runs, "--network-access", "enabled"],
      repo,
      env,
    );
    expect(changedNetwork.exitCode).toBe(1);
    expect(changedNetwork.stderr).toContain("Verification workspace-write policy is fixed");

    const mutated = await run(
      ["verify", "--run", "verification-flow", "--runs-dir", runs],
      repo,
      { ...env, FAKE_CODEX_VERIFY_WRITE: "1" },
    );
    expect(mutated.exitCode).toBe(1);
    expect(mutated.stderr).toContain("worktree changed during delegated verification");
    const state = JSON.parse(await readFile(join(runs, "verification-flow", "state.json"), "utf8"));
    expect(state).toMatchObject({ status: "completed", verificationStatus: null, verificationCount: 3 });
    expect(state.verificationFailure).toContain("worktree changed during delegated verification");
  });

  test("retries a failed research follow-up without duplicating dialogue", async () => {
    const { repo, runs, transcript, env } = await fixture();
    await run(
      [
        "research", "--objective=Retry research dialogue", "--transcript", transcript,
        "--runs-dir", runs, "--run-id", "research-retry",
      ],
      repo,
      env,
    );
    const failed = await run(
      ["follow-up", "--run", "research-retry", "--runs-dir", runs, "--message=Inspect once more."],
      repo,
      { ...env, FAKE_CODEX_INVALID_RESEARCH: "1" },
    );
    expect(failed.exitCode).toBe(1);
    expect(failed.stderr).toContain("Research result failed validation");

    const retried = await run(
      [
        "follow-up", "--retry", "--run", "research-retry", "--runs-dir", runs,
        "--message=Inspect once more.",
      ],
      repo,
      env,
    );
    expect(retried.exitCode).toBe(0);
    const dialogue = (await readFile(join(runs, "research-retry", "research-dialogue.jsonl"), "utf8"))
      .trim().split("\n");
    expect(dialogue).toHaveLength(1);
  });

  test("runs approved implementation and bounded autonomous improvement turns", async () => {
    const { repo, runs, transcript, env, log } = await fixture();
    await run(
      [
        "compile", "--objective", "Autonomously improve the fixture", "--transcript", transcript,
        "--runs-dir", runs, "--run-id", "autonomous-flow", "--variant", "three-hour-loop",
      ],
      repo,
      env,
    );
    const notReady = await run(
      ["loop", "--run", "autonomous-flow", "--runs-dir", runs],
      repo,
      env,
    );
    expect(notReady.exitCode).toBe(1);
    expect(notReady.stderr).toContain("Run must be approved, completed, or retryable before loop");
    await run(["approve", "--run", "autonomous-flow", "--runs-dir", runs, "--allow-unresolved"], repo, env);
    const invalidLimit = await run(
      ["loop", "--run", "autonomous-flow", "--runs-dir", runs, "--max-turns", "101"],
      repo,
      env,
    );
    expect(invalidLimit.exitCode).toBe(1);
    expect(invalidLimit.stderr).toContain("--max-turns must not exceed 100");
    expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(1);
    const invalidRetry = await run(
      ["loop", "--run", "autonomous-flow", "--runs-dir", runs, "--retry"],
      repo,
      env,
    );
    expect(invalidRetry.exitCode).toBe(1);
    expect(invalidRetry.stderr).toContain("loop --retry is only valid after a failed");

    const limited = await run(
      ["loop", "--run", "autonomous-flow", "--runs-dir", runs, "--max-turns", "2", "--max-minutes", "180"],
      repo,
      { ...env, FAKE_CODEX_IMPLEMENT_COMPLETED: "1", FAKE_CODEX_ITERATION_OUTCOME: "improved" },
    );
    expect(limited.exitCode).toBe(0);
    expect(JSON.parse(limited.stdout)).toMatchObject({
      status: "completed",
      stop_reason: "turn-limit",
      last_outcome: "improved",
      turns_completed: 2,
      total_iterations: 2,
    });

    const converged = await run(
      ["loop", "--run", "autonomous-flow", "--runs-dir", runs, "--max-turns", "3"],
      repo,
      { ...env, FAKE_CODEX_ITERATION_OUTCOME: "converged" },
    );
    expect(converged.exitCode).toBe(0);
    expect(JSON.parse(converged.stdout)).toMatchObject({
      status: "completed",
      stop_reason: "converged",
      last_outcome: "converged",
      turns_completed: 1,
      total_iterations: 3,
    });

    const state = JSON.parse(await readFile(join(runs, "autonomous-flow", "state.json"), "utf8"));
    expect(state).toMatchObject({
      delegationPattern: "autonomous",
      iterationCount: 3,
      autonomousStopReason: "converged",
      status: "completed",
    });
    expect(await readFile(join(repo, "autonomous.txt"), "utf8")).toBe("iteration\niteration\n");
    const events = await readFile(join(runs, "autonomous-flow", "run-events.jsonl"), "utf8");
    expect(events.match(/\"stage\":\"iterate\",\"event\":\"completed\"/g)).toHaveLength(3);
    const loopHistory = (await readFile(join(runs, "autonomous-flow", "loop-history.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line));
    expect(loopHistory.map((entry) => entry.stop_reason)).toEqual(["turn-limit", "converged"]);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(calls).toHaveLength(5);
    expect(calls.slice(2).every((call) => call.includes('sandbox_mode="workspace-write"'))).toBe(true);

    const evaluationInput = join(runs, "autonomous-evaluation.json");
    await writeFile(evaluationInput, JSON.stringify({
      schema_version: "1",
      evaluator: "claude-test",
      outcome: "accepted-as-is",
      brief_quality: "accurate",
      implementation_quality: "accepted-as-is",
      communication_quality: "efficient",
      verification: "passed",
      ratings: {
        requirements_fidelity: 5,
        implementation_quality: 5,
        communication_efficiency: 5,
      },
      issue_categories: [],
      notes: "Autonomous fixture accepted.",
      tags: ["autonomous"],
    }));
    const evaluated = await run(
      ["evaluate", "--run", "autonomous-flow", "--runs-dir", runs, "--evaluation", evaluationInput],
      repo,
      env,
    );
    expect(evaluated.exitCode).toBe(0);
    expect(JSON.parse(evaluated.stdout).observation.evaluation.automated.iteration_attempts).toBe(3);

    const report = await run(["report", "--runs-dir", runs, "--format", "json"], repo, env);
    const observed = JSON.parse(report.stdout);
    expect(observed.breakdowns.delegation_pattern).toEqual({ autonomous: 1 });
    expect(observed.breakdowns.autonomous_stop_reason).toEqual({ converged: 1 });
    expect(observed.comparisons.delegation_pattern.autonomous).toMatchObject({
      runs: 1,
      evaluated: 1,
      accepted: 1,
      codex_calls: 5,
      average_ratings: { implementation_quality: 5, research_quality: null },
    });
    expect(observed.runs[0].attempts.iterate).toBe(3);
    const history = await run(["history", "--format", "json", "--pattern", "autonomous"], repo, env);
    expect(JSON.parse(history.stdout).runs[0]).toMatchObject({
      run_id: "autonomous-flow",
      autonomous_stop_reason: "converged",
      attempts: { iteration_turns: 3 },
      evaluation: { outcome: "accepted-as-is" },
    });

    const falseImprovement = await run(
      ["loop", "--run", "autonomous-flow", "--runs-dir", runs, "--max-turns", "1"],
      repo,
      { ...env, FAKE_CODEX_ITERATION_OUTCOME: "improved", FAKE_CODEX_ITERATION_SKIP_WRITE: "1" },
    );
    expect(falseImprovement.exitCode).toBe(1);
    expect(falseImprovement.stderr).toContain("outcome improved but the worktree did not change");

    const restarted = await run(
      ["implement", "--run", "autonomous-flow", "--runs-dir", runs, "--retry"],
      repo,
      { ...env, FAKE_CODEX_IMPLEMENT_COMPLETED: "1" },
    );
    expect(restarted.exitCode).toBe(0);
    expect(JSON.parse(restarted.stdout)).toMatchObject({ status: "completed", attempt: 2 });
  });

  test("fails closed when a purported read-only researcher changes the worktree", async () => {
    const { repo, runs, transcript, env } = await fixture();
    const researched = await run(
      [
        "research", "--objective", "Detect research drift", "--transcript", transcript,
        "--runs-dir", runs, "--run-id", "research-drift",
      ],
      repo,
      { ...env, FAKE_CODEX_WRITE: "1" },
    );
    expect(researched.exitCode).toBe(1);
    expect(researched.stderr).toContain("worktree changed during read-only research");
    const events = await readFile(join(runs, "research-drift", "run-events.jsonl"), "utf8");
    expect(events).toContain('"failure_category":"repository-drift"');
    expect(events).toContain('"worktree_changed":true');
  });

  test("retries a failed read-only research call without recollecting evidence", async () => {
    const { repo, runs, transcript, env, log } = await fixture();
    const failed = await run(
      [
        "research", "--objective", "Retry research", "--transcript", transcript,
        "--runs-dir", runs, "--run-id", "research-retry",
      ],
      repo,
      { ...env, FAKE_CODEX_INVALID_RESEARCH: "1" },
    );
    expect(failed.exitCode).toBe(1);
    expect(failed.stderr).toContain("Research result failed validation");

    const retried = await run(
      ["research", "--run", "research-retry", "--runs-dir", runs, "--retry"],
      repo,
      env,
    );
    expect(retried.exitCode).toBe(0);
    expect(JSON.parse(retried.stdout)).toMatchObject({ status: "completed", turn: 2 });
    expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(2);
  });

  test("rejects changed approval inputs before invoking the implementer", async () => {
    const { repo, runs, transcript, env, log } = await fixture();
    await run(
      ["compile", "--objective", "Tamper check", "--transcript", transcript, "--runs-dir", runs, "--run-id", "tamper"],
      repo,
      env,
    );
    await run(["approve", "--run", "tamper", "--runs-dir", runs, "--allow-unresolved"], repo, env);
    const evidence = join(runs, "tamper", "evidence.md");
    await writeFile(evidence, `${await readFile(evidence, "utf8")}\nchanged\n`);

    const implementation = await run(["implement", "--run", "tamper", "--runs-dir", runs], repo, env);

    expect(implementation.exitCode).toBe(1);
    expect(implementation.stderr).toContain("evidence.md changed after approval");
    expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(1);
  });

  test("rejects a changed Git HEAD unless explicitly acknowledged", async () => {
    const { repo, runs, transcript, env, log } = await fixture();
    await run(
      ["compile", "--objective", "HEAD check", "--transcript", transcript, "--runs-dir", runs, "--run-id", "head"],
      repo,
      env,
    );
    await run(["approve", "--run", "head", "--runs-dir", runs, "--allow-unresolved"], repo, env);
    await writeFile(join(repo, "later.txt"), "later commit\n");
    await git(repo, "add", "later.txt");
    await git(repo, "-c", "user.name=Agent Delegator Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "later");

    const rejected = await run(["implement", "--run", "head", "--runs-dir", runs], repo, env);
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toContain("Repository HEAD changed after Brief compilation");

    const allowed = await run(
      ["implement", "--run", "head", "--runs-dir", runs, "--allow-base-change"],
      repo,
      env,
    );
    expect(allowed.exitCode).toBe(0);
    expect(JSON.parse(allowed.stdout).status).toBe("needs-decision");
    expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(2);
  });

  test("detects a commit made during delegated workspace-write execution", async () => {
    const { repo, runs, transcript, env } = await fixture();
    await run(
      [
        "compile", "--objective", "Detect delegated commits", "--transcript", transcript,
        "--runs-dir", runs, "--run-id", "delegated-commit",
      ],
      repo,
      env,
    );
    await run(["approve", "--run", "delegated-commit", "--runs-dir", runs, "--allow-unresolved"], repo, env);

    const implementation = await run(
      ["implement", "--run", "delegated-commit", "--runs-dir", runs],
      repo,
      { ...env, FAKE_CODEX_IMPLEMENT_COMPLETED: "1", FAKE_CODEX_COMMIT: "1" },
    );
    expect(implementation.exitCode).toBe(1);
    expect(implementation.stderr).toContain("Repository HEAD changed during workspace-write execution");
    const state = JSON.parse(await readFile(join(runs, "delegated-commit", "state.json"), "utf8"));
    expect(state).toMatchObject({ status: "failed", failurePhase: "implement" });
    const events = await readFile(join(runs, "delegated-commit", "run-events.jsonl"), "utf8");
    expect(events).toContain('"failure_category":"repository-drift"');
  });

  test("rejects concurrent mutation of the same run and removes the lock afterward", async () => {
    const { repo, runs, transcript, env, log } = await fixture();
    await run(
      [
        "compile", "--objective", "Serialize implementations", "--transcript", transcript,
        "--runs-dir", runs, "--run-id", "locked-run",
      ],
      repo,
      env,
    );
    await run(["approve", "--run", "locked-run", "--runs-dir", runs, "--allow-unresolved"], repo, env);
    const lockPath = join(runs, "locked-run", ".operation.lock");
    const firstPromise = run(
      ["implement", "--run", "locked-run", "--runs-dir", runs],
      repo,
      { ...env, FAKE_CODEX_DELAY_MS: "500" },
    );
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await stat(lockPath).then(() => true, () => false)) break;
      await Bun.sleep(10);
    }
    const second = await run(["implement", "--run", "locked-run", "--runs-dir", runs], repo, env);
    expect(second.exitCode).toBe(1);
    expect(second.stderr).toContain("Run is busy with implement");
    const first = await firstPromise;
    expect(first.exitCode).toBe(0);
    expect(await stat(lockPath).then(() => true, () => false)).toBe(false);
    expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(2);
  });

  test("recovers an operation lock whose controller is gone", async () => {
    const { repo, runs, transcript, env } = await fixture();
    await run(
      [
        "compile", "--objective", "Recover a stale lock", "--transcript", transcript,
        "--runs-dir", runs, "--run-id", "stale-lock",
      ],
      repo,
      env,
    );
    await writeFile(join(runs, "stale-lock", ".operation.lock"), JSON.stringify({
      schema_version: "1",
      token: "stale-token",
      pid: 999_999_999,
      command: "compile",
      acquired_at: new Date().toISOString(),
    }));
    const approved = await run(
      ["approve", "--run", "stale-lock", "--runs-dir", runs, "--allow-unresolved"],
      repo,
      env,
    );
    expect(approved.exitCode).toBe(0);
    expect(await stat(join(runs, "stale-lock", ".operation.lock")).then(() => true, () => false)).toBe(false);
  });

  test("prevents workspace-write runs from racing in the same repository", async () => {
    const { repo, runs, transcript, env } = await fixture();
    for (const runId of ["repo-lock-a", "repo-lock-b"]) {
      await run(
        ["compile", "--objective=Repository lock", "--transcript", transcript, "--runs-dir", runs, "--run-id", runId],
        repo,
        env,
      );
      await run(["approve", "--allow-unresolved", "--run", runId, "--runs-dir", runs], repo, env);
    }
    const repositoryLock = join(repo, ".git", "agent-delegator-worktree.lock");
    const first = run(
      ["implement", "--run", "repo-lock-a", "--runs-dir", runs],
      repo,
      { ...env, FAKE_CODEX_DELAY_MS: "600" },
    );
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await stat(repositoryLock).then(() => true, () => false)) break;
      await Bun.sleep(10);
    }

    const second = await run(["implement", "--run", "repo-lock-b", "--runs-dir", runs], repo, env);
    expect(second.exitCode).toBe(1);
    expect(second.stderr).toContain("Repository is busy with implement for run repo-lock-a");
    expect((await first).exitCode).toBe(0);
    expect(await stat(repositoryLock).then(() => true, () => false)).toBe(false);
    expect((await run(["implement", "--run", "repo-lock-b", "--runs-dir", runs], repo, env)).exitCode).toBe(0);
  });

  test("re-binds approval to a moved Git HEAD only when explicitly acknowledged", async () => {
    const { repo, runs, transcript, env, log } = await fixture();
    await run(
      ["compile", "--objective", "Approve base check", "--transcript", transcript, "--runs-dir", runs, "--run-id", "approve-base"],
      repo,
      env,
    );
    await writeFile(join(repo, "between.txt"), "committed between compile and approve\n");
    await git(repo, "add", "between.txt");
    await git(repo, "-c", "user.name=Agent Delegator Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "between");

    const rejected = await run(["approve", "--run", "approve-base", "--runs-dir", runs, "--allow-unresolved"], repo, env);
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toContain("Repository HEAD changed after Brief compilation");
    expect(rejected.stderr).toContain("--allow-base-change");

    const approved = await run(
      ["approve", "--run", "approve-base", "--runs-dir", runs, "--allow-unresolved", "--allow-base-change"],
      repo,
      env,
    );
    expect(approved.exitCode).toBe(0);
    expect(JSON.parse(approved.stdout).status).toBe("approved");

    const implementation = await run(["implement", "--run", "approve-base", "--runs-dir", runs], repo, env);
    expect(implementation.exitCode).toBe(0);
    expect(JSON.parse(implementation.stdout).status).toBe("needs-decision");
    expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(2);
  });

  test("revalidates a hand-fixed Brief without another compiler call", async () => {
    const { repo, runs, transcript, env, log } = await fixture();
    const compile = await run(
      ["compile", "--objective", "Revalidate check", "--transcript", transcript, "--runs-dir", runs, "--run-id", "revalidate"],
      repo,
      { ...env, FAKE_CODEX_CONSTRAINT_QUOTE: "a fabricated quote that matches nothing" },
    );
    expect(compile.exitCode).toBe(1);
    expect(compile.stderr).toContain("cites invalid evidence");

    const seeded = await run(["revalidate", "--run", "revalidate", "--runs-dir", runs], repo, env);
    expect(seeded.exitCode).toBe(1);
    expect(seeded.stderr).toContain("cites invalid evidence");

    const briefPath = join(runs, "revalidate", "brief.json");
    const brief = JSON.parse(await readFile(briefPath, "utf8"));
    brief.constraints[0].sources[0].quote = "must wait for the exact greeting wording";
    await writeFile(briefPath, JSON.stringify(brief, null, 2));

    const revalidated = await run(["revalidate", "--run", "revalidate", "--runs-dir", runs], repo, env);
    expect(revalidated.exitCode).toBe(0);
    expect(JSON.parse(revalidated.stdout).status).toBe("compiled");

    const approved = await run(
      ["approve", "--run", "revalidate", "--runs-dir", runs, "--allow-unresolved"],
      repo,
      env,
    );
    expect(approved.exitCode).toBe(0);
    expect(JSON.parse(approved.stdout).status).toBe("approved");
    expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(1);

    const observed = await run(["status", "--run", "revalidate", "--runs-dir", runs, "--observation"], repo, env);
    const cost = JSON.parse(observed.stdout).observation.controller_cost;
    expect(cost.codex_failures).toBe(1);
    expect(cost.gate_rejections).toBe(1);
    expect(cost.review_surface_bytes.brief_md).toBeGreaterThan(0);
  });

  test("restarts implementation from the approved Brief after a failed resume", async () => {
    const { repo, runs, transcript, env, log } = await fixture();
    await run(
      ["compile", "--objective", "Resume loss check", "--transcript", transcript, "--runs-dir", runs, "--run-id", "resume-loss"],
      repo,
      env,
    );
    await run(["approve", "--run", "resume-loss", "--runs-dir", runs, "--allow-unresolved"], repo, env);
    const first = await run(["implement", "--run", "resume-loss", "--runs-dir", runs], repo, env);
    expect(JSON.parse(first.stdout).status).toBe("needs-decision");

    const failedResume = await run(
      ["resume", "--run", "resume-loss", "--runs-dir", runs, "--message=Use the fixture greeting."],
      repo,
      { ...env, FAKE_CODEX_INVALID_RESULT: "1" },
    );
    expect(failedResume.exitCode).toBe(1);

    const withoutRetry = await run(["implement", "--run", "resume-loss", "--runs-dir", runs], repo, env);
    expect(withoutRetry.exitCode).toBe(1);
    expect(withoutRetry.stderr).toContain("pass --retry after reviewing the worktree");

    const restarted = await run(
      ["implement", "--run", "resume-loss", "--runs-dir", runs, "--retry"],
      repo,
      env,
    );
    expect(restarted.exitCode).toBe(0);
    expect(JSON.parse(restarted.stdout).status).toBe("needs-decision");
    expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(4);
  });

  test("retries a failed resume without duplicating its decision ledger entry", async () => {
    const { repo, runs, transcript, env } = await fixture();
    await run(
      [
        "compile", "--objective", "Retry the same decision", "--transcript", transcript,
        "--runs-dir", runs, "--run-id", "resume-retry-ledger",
      ],
      repo,
      env,
    );
    await run(["approve", "--run", "resume-retry-ledger", "--runs-dir", runs, "--allow-unresolved"], repo, env);
    await run(["implement", "--run", "resume-retry-ledger", "--runs-dir", runs], repo, env);

    const failed = await run(
      [
        "resume", "--run", "resume-retry-ledger", "--runs-dir", runs,
        "--message=Use the fixture greeting.",
      ],
      repo,
      { ...env, FAKE_CODEX_INVALID_RESULT: "1" },
    );
    expect(failed.exitCode).toBe(1);
    const retried = await run(
      [
        "resume", "--run", "resume-retry-ledger", "--runs-dir", runs, "--retry",
        "--message=Use the fixture greeting.",
      ],
      repo,
      env,
    );
    expect(retried.exitCode).toBe(0);
    const ledger = (await readFile(join(runs, "resume-retry-ledger", "decision-ledger.jsonl"), "utf8"))
      .trim().split("\n");
    expect(ledger).toHaveLength(1);
    const state = JSON.parse(await readFile(join(runs, "resume-retry-ledger", "state.json"), "utf8"));
    expect(state.implementationSessionId).toBe("thread-resumed");
  });

  test("force-fails a stuck active run whose controller PID was recycled", async () => {
    const { repo, runs, transcript, env } = await fixture();
    await run(
      ["compile", "--objective", "Force-fail check", "--transcript", transcript, "--runs-dir", runs, "--run-id", "stuck"],
      repo,
      env,
    );
    await run(["approve", "--run", "stuck", "--runs-dir", runs, "--allow-unresolved"], repo, env);
    await run(["implement", "--run", "stuck", "--runs-dir", runs], repo, env);

    const statePath = join(runs, "stuck", "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.status = "implementing";
    state.activeOperation = "implement";
    state.controllerPid = 1;
    await writeFile(statePath, JSON.stringify(state, null, 2));
    const repositoryLock = join(repo, ".git", "agent-delegator-worktree.lock");
    await writeFile(repositoryLock, JSON.stringify({
      schema_version: "1",
      token: "recycled-owner",
      pid: 1,
      command: "implement",
      acquired_at: new Date().toISOString(),
      run_id: "stuck",
    }));

    const unforced = await run(["status", "--run", "stuck", "--runs-dir", runs], repo, env);
    expect(JSON.parse(unforced.stdout).status).toBe("implementing");

    const forced = await run(["status", "--run", "stuck", "--runs-dir", runs, "--force-fail"], repo, env);
    expect(forced.exitCode).toBe(0);
    const forcedState = JSON.parse(forced.stdout);
    expect(forcedState.status).toBe("failed");
    expect(forcedState.failurePhase).toBe("implement");
    expect(await stat(repositoryLock).then(() => true, () => false)).toBe(false);

    const inactive = await run(["status", "--run", "stuck", "--runs-dir", runs, "--force-fail"], repo, env);
    expect(inactive.exitCode).toBe(1);
    expect(inactive.stderr).toContain("--force-fail requires an active run");

    await writeFile(repositoryLock, JSON.stringify({
      schema_version: "1",
      token: "orphaned-after-failure",
      pid: 1,
      command: "implement",
      acquired_at: new Date().toISOString(),
      run_id: "stuck",
    }));
    const unlocked = await run(
      ["status", "--run", "stuck", "--runs-dir", runs, "--force-unlock"],
      repo,
      env,
    );
    expect(unlocked.exitCode).toBe(0);
    expect(JSON.parse(unlocked.stdout).repository_lock_removed).toBe(true);
    expect(await stat(repositoryLock).then(() => true, () => false)).toBe(false);

    const restarted = await run(["implement", "--run", "stuck", "--runs-dir", runs, "--retry"], repo, env);
    expect(restarted.exitCode).toBe(0);
    expect(JSON.parse(restarted.stdout).status).toBe("needs-decision");
  });

  test("keeps Codex stderr out of the controller stream unless opted in", async () => {
    const { repo, runs, transcript, env } = await fixture();
    const suppressed = await run(
      ["compile", "--objective", "Stderr check", "--transcript", transcript, "--runs-dir", runs, "--run-id", "stderr-default"],
      repo,
      env,
    );
    expect(suppressed.exitCode).toBe(0);
    expect(suppressed.stderr).not.toContain("fake codex stderr noise");
    expect(
      await readFile(join(runs, "stderr-default", "attempts", "compile", "001", "stderr.log"), "utf8"),
    ).toContain("fake codex stderr noise");

    const streamed = await run(
      ["compile", "--objective", "Stderr check", "--transcript", transcript, "--runs-dir", runs, "--run-id", "stderr-streamed"],
      repo,
      { ...env, AGENT_DELEGATOR_STREAM_CODEX_STDERR: "1" },
    );
    expect(streamed.exitCode).toBe(0);
    expect(streamed.stderr).toContain("fake codex stderr noise");
  });

  test("persists an isolated Codex home and keyring selection for the whole run", async () => {
    const { repo, runs, transcript, env, log } = await fixture();
    const compiled = await run(
      [
        "compile", "--objective", "Isolated Codex state", "--transcript", transcript,
        "--runs-dir", runs, "--run-id", "isolated-home", "--codex-home", "isolated",
      ],
      repo,
      env,
    );
    expect(compiled.exitCode).toBe(0);
    const state = JSON.parse(await readFile(join(runs, "isolated-home", "state.json"), "utf8"));
    expect(state).toMatchObject({ codexHomeMode: "isolated", codexAuthStore: "keyring" });
    expect(state.codexHome).toBe(join(resolve(runs, ".."), "codex-homes", "isolated-home"));
    expect((await stat(state.codexHome)).mode & 0o777).toBe(0o700);
    const args = JSON.parse((await readFile(log, "utf8")).trim()) as string[];
    expect(args).toContain("--config");
    expect(args).toContain('cli_auth_credentials_store="keyring"');
  });

  test("grants and records narrow extra writable roots for a workspace-write session", async () => {
    const { repo, runs, transcript, env, log } = await fixture();
    const browserState = join(resolve(repo, ".."), "browser-state");
    const smokeLogs = join(resolve(repo, ".."), "smoke-logs");
    await mkdir(browserState);
    await mkdir(smokeLogs);
    const writableRoots = [await realpath(browserState), await realpath(smokeLogs)].sort();
    await run(
      [
        "compile", "--objective", "UI verification handoff", "--transcript", transcript,
        "--runs-dir", runs, "--run-id", "writable-roots",
      ],
      repo,
      env,
    );
    await run(["approve", "--run", "writable-roots", "--runs-dir", runs, "--allow-unresolved"], repo, env);

    const implemented = await run(
      [
        "implement", "--run", "writable-roots", "--runs-dir", runs,
        "--writable-root", smokeLogs, `--writable-root=${browserState}`,
        "--ui-session", "dashboard-smoke-1",
      ],
      repo,
      env,
    );

    expect(implemented.exitCode).toBe(0);
    expect(implemented.stderr).toContain("grants workspace-write access to 2 extra root(s)");
    expect(implemented.stderr).toContain("owner-declared UI session dashboard-smoke-1");
    const state = JSON.parse(await readFile(join(runs, "writable-roots", "state.json"), "utf8"));
    expect(state.workspaceWriteWritableRoots).toEqual(writableRoots);
    expect(state.workspaceWriteUiSession).toBe("dashboard-smoke-1");
    expect(state.workspaceWriteUiSessions).toEqual(["dashboard-smoke-1"]);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(calls.at(-1)).toContain(
      `sandbox_workspace_write.writable_roots=${JSON.stringify(writableRoots)}`,
    );
    expect(calls.at(-1)?.at(-1)).toContain("Sandbox mode: workspace-write");
    expect(calls.at(-1)?.at(-1)).toContain("may prevent launching Chrome");
    expect(calls.at(-1)?.at(-1)).toContain(writableRoots[0]!);
    expect(calls.at(-1)?.at(-1)).toContain('session "dashboard-smoke-1"');
    expect(calls.at(-1)?.at(-1)).toContain("do not launch another browser");

    const resumed = await run(
      [
        "resume", "--run", "writable-roots", "--runs-dir", runs,
        "--message=Use the existing browser session.", "--ui-session=dashboard-smoke-2",
      ],
      repo,
      env,
    );
    expect(resumed.exitCode).toBe(0);
    const resumedCalls = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(resumedCalls.at(-1)).toContain(
      `sandbox_workspace_write.writable_roots=${JSON.stringify(writableRoots)}`,
    );
    expect(resumedCalls.at(-1)?.at(-1)).toContain('session "dashboard-smoke-2"');
    const resumedState = JSON.parse(await readFile(join(runs, "writable-roots", "state.json"), "utf8"));
    expect(resumedState.workspaceWriteUiSession).toBe("dashboard-smoke-2");
    expect(resumedState.workspaceWriteUiSessions).toEqual(["dashboard-smoke-1", "dashboard-smoke-2"]);

    const report = await run(["report", "--runs-dir", runs, "--format", "json"], repo, env);
    const reportValue = JSON.parse(report.stdout);
    expect(reportValue.runs[0].codex_environment.writable_roots).toEqual(writableRoots);
    expect(reportValue.runs[0].codex_environment.ui_session).toBe("dashboard-smoke-2");
    expect(reportValue.runs[0].codex_environment.ui_sessions).toEqual([
      "dashboard-smoke-1", "dashboard-smoke-2",
    ]);
    expect(reportValue.breakdowns.workspace_write_writable_root).toMatchObject({
      [writableRoots[0]!]: 1,
      [writableRoots[1]!]: 1,
    });
    expect(reportValue.breakdowns.implementation_ui_session_handoff).toEqual({
      "dashboard-smoke-1": 1,
      "dashboard-smoke-2": 1,
    });
  });

  test("rejects broad, relative, and missing writable roots before Codex execution", async () => {
    const { repo, runs, transcript, env, log } = await fixture();
    await run(
      ["compile", "--objective=Writable root guard", "--transcript", transcript, "--runs-dir", runs, "--run-id", "root-guard"],
      repo,
      env,
    );
    await run(["approve", "--run", "root-guard", "--runs-dir", runs, "--allow-unresolved"], repo, env);

    for (const [root, message] of [
      ["relative-state", "must be absolute"],
      [resolve(repo, "missing-state"), "must name an existing directory"],
      ["~", "too broad"],
    ] as const) {
      const rejected = await run(
        ["implement", "--run", "root-guard", "--runs-dir", runs, "--writable-root", root],
        repo,
        env,
      );
      expect(rejected.exitCode).toBe(1);
      expect(rejected.stderr).toContain(message);
    }
    const invalidSession = await run(
      ["implement", "--run", "root-guard", "--runs-dir", runs, "--ui-session", "bad session"],
      repo,
      env,
    );
    expect(invalidSession.exitCode).toBe(1);
    expect(invalidSession.stderr).toContain("--ui-session must be none");
    expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(1);
  });

  test("wait settles immediately on inactive runs and recovers dead controllers", async () => {
    const { repo, runs, transcript, env } = await fixture();
    await run(
      ["compile", "--objective", "Wait check", "--transcript", transcript, "--runs-dir", runs, "--run-id", "wait-run"],
      repo,
      env,
    );

    const settled = await run(["wait", "--run", "wait-run", "--runs-dir", runs], repo, env);
    expect(settled.exitCode).toBe(0);
    expect(JSON.parse(settled.stdout).status).toBe("compiled");

    const exited = Bun.spawn(["true"]);
    await exited.exited;
    const statePath = join(runs, "wait-run", "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.status = "implementing";
    state.activeOperation = "implement";
    state.controllerPid = exited.pid;
    await writeFile(statePath, JSON.stringify(state, null, 2));

    const recovered = await run(["wait", "--run", "wait-run", "--runs-dir", runs], repo, env);
    expect(recovered.exitCode).toBe(0);
    const recoveredState = JSON.parse(recovered.stdout);
    expect(recoveredState.status).toBe("failed");
    expect(recoveredState.failurePhase).toBe("implement");
  });

  test("runs an existing-run operation under a listed detached process controller", async () => {
    const { repo, runs, transcript, env } = await fixture();
    const headlessDir = join(runs, "headless-jobs");
    const detachedEnv = { ...env, AGENT_DELEGATOR_HEADLESS_DIR: headlessDir, FAKE_CODEX_DELAY_MS: "300" };
    const collected = await run(
      [
        "collect", "--objective", "Detached compile", "--transcript", transcript,
        "--runs-dir", runs, "--run-id", "detached-compile",
      ],
      repo,
      detachedEnv,
    );
    expect(collected.exitCode).toBe(0);

    const launched = await run(
      [
        "compile", "--run", "detached-compile", "--runs-dir", runs,
        "--detach", "--backend", "process",
      ],
      repo,
      detachedEnv,
    );
    expect(launched.exitCode).toBe(0);
    const launch = JSON.parse(launched.stdout);
    expect(launch).toMatchObject({ backend: "process", status: "running", run_id: "detached-compile" });

    let job: Record<string, unknown> | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const listed = await run(["jobs", "--id", launch.job_id], repo, detachedEnv);
      expect(listed.exitCode).toBe(0);
      job = JSON.parse(listed.stdout).jobs[0];
      if (job?.status === "completed" || job?.status === "failed" || job?.status === "lost") break;
      await Bun.sleep(25);
    }
    expect(job).toMatchObject({ status: "completed", exit_code: 0, command: "compile" });
    expect(JSON.parse(await readFile(join(runs, "detached-compile", "state.json"), "utf8")))
      .toMatchObject({ status: "compiled", controllerPid: null });
    expect(JSON.parse(await readFile(String(job?.stdout_path), "utf8"))).toMatchObject({ status: "compiled" });
    const observed = await run(
      ["status", "--run", "detached-compile", "--runs-dir", runs, "--observation"], repo, detachedEnv,
    );
    expect(JSON.parse(observed.stdout).observation).toMatchObject({
      detached_execution: { jobs: 1, backends: ["process"], job_ids: [launch.job_id] },
      codex_environment: { mode: "shared", auth_store: "auto" },
    });
  });

  test("marks a detached job lost when its launcher exits before recording a controller", async () => {
    const { repo, runs, env } = await fixture();
    const headlessDir = join(runs, "headless-jobs");
    const jobDir = join(headlessDir, "orphaned-launch");
    await mkdir(jobDir, { recursive: true });
    const exited = Bun.spawn(["true"]);
    await exited.exited;
    const now = new Date().toISOString();
    await writeFile(join(jobDir, "job.json"), JSON.stringify({
      schema_version: "1",
      id: "orphaned-launch",
      backend: "process",
      status: "launching",
      command: "compile",
      run_id: "detached-compile",
      run_dir: join(runs, "detached-compile"),
      repo_root: repo,
      launcher_pid: exited.pid,
      controller_pid: null,
      herdr_workspace_id: null,
      herdr_tab_id: null,
      herdr_pane_id: null,
      created_at: now,
      updated_at: now,
      completed_at: null,
      exit_code: null,
      error: null,
      stdout_path: join(jobDir, "stdout.log"),
      stderr_path: join(jobDir, "stderr.log"),
    }));
    const detachedEnv = { ...env, AGENT_DELEGATOR_HEADLESS_DIR: headlessDir };

    const listed = await run(["jobs", "--id", "orphaned-launch"], repo, detachedEnv);
    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(listed.stdout).jobs[0]).toMatchObject({
      status: "lost",
      launcher_pid: null,
      error: "The detached launcher exited before recording a controller; inspect logs and launch the operation again.",
    });
    const active = await run(["jobs", "--active"], repo, detachedEnv);
    expect(JSON.parse(active.stdout).jobs).toHaveLength(0);
    const lateWorker = await run(
      ["jobs", "--id", "orphaned-launch"],
      repo,
      { ...detachedEnv, AGENT_DELEGATOR_HEADLESS_JOB_PATH: join(jobDir, "job.json") },
    );
    expect(lateWorker.exitCode).toBe(1);
    expect(lateWorker.stderr).toContain("ended as lost before the controller was released");
  });

  test.skipIf(process.env.AGENT_DELEGATOR_HERDR_SMOKE !== "1")(
    "runs a detached existing-run operation in a non-focused Herdr tab",
    async () => {
      const { repo, runs, transcript, env } = await fixture();
      const headlessDir = join(runs, "herdr-jobs");
      const detachedEnv = { ...env, AGENT_DELEGATOR_HEADLESS_DIR: headlessDir };
      await run(
        [
          "collect", "--objective", "Herdr detached compile", "--transcript", transcript,
          "--runs-dir", runs, "--run-id", "herdr-compile",
        ],
        repo,
        detachedEnv,
      );
      const launched = await run(
        [
          "compile", "--run", "herdr-compile", "--runs-dir", runs, "--dry-run",
          "--detach", "--backend", "herdr",
        ],
        repo,
        detachedEnv,
      );
      expect(launched.exitCode).toBe(0);
      const launch = JSON.parse(launched.stdout);
      expect(launch).toMatchObject({ backend: "herdr", status: "running" });
      expect(launch.herdr_tab_id).toMatch(/^w\d+:t/);
      try {
        let job: Record<string, unknown> | undefined;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const listed = await run(["jobs", "--id", launch.job_id], repo, detachedEnv);
          job = JSON.parse(listed.stdout).jobs[0];
          if (job?.status === "completed" || job?.status === "failed") break;
          await Bun.sleep(25);
        }
        expect(job).toMatchObject({ status: "completed", backend: "herdr", exit_code: 0 });
      } finally {
        const close = Bun.spawn(["herdr", "tab", "close", launch.herdr_tab_id], {
          stdout: "pipe", stderr: "pipe",
        });
        await close.exited;
      }
    },
  );

  test("quick-path limit flags feed the implicit Context Request", async () => {
    const { repo, runs, transcript, env } = await fixture();
    const capped = await run(
      [
        "compile", "--dry-run", "--objective", "Limit flags", "--transcript", transcript, "--runs-dir", runs,
        "--run-id", "capped", "--max-transcript-input-bytes", "8",
      ],
      repo,
      env,
    );
    expect(capped.exitCode).toBe(1);
    expect(capped.stderr).toContain("max_transcript_input_bytes");

    const conflicting = await run(
      ["compile", "--context", "missing.json", "--max-source-bytes", "8", "--runs-dir", runs, "--dry-run"],
      repo,
      env,
    );
    expect(conflicting.exitCode).toBe(1);
    expect(conflicting.stderr).toContain("Limit flags cannot be combined with --context");
  });

  test("keeps a valid result when checkpoint capture fails after implementation", async () => {
    const { repo, runs, transcript, env } = await fixture();
    await run(
      ["compile", "--objective", "Checkpoint failure check", "--transcript", transcript, "--runs-dir", runs, "--run-id", "checkpointless"],
      repo,
      env,
    );
    await run(["approve", "--run", "checkpointless", "--runs-dir", runs, "--allow-unresolved"], repo, env);
    await writeFile(join(repo, "oversized.bin"), Buffer.alloc(65 * 1024 * 1024, 7));

    const implementation = await run(
      ["implement", "--run", "checkpointless", "--runs-dir", runs, "--allow-worktree-change"],
      repo,
      env,
    );

    expect(implementation.exitCode).toBe(0);
    const output = JSON.parse(implementation.stdout);
    expect(output.status).toBe("needs-decision");
    expect(output.checkpoint_error).toContain("--allow-worktree-change");
    const state = JSON.parse(await readFile(join(runs, "checkpointless", "state.json"), "utf8"));
    expect(state.status).toBe("needs-decision");
  });

  test("supports --help and --version and names a missing run clearly", async () => {
    const { repo, runs, env } = await fixture();

    const version = await run(["--version"], repo, env);
    expect(version.exitCode).toBe(0);
    expect(version.stdout.trim()).toBe(packageJson.version);

    const help = await run(["compile", "--help"], repo, env);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("Usage:");

    const missing = await run(["status", "--run", "no-such-run", "--runs-dir", runs], repo, env);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("Run not found");
  });

  test("rechecks approval inputs and Git HEAD before resume", async () => {
    const { repo, runs, transcript, env, log } = await fixture();
    await run(
      ["compile", "--objective", "Resume guards", "--transcript", transcript, "--runs-dir", runs, "--run-id", "resume-guards"],
      repo,
      env,
    );
    await run(
      ["approve", "--run", "resume-guards", "--runs-dir", runs, "--allow-unresolved"],
      repo,
      env,
    );
    const implementation = await run(
      ["implement", "--run", "resume-guards", "--runs-dir", runs],
      repo,
      env,
    );
    expect(JSON.parse(implementation.stdout).status).toBe("needs-decision");

    const evidence = join(runs, "resume-guards", "evidence.md");
    const originalEvidence = await readFile(evidence, "utf8");
    await writeFile(evidence, `${originalEvidence}\nchanged after implementation\n`);
    const tampered = await run(
      ["resume", "--run", "resume-guards", "--runs-dir", runs, "--message", "Use Hello."],
      repo,
      env,
    );
    expect(tampered.exitCode).toBe(1);
    expect(tampered.stderr).toContain("evidence.md changed after approval");
    expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(2);

    await writeFile(evidence, originalEvidence);
    await writeFile(join(repo, "later.txt"), "later commit\n");
    await git(repo, "add", "later.txt");
    await git(repo, "-c", "user.name=Agent Delegator Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "later");
    const movedHead = await run(
      ["resume", "--run", "resume-guards", "--runs-dir", runs, "--message", "Use Hello."],
      repo,
      env,
    );
    expect(movedHead.exitCode).toBe(1);
    expect(movedHead.stderr).toContain("Repository HEAD changed after Brief compilation");
    expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(2);

    const allowed = await run(
      [
        "resume",
        "--run",
        "resume-guards",
        "--runs-dir",
        runs,
        "--allow-base-change",
        "--message",
        "Use Hello.",
      ],
      repo,
      env,
    );
    expect(allowed.exitCode).toBe(0);
    expect(JSON.parse(allowed.stdout).status).toBe("completed");
    expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(3);
  });

  test("rejects ambiguous text arguments before any Codex invocation", async () => {
    const { repo, runs, transcript, env, log } = await fixture();
    const unexpectedText = await run(
      [
        "compile",
        "--objective",
        "Short",
        "unquoted remainder",
        "--transcript",
        transcript,
        "--runs-dir",
        runs,
      ],
      repo,
      env,
    );
    expect(unexpectedText.exitCode).toBe(1);
    expect(unexpectedText.stderr).toContain("Unexpected argument: unquoted remainder");

    const misplacedOverride = await run(
      ["approve", "--run", "missing", "--runs-dir", runs, "--by", "claude", "--allow-unresolved"],
      repo,
      env,
    );
    expect(misplacedOverride.exitCode).toBe(1);
    expect(misplacedOverride.stderr).toContain("--allow-unresolved must appear before --by");
    await expect(readFile(log, "utf8")).rejects.toThrow();
  });

  test("guards compile flags after a split objective while allowing inline objective syntax", async () => {
    const { repo, runs, transcript, env, log } = await fixture();
    for (const [index, guardedFlag] of ["--no-redact", "--allow-latest-fallback", "--dry-run"].entries()) {
      const rejected = await run(
        [
          "compile",
          "--objective",
          "Short objective",
          guardedFlag,
          "--transcript",
          transcript,
          "--runs-dir",
          runs,
          "--run-id",
          `guarded-${index}`,
        ],
        repo,
        env,
      );
      expect(rejected.exitCode).toBe(1);
      expect(rejected.stderr).toContain(`${guardedFlag} must appear before --objective`);
    }

    const safeInline = await run(
      [
        "compile",
        "--objective=Short objective",
        "--dry-run",
        "--transcript",
        transcript,
        "--runs-dir",
        runs,
        "--run-id",
        "safe-inline",
      ],
      repo,
      env,
    );
    expect(safeInline.exitCode).toBe(0);
    expect(JSON.parse(safeInline.stdout).status).toBe("prepared");
    await expect(readFile(log, "utf8")).rejects.toThrow();
  });

  test("reports schema errors when Claude hand-edits a Brief incorrectly", async () => {
    const { repo, runs, transcript, env, log } = await fixture();
    await run(
      [
        "compile",
        "--objective=Schema validation",
        "--transcript",
        transcript,
        "--runs-dir",
        runs,
        "--run-id",
        "invalid-brief",
      ],
      repo,
      env,
    );
    const briefPath = join(runs, "invalid-brief", "brief.json");
    const brief = JSON.parse(await readFile(briefPath, "utf8")) as Record<string, unknown>;
    delete brief.scope;
    await writeFile(briefPath, `${JSON.stringify(brief, null, 2)}\n`);

    const approval = await run(
      ["approve", "--allow-unresolved", "--run", "invalid-brief", "--runs-dir", runs],
      repo,
      env,
    );
    expect(approval.exitCode).toBe(1);
    expect(approval.stderr).toContain("Brief validation failed");
    expect(approval.stderr).toContain("must have required property 'scope'");
    expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(1);
  });

  test("collects an explicit Context Request before compiling the prepared run", async () => {
    const { repo, runs, transcript, env, log } = await fixture();
    await writeFile(join(repo, "design.md"), "The approved design source\n");
    const contextPath = join(repo, "context-request.json");
    await writeFile(
      contextPath,
      JSON.stringify({
        schema_version: "1",
        objective: "Compile selected evidence",
        project_profile: null,
        profile_topics: [],
        transcripts: [
          {
            kind: "transcript",
            path: transcript,
            from_turn: 2,
            to_turn: 2,
            role: "decision",
            selected_because: "Final decision turn",
          },
        ],
        sources: [
          {
            kind: "file",
            path: "design.md",
            role: "specification",
            selected_because: "Approved design document",
          },
        ],
      }),
    );

    const collected = await run(
      ["collect", "--context", contextPath, "--runs-dir", runs, "--run-id", "context-run"],
      repo,
      env,
    );
    expect(collected.exitCode).toBe(0);
    expect(JSON.parse(collected.stdout).status).toBe("prepared");
    expect(JSON.parse(collected.stdout).sources).toBe(4);
    await expect(readFile(log, "utf8")).rejects.toThrow();

    const bundle = JSON.parse(await readFile(join(runs, "context-run", "evidence-bundle.json"), "utf8"));
    expect(bundle.sources.map((source: { role: string }) => source.role)).toEqual([
      "decision", "policy", "policy", "specification",
    ]);
    const evidence = await readFile(join(runs, "context-run", "evidence.md"), "utf8");
    expect(evidence).toContain("must wait for the exact greeting wording");
    expect(evidence).not.toContain("Add a greeting, but ask which wording to use");
    expect(evidence).toContain("The approved design source");

    const compiled = await run(
      ["compile", "--run", "context-run", "--runs-dir", runs],
      repo,
      env,
    );
    expect(compiled.exitCode).toBe(0);
    expect(JSON.parse(compiled.stdout).status).toBe("compiled");
    expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(1);
  });

  test("anchors the collected Evidence Bundle before compile and approval", async () => {
    const { repo, runs, transcript, env, log } = await fixture();
    const collected = await run(
      [
        "collect",
        "--objective=Detect pre-approval drift",
        "--transcript",
        transcript,
        "--runs-dir",
        runs,
        "--run-id",
        "collection-anchor",
      ],
      repo,
      env,
    );
    expect(collected.exitCode).toBe(0);
    const runDir = join(runs, "collection-anchor");
    const state = JSON.parse(await readFile(join(runDir, "state.json"), "utf8"));
    expect(state.evidenceBundleSha256).toHaveLength(64);

    const bundlePath = join(runDir, "evidence-bundle.json");
    const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
    const snapshotPath = join(runDir, bundle.sources[0].snapshot_path);
    const changedSnapshot = `${await readFile(snapshotPath, "utf8")}changed before compile\n`;
    await writeFile(snapshotPath, changedSnapshot);
    bundle.sources[0].sha256 = new Bun.CryptoHasher("sha256").update(changedSnapshot).digest("hex");
    await writeFile(bundlePath, JSON.stringify(bundle));

    const compile = await run(
      ["compile", "--run", "collection-anchor", "--runs-dir", runs, "--dry-run"],
      repo,
      env,
    );
    expect(compile.exitCode).toBe(1);
    expect(compile.stderr).toContain("evidence-bundle.json changed after collection");
    await expect(readFile(log, "utf8")).rejects.toThrow();

    const secondCollect = await run(
      [
        "collect",
        "--objective=Detect pre-approval drift",
        "--transcript",
        transcript,
        "--runs-dir",
        runs,
        "--run-id",
        "approval-anchor",
      ],
      repo,
      env,
    );
    expect(secondCollect.exitCode).toBe(0);
    const secondCompile = await run(["compile", "--run", "approval-anchor", "--runs-dir", runs], repo, env);
    expect(secondCompile.exitCode).toBe(0);
    const approvalBundlePath = join(runs, "approval-anchor", "evidence-bundle.json");
    const approvalBundle = JSON.parse(await readFile(approvalBundlePath, "utf8"));
    approvalBundle.generated_at = new Date(0).toISOString();
    await writeFile(approvalBundlePath, JSON.stringify(approvalBundle));

    const approval = await run(["approve", "--run", "approval-anchor", "--runs-dir", runs], repo, env);
    expect(approval.exitCode).toBe(1);
    expect(approval.stderr).toContain("evidence-bundle.json changed after collection");
  });

  test("rejects an escaping run id before creating artifacts", async () => {
    const { repo, runs, transcript, env } = await fixture();
    const result = await run(
      ["collect", "--objective=Escape", "--transcript", transcript, "--runs-dir", runs, "--run-id", "../../escape"],
      repo,
      env,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--run-id must be");
  });

  test("rejects dirty-worktree drift after approval unless explicitly reviewed", async () => {
    const { repo, runs, transcript, env, log } = await fixture();
    await run(
      ["compile", "--objective=Dirty guard", "--transcript", transcript, "--runs-dir", runs, "--run-id", "dirty"],
      repo,
      env,
    );
    await run(["approve", "--allow-unresolved", "--run", "dirty", "--runs-dir", runs], repo, env);
    await writeFile(join(repo, "CLAUDE.md"), "# Changed after approval\n");

    const rejected = await run(["implement", "--run", "dirty", "--runs-dir", runs], repo, env);
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toContain("Repository worktree changed");
    expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(1);
    const rejectedState = JSON.parse(await readFile(join(runs, "dirty", "state.json"), "utf8"));
    expect(rejectedState).toMatchObject({ observedWorktreeChangedFileCount: 1 });
    expect(rejectedState.observedWorktreePatchBytes).toBeGreaterThan(0);

    const allowed = await run(
      ["implement", "--allow-worktree-change", "--run", "dirty", "--runs-dir", runs],
      repo,
      env,
    );
    expect(allowed.exitCode).toBe(0);
    expect(allowed.stderr).toContain("--allow-worktree-change accepted 1 changed files");
  });

  test("fails closed on an invalid result and permits an explicit safe retry", async () => {
    const { repo, runs, transcript, env } = await fixture();
    await run(
      ["compile", "--objective=Result validation", "--transcript", transcript, "--runs-dir", runs, "--run-id", "bad-result"],
      repo,
      env,
    );
    await run(["approve", "--allow-unresolved", "--run", "bad-result", "--runs-dir", runs], repo, env);
    const invalid = await run(
      ["implement", "--run", "bad-result", "--runs-dir", runs],
      repo,
      { ...env, FAKE_CODEX_INVALID_RESULT: "1" },
    );
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stderr).toContain("Implementer result failed validation");
    const failedState = JSON.parse(await readFile(join(runs, "bad-result", "state.json"), "utf8"));
    expect(failedState).toMatchObject({ status: "failed", failurePhase: "implement" });

    const retried = await run(
      ["implement", "--retry", "--run", "bad-result", "--runs-dir", runs],
      repo,
      env,
    );
    expect(retried.exitCode).toBe(0);
    expect(JSON.parse(retried.stdout).attempt).toBe(2);
  });

  test("rejects a resumable result without a Codex thread id", async () => {
    const { repo, runs, transcript, env } = await fixture();
    await run(
      ["compile", "--objective=Thread guard", "--transcript", transcript, "--runs-dir", runs, "--run-id", "threadless"],
      repo,
      env,
    );
    await run(["approve", "--allow-unresolved", "--run", "threadless", "--runs-dir", runs], repo, env);
    const result = await run(
      ["implement", "--run", "threadless", "--runs-dir", runs],
      repo,
      { ...env, FAKE_CODEX_NO_IMPLEMENT_THREAD: "1" },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("cannot be resumed because Codex returned no thread ID");
  });

  test("status recovers an interrupted active state", async () => {
    const { repo, runs, transcript, env } = await fixture();
    await run(
      ["collect", "--objective=Recover state", "--transcript", transcript, "--runs-dir", runs, "--run-id", "stale"],
      repo,
      env,
    );
    const statePath = join(runs, "stale", "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    Object.assign(state, { status: "compiling", activeOperation: "compile", controllerPid: 999_999_999 });
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

    const status = await run(["status", "--run", "stale", "--runs-dir", runs], repo, env);
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({ status: "failed", failurePhase: "compile" });
  });

  test("status checkpoints partial work from an interrupted workspace-write controller", async () => {
    const { repo, runs, transcript, env } = await fixture();
    await run(
      ["compile", "--objective=Interrupted salvage", "--transcript", transcript, "--runs-dir", runs, "--run-id", "stale-write"],
      repo,
      env,
    );
    await run(["approve", "--allow-unresolved", "--run", "stale-write", "--runs-dir", runs], repo, env);
    const statePath = join(runs, "stale-write", "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    const approvedFingerprint = state.lastWorktreeSha256;
    Object.assign(state, {
      status: "implementing",
      activeOperation: "implement",
      controllerPid: 999_999_999,
      attempts: { ...state.attempts, implement: 1 },
    });
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    await writeFile(join(repo, "interrupted-work.txt"), "recover me\n");

    const recovered = await run(["status", "--run", "stale-write", "--runs-dir", runs], repo, env);
    expect(recovered.exitCode).toBe(0);
    expect(JSON.parse(recovered.stdout)).toMatchObject({
      status: "failed",
      failurePhase: "implement",
      lastWorktreeSha256: approvedFingerprint,
      observedWorktreeChangedFileCount: 1,
    });
    expect(JSON.parse(recovered.stdout).observedWorktreeSha256).not.toBe(approvedFingerprint);
    expect(JSON.parse(recovered.stdout).failure).toContain("Partial worktree checkpoint saved");
    expect(await readFile(
      join(runs, "stale-write", "attempts", "implement", "001", "worktree.patch"),
      "utf8",
    )).toContain("recover me");
  });

  test("records collection failure state instead of leaving an unclassified run", async () => {
    const { repo, runs, transcript, env } = await fixture();
    const contextPath = join(repo, "bad-context.json");
    await writeFile(contextPath, JSON.stringify({
      schema_version: "1",
      objective: "Record collection failure",
      project_profile: null,
      profile_topics: [],
      transcripts: [{ kind: "transcript", path: transcript }],
      sources: [{ kind: "glob", pattern: "../missing/*.md", required: false }],
    }));

    const result = await run(
      ["collect", "--context", contextPath, "--runs-dir", runs, "--run-id", "collect-failed"],
      repo,
      env,
    );
    expect(result.exitCode).toBe(1);
    const state = JSON.parse(await readFile(join(runs, "collect-failed", "state.json"), "utf8"));
    expect(state).toMatchObject({ status: "failed", failurePhase: "collect", activeOperation: null });
  });

  test("retries a failed read-only compiler call explicitly", async () => {
    const { repo, runs, transcript, env } = await fixture();
    const failed = await run(
      ["compile", "--objective=Compiler retry", "--transcript", transcript, "--runs-dir", runs, "--run-id", "compile-retry"],
      repo,
      { ...env, FAKE_CODEX_INVALID_BRIEF: "1" },
    );
    expect(failed.exitCode).toBe(1);
    expect(failed.stderr).toContain("Generated brief failed validation");

    const retried = await run(
      ["compile", "--retry", "--run", "compile-retry", "--runs-dir", runs],
      repo,
      env,
    );
    expect(retried.exitCode).toBe(0);
    expect(JSON.parse(retried.stdout)).toMatchObject({ status: "compiled", attempt: 2 });
  });

  test("rejects malformed timeouts and checkpoints partial work after a real timeout", async () => {
    const { repo, runs, transcript, env } = await fixture();
    await run(
      ["compile", "--objective=Timeout salvage", "--transcript", transcript, "--runs-dir", runs, "--run-id", "timeout-salvage"],
      repo,
      env,
    );
    await run(["approve", "--allow-unresolved", "--run", "timeout-salvage", "--runs-dir", runs], repo, env);
    const statePath = join(runs, "timeout-salvage", "state.json");
    const approvedState = JSON.parse(await readFile(statePath, "utf8"));

    const malformed = await run(
      ["implement", "--timeout-seconds=60m", "--run", "timeout-salvage", "--runs-dir", runs],
      repo,
      env,
    );
    expect(malformed.exitCode).toBe(1);
    expect(malformed.stderr).toContain("must be an integer");
    expect(JSON.parse(await readFile(statePath, "utf8"))).toMatchObject({ status: "approved" });

    const timedOut = await run(
      ["implement", "--timeout-seconds", "1", "--run", "timeout-salvage", "--runs-dir", runs],
      repo,
      {
        ...env,
        FAKE_CODEX_PARTIAL_WRITE: "1",
        FAKE_CODEX_EARLY_EVENTS: "1",
        FAKE_CODEX_DELAY_MS: "3000",
      },
    );
    expect(timedOut.exitCode).toBe(1);
    expect(timedOut.stderr).toContain("exceeded the 1000ms timeout");
    expect(timedOut.stderr).toContain("partial worktree checkpoint saved");
    const failedState = JSON.parse(await readFile(statePath, "utf8"));
    expect(failedState).toMatchObject({
      status: "failed",
      failurePhase: "implement",
      lastWorktreeSha256: approvedState.lastWorktreeSha256,
      observedWorktreeChangedFileCount: 1,
      implementationSessionId: "thread-implementer",
    });
    const attemptDir = join(runs, "timeout-salvage", "attempts", "implement", "001");
    expect(await readFile(join(attemptDir, "worktree.patch"), "utf8")).toContain("partial implementation");
    expect(JSON.parse(await readFile(join(attemptDir, "checkpoint.json"), "utf8")).changed_files)
      .toContain("partial-work.txt");
    const failedEvent = (await readFile(join(runs, "timeout-salvage", "run-events.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line))
      .findLast((event) => event.stage === "implement" && event.event === "failed");
    expect(failedEvent.usage).toEqual({ input_tokens: 200, cached_input_tokens: 50, output_tokens: 60 });

    const unsafeRetry = await run(
      ["implement", "--retry", "--run", "timeout-salvage", "--runs-dir", runs],
      repo,
      env,
    );
    expect(unsafeRetry.exitCode).toBe(1);
    expect(unsafeRetry.stderr).toContain("Repository worktree changed");
  });

  test("uses an explicitly configured Codex executable", async () => {
    const { repo, runs, transcript, codex, env } = await fixture();
    const result = await run(
      ["compile", "--objective=Configured command", "--transcript", transcript, "--runs-dir", runs, "--run-id", "custom-codex"],
      repo,
      { ...env, AGENT_DELEGATOR_CODEX_COMMAND: codex },
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "compiled" });
  });

  test("rejects conflicting or ignored transcript selectors before collection", async () => {
    const { repo, runs, transcript, env, log } = await fixture();
    const conflict = await run(
      [
        "collect", "--objective=Selector conflict", "--transcript", transcript, "--session-id", "session-1",
        "--runs-dir", runs, "--run-id", "selector-conflict",
      ],
      repo,
      env,
    );
    expect(conflict.exitCode).toBe(1);
    expect(conflict.stderr).toContain("--transcript and --session-id are mutually exclusive");

    const contextPath = join(repo, "context.json");
    await writeFile(contextPath, JSON.stringify({
      schema_version: "1",
      objective: "Context owns selectors",
      project_profile: null,
      profile_topics: [],
      transcripts: [{ kind: "transcript", path: transcript, required: true }],
      sources: [],
    }));
    const ignored = await run(
      ["collect", "--context", contextPath, "--transcript", transcript, "--runs-dir", runs, "--run-id", "ignored-selector"],
      repo,
      env,
    );
    expect(ignored.exitCode).toBe(1);
    expect(ignored.stderr).toContain("configure transcripts in the Context Request");
    expect(await stat(log).then(() => true, () => false)).toBe(false);
  });

  test("refuses to silently discard hand edits to the rendered Brief", async () => {
    const { repo, runs, transcript, env } = await fixture();
    await run(
      ["compile", "--objective=Rendered brief guard", "--transcript", transcript, "--runs-dir", runs, "--run-id", "brief-md-edit"],
      repo,
      env,
    );
    const renderedPath = join(runs, "brief-md-edit", "brief.md");
    await writeFile(renderedPath, `${await readFile(renderedPath, "utf8")}\nmanual edit\n`);

    const rejected = await run(
      ["approve", "--allow-unresolved", "--run", "brief-md-edit", "--runs-dir", runs],
      repo,
      env,
    );
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toContain("brief.md differs from canonical brief.json");
    expect(await readFile(renderedPath, "utf8")).toContain("manual edit");

    expect((await run(["revalidate", "--run", "brief-md-edit", "--runs-dir", runs], repo, env)).exitCode).toBe(0);
    expect((await run(
      ["approve", "--allow-unresolved", "--run", "brief-md-edit", "--runs-dir", runs],
      repo,
      env,
    )).exitCode).toBe(0);
  });

  test("resolves approval runs from an explicit repository cwd", async () => {
    const { repo, transcript, env } = await fixture();
    const compiled = await run(
      ["compile", "--objective=Cwd resolution", "--transcript", transcript, "--run-id", "cwd-run"],
      repo,
      env,
    );
    expect(compiled.exitCode).toBe(0);
    const outside = resolve(repo, "..");
    const approved = await run(
      ["approve", "--cwd", repo, "--allow-unresolved", "--run", "cwd-run"],
      outside,
      env,
    );
    expect(approved.exitCode).toBe(0);
    expect(JSON.parse(approved.stdout)).toMatchObject({ status: "approved" });
  });

  test("uses the invoking subdirectory consistently for latest transcript fallback", async () => {
    const { repo, runs, transcript, env } = await fixture();
    const subdirectory = join(repo, "packages", "fixture");
    const config = join(resolve(repo, ".."), "claude-config");
    const projectDirectory = join(config, "projects", resolve(subdirectory).replace(/[^A-Za-z0-9]/g, "-"));
    await mkdir(subdirectory, { recursive: true });
    await mkdir(join(config, "sessions"), { recursive: true });
    await mkdir(projectDirectory, { recursive: true });
    const fallbackTranscript = join(projectDirectory, "subdirectory-session.jsonl");
    await writeFile(fallbackTranscript, await readFile(transcript, "utf8"));

    const collected = await run(
      [
        "collect", "--cwd", subdirectory, "--objective=Monorepo transcript", "--allow-latest-fallback",
        "--claude-config-dir", config, "--runs-dir", runs, "--run-id", "subdirectory-fallback",
      ],
      repo,
      env,
    );
    expect(collected.exitCode).toBe(0);
    expect(JSON.parse(await readFile(join(runs, "subdirectory-fallback", "state.json"), "utf8")))
      .toMatchObject({ transcriptPath: fallbackTranscript, transcriptResolutionMethod: "latest-for-cwd" });
  });

  test("previews stable visible transcript turns for range selection", async () => {
    const { repo, transcript, env } = await fixture();
    const result = await run(
      ["resolve-transcript", "--transcript", transcript, "--turns", "--json"],
      repo,
      env,
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      path: transcript,
      method: "explicit",
      turns: [
        { turn: 1, source_line: 1, role: "user" },
        { turn: 2, source_line: 2, role: "assistant" },
      ],
    });
  });

  test("preflights the local runtime and configured Codex command", async () => {
    const { repo, codex, env } = await fixture();
    const result = await run(
      ["doctor", "--json"],
      repo,
      { ...env, AGENT_DELEGATOR_CODEX_COMMAND: codex },
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema_version: "1",
      agent_delegator_version: packageJson.version,
      codex: { command: codex, version: "codex-cli fixture" },
    });
  });

  test("rejects unsafe numeric selectors and oversized task metadata", async () => {
    const { repo, runs, transcript, env } = await fixture();
    const unsafeTurn = await run(
      [
        "collect", "--objective=Unsafe turn", "--transcript", transcript, "--runs-dir", runs,
        "--run-id", "unsafe-turn", "--from-turn", "999999999999999999999",
      ],
      repo,
      env,
    );
    expect(unsafeTurn.exitCode).toBe(1);
    expect(unsafeTurn.stderr).toContain("--from-turn must be a positive integer");

    const tooManyTags = Array.from({ length: 33 }, (_, index) => `tag-${index}`).join(",");
    const oversizedMetadata = await run(
      [
        "collect", "--objective=Oversized metadata", "--transcript", transcript, "--runs-dir", runs,
        "--run-id", "oversized-metadata", "--tags", tooManyTags,
      ],
      repo,
      env,
    );
    expect(oversizedMetadata.exitCode).toBe(1);
    expect(oversizedMetadata.stderr).toContain("--tags accepts at most 32");
  });
});
