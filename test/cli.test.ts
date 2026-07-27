import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify(args) + "\\n");
const outputIndex = args.indexOf("--output-last-message");
const output = args[outputIndex + 1];
const isResume = args.includes("resume");
const isBrief = args.some((arg) => arg.endsWith("brief.schema.json"));
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
  status: isResume ? "completed" : "needs-decision",
  summary: isResume ? "Applied the supplied decision" : "Waiting for wording",
  changed_files: [],
  implementation_decisions: [],
  brief_deviations: [],
  verification: [],
  remaining_risks: [],
  question: isResume ? "" : "What exact greeting should be used?"
};
writeFileSync(output, JSON.stringify(isBrief ? brief : result));
if (!(process.env.FAKE_CODEX_NO_IMPLEMENT_THREAD === "1" && !isBrief && !isResume)) {
  process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: isResume ? "thread-resumed" : isBrief ? "thread-compiler" : "thread-implementer" }) + "\\n");
}
process.stdout.write(JSON.stringify({
  type: "turn.completed",
  usage: { input_tokens: isBrief ? 100 : 200, cached_input_tokens: isBrief ? 25 : 50, output_tokens: isBrief ? 40 : 60 }
}) + "\\n");
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
    log,
    env: { PATH: `${bin}:${process.env.PATH ?? ""}`, FAKE_CODEX_LOG: log },
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
    expect(state.implementationSessionId).toBe("thread-implementer");
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
    expect(observed.metadata).toEqual({ task_type: "tooling", complexity: "small", tags: ["observability", "fixture"] });
    expect(observed.usage).toEqual({ input_tokens: 500, cached_input_tokens: 125, output_tokens: 160 });
    expect(observed.usage_observed_calls).toBe(3);
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
    expect(reportValue.averages.ratings).toEqual({
      requirements_fidelity: 5,
      implementation_quality: 5,
      communication_efficiency: 5,
    });
    expect(await readFile(join(runDir, "run-events.jsonl"), "utf8")).toContain('"stage":"evaluate"');
    expect(await readFile(join(runDir, "run-events.jsonl"), "utf8")).toContain(
      '"attempts/compile/001/attempt-metadata.json"',
    );
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
    expect(JSON.parse(collected.stdout).sources).toBe(2);
    await expect(readFile(log, "utf8")).rejects.toThrow();

    const bundle = JSON.parse(await readFile(join(runs, "context-run", "evidence-bundle.json"), "utf8"));
    expect(bundle.sources.map((source: { role: string }) => source.role)).toEqual(["decision", "specification"]);
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

    const allowed = await run(
      ["implement", "--allow-worktree-change", "--run", "dirty", "--runs-dir", runs],
      repo,
      env,
    );
    expect(allowed.exitCode).toBe(0);
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
});
