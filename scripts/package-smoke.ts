import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

interface CommandResult {
  stdout: string;
  stderr: string;
}

async function run(
  command: string[],
  cwd: string,
  env: Record<string, string | undefined> = process.env,
): Promise<CommandResult> {
  const child = Bun.spawn(command, { cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} exited with ${exitCode}\n${stdout}\n${stderr}`);
  }
  return { stdout, stderr };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const packageRoot = resolve(import.meta.dir, "..");
const temporaryRoot = await mkdtemp(join(tmpdir(), "agent-delegator-package-"));

try {
  const tarball = join(temporaryRoot, "agent-delegator-package-smoke.tgz");
  await run([process.execPath, "pm", "pack", "--filename", tarball], packageRoot);
  const archive = await run(["tar", "-tzf", tarball], temporaryRoot);
  const entries = archive.stdout.split(/\r?\n/).filter(Boolean);
  for (const required of [
    "package/bin/agent-delegator.cjs",
    "package/dist/agent-delegator",
    "package/prompts/compile-brief.md",
    "package/prompts/implement.md",
    "package/prompts/iterate.md",
    "package/prompts/research.md",
    "package/schemas/brief.schema.json",
    "package/schemas/research-result.schema.json",
    "package/schemas/iteration-result.schema.json",
    "package/schemas/result.schema.json",
    "package/README.md",
    "package/LICENSE",
  ]) {
    assert(entries.includes(required), `Packed archive is missing ${required}`);
  }
  for (const forbidden of ["/src/", "/test/", "/scripts/", "CLAUDE_ACCEPTANCE_REPORT.md"]) {
    assert(!entries.some((entry) => entry.includes(forbidden)), `Packed archive unexpectedly includes ${forbidden}`);
  }

  const consumer = join(temporaryRoot, "consumer");
  await mkdir(consumer);
  await writeFile(join(consumer, "package.json"), '{"name":"package-smoke","private":true}\n');
  await run([process.execPath, "add", "--offline", tarball], consumer);

  const fixture = join(temporaryRoot, "fixture");
  const binDirectory = join(temporaryRoot, "bin");
  const runs = join(temporaryRoot, "runs");
  const transcript = join(temporaryRoot, "transcript.jsonl");
  await mkdir(fixture);
  await mkdir(binDirectory);
  await writeFile(join(fixture, "CLAUDE.md"), "# Package smoke fixture\n");
  await writeFile(join(fixture, "AGENTS.md"), "Do not commit or modify external state.\n");
  await writeFile(
    transcript,
    [
      JSON.stringify({ type: "user", message: { content: "Verify the installed package." } }),
      JSON.stringify({ type: "assistant", message: { content: "Package smoke decision is accepted." } }),
    ].join("\n"),
  );
  const fakeCodex = join(binDirectory, "codex");
  await writeFile(
    fakeCodex,
    `#!/usr/bin/env bun
import { existsSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const output = args[args.indexOf("--output-last-message") + 1];
const schema = args[args.indexOf("--output-schema") + 1];
const prompt = args.at(-1);
const promptPath = /^Read and follow (.+)\\.\\n/m.exec(prompt)?.[1];
if (!existsSync(schema) || !promptPath || !existsSync(promptPath)) process.exit(2);
writeFileSync(output, JSON.stringify({
  schema_version: "1",
  objective: "Verify the installed package",
  motivation: "Exercise packaged runtime assets",
  current_behavior: ["Package has not been exercised"],
  desired_behavior: ["Packaged compile succeeds"],
  decisions: [{
    statement: "Run the package smoke verification",
    status: "accepted",
    rationale: "The package must retain its runtime assets",
    sources: [{ source_id: "source-001", turn: 2, quote: "Package smoke decision is accepted" }]
  }],
  constraints: [{
    level: "must",
    rule: "Use the installed runtime assets",
    rationale: "Source-tree paths are unavailable after installation",
    failure_mode: "Compilation cannot locate its prompt or schema",
    sources: [{ source_id: "source-001", turn: 2, quote: "Package smoke decision is accepted" }]
  }],
  scope: { in_scope: ["packaged CLI"], out_of_scope: ["repository edits"] },
  implementation_guidance: [],
  acceptance_criteria: ["The compile command reaches compiled status"],
  verification: ["Inspect the run state"],
  escalation_conditions: [],
  unresolved_items: []
}));
process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "package-smoke-compiler" }) + "\\n");
process.stdout.write(JSON.stringify({
  type: "turn.completed",
  usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 }
}) + "\\n");
`,
  );
  await chmod(fakeCodex, 0o755);
  await run(["git", "init", "-q"], fixture);
  await run(["git", "add", "."], fixture);
  await run(
    ["git", "-c", "user.name=Package Smoke", "-c", "user.email=smoke@example.invalid", "commit", "-qm", "fixture"],
    fixture,
  );

  const installedCli = join(consumer, "node_modules", ".bin", "agent-delegator");
  // Invoke the launcher through an absolute interpreter path so only `bun` lookup depends on the
  // restricted PATH; `env node` disappearing as well would mask the message under test.
  const noBun = Bun.spawnSync([process.execPath, installedCli, "--version"], {
    cwd: consumer,
    env: { ...process.env, PATH: "/usr/bin:/bin" },
    stdout: "pipe",
    stderr: "pipe",
  });
  assert(noBun.exitCode === 127, "Launcher without Bun on PATH did not exit 127");
  assert(
    noBun.stderr.toString().includes("requires Bun"),
    "Launcher without Bun on PATH did not print the installation instruction",
  );

  const smokeEnv = {
    ...process.env,
    PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ""}`,
    AGENT_DELEGATOR_REGISTRY_PATH: join(fixture, "registry.jsonl"),
  };
  const compiled = await run(
    [
      installedCli,
      "compile",
      "--objective=Verify the installed package",
      "--transcript",
      transcript,
      "--runs-dir",
      runs,
      "--run-id",
      "package-smoke",
    ],
    fixture,
    smokeEnv,
  );
  assert(JSON.parse(compiled.stdout).status === "compiled", "Installed CLI did not compile successfully");
  const history = await run([installedCli, "history", "--format", "json"], consumer, smokeEnv);
  const historyRuns = JSON.parse(history.stdout).runs;
  assert(
    historyRuns.length === 1 && historyRuns[0].run_id === "package-smoke" && historyRuns[0].status === "compiled",
    "Installed CLI did not retain the machine-level run history",
  );
  const metadata = JSON.parse(
    await readFile(join(runs, "package-smoke", "attempts", "compile", "001", "attempt-metadata.json"), "utf8"),
  );
  assert(metadata.tool.revision === null, "Installed package unexpectedly resolved a Git revision");
  assert(
    /^[a-f0-9]{64}$/.test(metadata.tool.artifact_sha256),
    "Installed package did not record its bundle SHA-256",
  );
  process.stdout.write("package smoke passed\n");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
