import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat, readlink, realpath } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const gitOutputLimitBytes = 64 * 1024 * 1024;

function actionableGitOutputError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || /maxBuffer length exceeded/i.test(message)) {
    return new Error(
      "Worktree observation exceeded the 64 MiB Git output limit; remove or ignore generated/large untracked files, or checkpoint them outside this run before retrying",
    );
  }
  return error instanceof Error ? error : new Error(message);
}

async function mapBounded<T, U>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(values.length);
  let nextIndex = 0;
  // Not one Promise per untracked file: large generated trees otherwise multiply Git buffers and exhaust memory.
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await operation(values[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function gitValue(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

export async function repositoryRoot(cwd: string): Promise<string> {
  return realpath(await gitValue(cwd, "rev-parse", "--show-toplevel"));
}

export async function worktreeFingerprint(repoRoot: string): Promise<string> {
  try {
    const hash = createHash("sha256");
    const { stdout: diff } = await execFileAsync(
      "git",
      ["diff", "--binary", "--no-ext-diff", "HEAD", "--"],
      { cwd: repoRoot, encoding: "buffer", maxBuffer: gitOutputLimitBytes },
    );
    hash.update(diff);
    const { stdout: untrackedOutput } = await execFileAsync(
      "git",
      ["ls-files", "--others", "--exclude-standard", "-z"],
      { cwd: repoRoot, encoding: "buffer", maxBuffer: gitOutputLimitBytes },
    );
    const paths = untrackedOutput.toString("utf8").split("\0").filter(Boolean).sort();
    for (const path of paths) {
      const fullPath = `${repoRoot}/${path}`;
      const metadata = await lstat(fullPath);
      hash.update(`\0${path}\0${metadata.mode}\0`);
      if (metadata.isSymbolicLink()) hash.update(await readlink(fullPath));
      else for await (const chunk of createReadStream(fullPath)) hash.update(chunk as Buffer);
    }
    return hash.digest("hex");
  } catch (error) {
    throw actionableGitOutputError(error);
  }
}

export async function worktreeObservation(repoRoot: string): Promise<{
  head: string;
  fingerprint: string;
  status: string;
  patch: string;
  changedFiles: string[];
}> {
  try {
    for (let captureAttempt = 1; captureAttempt <= 3; captureAttempt += 1) {
    const [headBefore, fingerprintBefore] = await Promise.all([
      gitValue(repoRoot, "rev-parse", "HEAD"),
      worktreeFingerprint(repoRoot),
    ]);
    const [{ stdout: statusOutput }, { stdout: trackedPatch }, { stdout: trackedNames }, { stdout: untrackedOutput }] = await Promise.all([
      execFileAsync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
        cwd: repoRoot,
        maxBuffer: gitOutputLimitBytes,
      }),
      execFileAsync("git", ["diff", "--binary", "--no-ext-diff", "HEAD", "--"], {
        cwd: repoRoot,
        maxBuffer: gitOutputLimitBytes,
      }),
      execFileAsync("git", ["diff", "--name-only", "-z", "HEAD", "--"], {
        cwd: repoRoot,
        encoding: "buffer",
        maxBuffer: gitOutputLimitBytes,
      }),
      execFileAsync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
        cwd: repoRoot,
        encoding: "buffer",
        maxBuffer: gitOutputLimitBytes,
      }),
    ]);
    const untrackedPaths = untrackedOutput.toString("utf8").split("\0").filter(Boolean).sort();
    const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
    const untrackedPatches = await mapBounded(untrackedPaths, 4, async (path) => {
      try {
        await execFileAsync("git", ["diff", "--binary", "--no-index", "--", nullDevice, path], {
          cwd: repoRoot,
          maxBuffer: gitOutputLimitBytes,
        });
        return "";
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === 1 && "stdout" in error) {
          return String(error.stdout);
        }
        throw error;
      }
    });
    const [headAfter, fingerprintAfter] = await Promise.all([
      gitValue(repoRoot, "rev-parse", "HEAD"),
      worktreeFingerprint(repoRoot),
    ]);
    if (headBefore === headAfter && fingerprintBefore === fingerprintAfter) {
      const trackedPaths = trackedNames.toString("utf8").split("\0").filter(Boolean);
      return {
        head: headAfter,
        fingerprint: fingerprintAfter,
        status: statusOutput.trimEnd(),
        patch: `${trackedPatch}${untrackedPatches.join("")}`,
        changedFiles: [...new Set([...trackedPaths, ...untrackedPaths])].sort(),
      };
    }
    }
    throw new Error("Repository worktree kept changing while its observation checkpoint was captured");
  } catch (error) {
    throw actionableGitOutputError(error);
  }
}
