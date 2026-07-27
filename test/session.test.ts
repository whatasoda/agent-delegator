import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveClaudeTranscript } from "../src/session.js";

const temporaryDirectories: string[] = [];

async function temporaryClaudeConfig(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "agent-delegator-session-"));
  temporaryDirectories.push(path);
  await mkdir(join(path, "projects"), { recursive: true });
  await mkdir(join(path, "sessions"), { recursive: true });
  return path;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("resolveClaudeTranscript", () => {
  test("returns an explicit transcript", async () => {
    const config = await temporaryClaudeConfig();
    const transcript = join(config, "explicit.jsonl");
    await writeFile(transcript, "{}\n");

    const result = await resolveClaudeTranscript({ cwd: process.cwd(), transcriptPath: transcript });

    expect(result).toEqual({
      path: transcript,
      sessionId: null,
      sessionCwd: null,
      method: "explicit",
    });
  });

  test("finds a direct project transcript by session id", async () => {
    const config = await temporaryClaudeConfig();
    const cwd = resolve("/tmp/example-project");
    const projectDirectory = join(config, "projects", cwd.replaceAll("/", "-"));
    await mkdir(projectDirectory, { recursive: true });
    const transcript = join(projectDirectory, "session-123.jsonl");
    await writeFile(transcript, "{}\n");

    const result = await resolveClaudeTranscript({
      cwd,
      sessionId: "session-123",
      claudeConfigDir: config,
    });

    expect(result.path).toBe(transcript);
    expect(result.method).toBe("session-id");
  });

  test("uses sessions-index when the direct name is absent", async () => {
    const config = await temporaryClaudeConfig();
    const cwd = resolve("/tmp/indexed-project");
    const projectDirectory = join(config, "projects", cwd.replaceAll("/", "-"));
    await mkdir(projectDirectory, { recursive: true });
    const transcript = join(projectDirectory, "renamed.jsonl");
    await writeFile(transcript, "{}\n");
    await writeFile(
      join(projectDirectory, "sessions-index.json"),
      JSON.stringify({ entries: [{ sessionId: "indexed-123", fullPath: transcript }] }),
    );

    const result = await resolveClaudeTranscript({
      cwd,
      sessionId: "indexed-123",
      claudeConfigDir: config,
    });

    expect(result.path).toBe(transcript);
  });

  test("resolves the active session from a parent PID record", async () => {
    const config = await temporaryClaudeConfig();
    const cwd = resolve("/tmp/active-project");
    const projectDirectory = join(config, "projects", cwd.replaceAll("/", "-"));
    await mkdir(projectDirectory, { recursive: true });
    const transcript = join(projectDirectory, "active-123.jsonl");
    await writeFile(transcript, "{}\n");
    await writeFile(
      join(config, "sessions", "4242.json"),
      JSON.stringify({ sessionId: "active-123", cwd }),
    );

    const result = await resolveClaudeTranscript({
      cwd,
      claudeConfigDir: config,
      startPid: 4242,
      allowLatestFallback: false,
    });

    expect(result.path).toBe(transcript);
    expect(result.method).toBe("process-tree");
  });

  test("encodes dots and underscores like Claude Code when locating project directories", async () => {
    const config = await temporaryClaudeConfig();
    const cwd = resolve("/tmp/dotted.project_name");
    const projectDirectory = join(config, "projects", "-tmp-dotted-project-name");
    await mkdir(projectDirectory, { recursive: true });
    const transcript = join(projectDirectory, "latest.jsonl");
    await writeFile(transcript, "{}\n");

    await expect(
      resolveClaudeTranscript({
        cwd,
        claudeConfigDir: config,
        startPid: 999_999,
        allowLatestFallback: true,
      }),
    ).resolves.toMatchObject({ path: transcript, method: "latest-for-cwd" });
  });

  test("uses newest-transcript fallback only when explicitly enabled", async () => {
    const config = await temporaryClaudeConfig();
    const cwd = resolve("/tmp/fallback-project");
    const projectDirectory = join(config, "projects", cwd.replaceAll("/", "-"));
    await mkdir(projectDirectory, { recursive: true });
    const transcript = join(projectDirectory, "latest.jsonl");
    await writeFile(transcript, "{}\n");

    await expect(
      resolveClaudeTranscript({ cwd, claudeConfigDir: config, startPid: 999_999 }),
    ).rejects.toThrow("Could not resolve the current Claude transcript");
    await expect(
      resolveClaudeTranscript({
        cwd,
        claudeConfigDir: config,
        startPid: 999_999,
        allowLatestFallback: true,
      }),
    ).resolves.toMatchObject({ path: transcript, method: "latest-for-cwd" });
  });
});
