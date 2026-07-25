import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCodex } from "../src/codex.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("runCodex", () => {
  test("streams JSONL events and extracts the thread id", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "agent-delegator-codex-"));
    temporaryDirectories.push(cwd);
    const eventsPath = join(cwd, "events.jsonl");
    const result = await runCodex(
      [
        "-c",
        "printf '%s\\n' '{\"type\":\"thread.started\",\"thread_id\":\"thread-123\"}' '{\"type\":\"turn.completed\"}'",
      ],
      { cwd, eventsPath, command: "/bin/sh" },
    );

    expect(result).toEqual({ exitCode: 0, threadId: "thread-123", usage: null });
    expect(await readFile(eventsPath, "utf8")).toContain('"turn.completed"');
  });

  test("extracts a thread id from a final line without a newline", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "agent-delegator-codex-"));
    temporaryDirectories.push(cwd);
    const eventsPath = join(cwd, "events.jsonl");

    const result = await runCodex(
      ["-c", "printf '%s' '{\"type\":\"thread.started\",\"thread_id\":\"thread-final\"}'"],
      { cwd, eventsPath, command: "/bin/sh" },
    );

    expect(result).toEqual({ exitCode: 0, threadId: "thread-final", usage: null });
    expect(await readFile(eventsPath, "utf8")).toContain("thread-final");
  });

  test("returns a non-zero exit code while preserving diagnostic output", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "agent-delegator-codex-"));
    temporaryDirectories.push(cwd);
    const eventsPath = join(cwd, "events.jsonl");

    const result = await runCodex(["-c", "printf 'not-json'; exit 7"], {
      cwd,
      eventsPath,
      command: "/bin/sh",
    });

    expect(result).toEqual({ exitCode: 7, threadId: null, usage: null });
    expect(await readFile(eventsPath, "utf8")).toBe("not-json");
  });

  test("extracts token usage from Codex events", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "agent-delegator-codex-"));
    temporaryDirectories.push(cwd);
    const eventsPath = join(cwd, "events.jsonl");
    const event = JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 120, cached_input_tokens: 40, output_tokens: 30 },
    });

    const result = await runCodex(["-c", `printf '%s\\n' '${event}'`], {
      cwd,
      eventsPath,
      command: "/bin/sh",
    });

    expect(result.usage).toEqual({ input_tokens: 120, cached_input_tokens: 40, output_tokens: 30 });
  });

  test("rejects when the Codex executable cannot be spawned", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "agent-delegator-codex-"));
    temporaryDirectories.push(cwd);
    const eventsPath = join(cwd, "events.jsonl");

    await expect(
      runCodex([], { cwd, eventsPath, command: join(cwd, "missing-codex") }),
    ).rejects.toThrow();
  });

  test("persists stderr privately and terminates a timed-out invocation", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "agent-delegator-codex-"));
    temporaryDirectories.push(cwd);
    const eventsPath = join(cwd, "events.jsonl");
    const stderrPath = join(cwd, "stderr.log");

    await expect(
      runCodex(["-c", "printf 'diagnostic' >&2; sleep 2"], {
        cwd,
        eventsPath,
        stderrPath,
        timeoutMs: 20,
        command: "/bin/sh",
      }),
    ).rejects.toThrow("timeout");
    expect(await readFile(stderrPath, "utf8")).toContain("diagnostic");
    expect((await stat(stderrPath)).mode & 0o777).toBe(0o600);
  });
});
