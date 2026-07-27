import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { once } from "node:events";

export interface CodexRunResult {
  exitCode: number;
  threadId: string | null;
  usage: CodexUsage | null;
}

export interface CodexUsage {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
}

export async function runCodex(
  args: string[],
  options: {
    cwd: string;
    eventsPath: string;
    stderrPath?: string;
    timeoutMs?: number;
    killGraceMs?: number;
    streamStderr?: boolean;
    command?: string;
  },
): Promise<CodexRunResult> {
  const child = spawn(options.command ?? "codex", args, {
    cwd: options.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const events = createWriteStream(options.eventsPath, { encoding: "utf8", mode: 0o600 });
  const stderr = options.stderrPath
    ? createWriteStream(options.stderrPath, { encoding: "utf8", mode: 0o600 })
    : null;
  let pending = "";
  let threadId: string | null = null;
  let usage: CodexUsage | null = null;
  const observeEvent = (line: string): void => {
    const event = JSON.parse(line) as {
      type?: string;
      thread_id?: string;
      usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number };
    };
    if (event.type === "thread.started" && event.thread_id) threadId = event.thread_id;
    if (event.usage) {
      usage ??= { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
      usage.input_tokens += event.usage.input_tokens ?? 0;
      usage.cached_input_tokens += event.usage.cached_input_tokens ?? 0;
      usage.output_tokens += event.usage.output_tokens ?? 0;
    }
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    events.write(chunk);
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        observeEvent(line);
      } catch {
        // The complete stream remains available in events.jsonl for diagnostics.
      }
    }
  });
  child.stderr.on("data", (chunk: string) => {
    // Codex stderr is retained in stderr.log; live streaming is opt-in because the noise lands in
    // the delegating agent's context on every call.
    if (options.streamStderr) process.stderr.write(chunk);
    stderr?.write(chunk);
  });
  let spawnError: Error | null = null;
  let timedOut = false;
  let interruptedSignal: NodeJS.Signals | null = null;
  const terminate = (signal: NodeJS.Signals): void => {
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {
        // Fall back to the direct child if the process group no longer exists.
      }
    }
    child.kill(signal);
  };
  // A Codex that traps the polite signal must not leave the controller waiting forever or a
  // detached process editing the worktree; SIGKILL on the group cannot be trapped.
  let killTimer: NodeJS.Timeout | null = null;
  const escalate = (signal: NodeJS.Signals): void => {
    terminate(signal);
    killTimer ??= setTimeout(() => terminate("SIGKILL"), options.killGraceMs ?? 10_000);
  };
  const forwardSignal = (signal: NodeJS.Signals): void => {
    interruptedSignal = signal;
    escalate(signal);
  };
  const onSigint = (): void => forwardSignal("SIGINT");
  const onSigterm = (): void => forwardSignal("SIGTERM");
  const onSighup = (): void => forwardSignal("SIGHUP");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  process.once("SIGHUP", onSighup);
  const timeout = options.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        escalate("SIGTERM");
      }, options.timeoutMs)
    : null;
  const exitCode = await new Promise<number>((resolvePromise) => {
    let exitedCode: number | null = null;
    let settled = false;
    const settle = (code: number): void => {
      if (settled) return;
      settled = true;
      resolvePromise(code);
    };
    child.on("error", (error) => {
      spawnError = error;
      settle(127);
    });
    child.on("exit", (code) => {
      // close waits for stdio to drain; a grandchild holding the inherited pipe after the child
      // died must not hang the controller.
      exitedCode = code ?? 1;
      const guard = setTimeout(() => settle(exitedCode ?? 1), 5_000);
      guard.unref?.();
    });
    child.on("close", (code) => settle(code ?? exitedCode ?? 1));
  });
  if (timeout) clearTimeout(timeout);
  if (killTimer) clearTimeout(killTimer);
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);
  process.off("SIGHUP", onSighup);
  events.end();
  stderr?.end();
  await Promise.all([once(events, "finish"), ...(stderr ? [once(stderr, "finish")] : [])]);
  if (pending.trim()) {
    try {
      observeEvent(pending);
    } catch {
      // Preserve malformed final content in events.jsonl; it is diagnostic, not control data.
    }
  }
  if (spawnError) throw spawnError;
  if (timedOut) throw new Error(`Codex exceeded the ${options.timeoutMs}ms timeout`);
  if (interruptedSignal) throw new Error(`Codex was interrupted by ${interruptedSignal}`);
  return { exitCode, threadId, usage };
}
