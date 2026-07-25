import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, readlink, realpath } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function gitValue(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

export async function repositoryRoot(cwd: string): Promise<string> {
  return realpath(await gitValue(cwd, "rev-parse", "--show-toplevel"));
}

export async function worktreeFingerprint(repoRoot: string): Promise<string> {
  const hash = createHash("sha256");
  const { stdout: diff } = await execFileAsync(
    "git",
    ["diff", "--binary", "--no-ext-diff", "HEAD", "--"],
    { cwd: repoRoot, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
  );
  hash.update(diff);
  const { stdout: untrackedOutput } = await execFileAsync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    { cwd: repoRoot, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
  );
  const paths = untrackedOutput.toString("utf8").split("\0").filter(Boolean).sort();
  for (const path of paths) {
    const fullPath = `${repoRoot}/${path}`;
    const metadata = await lstat(fullPath);
    hash.update(`\0${path}\0${metadata.mode}\0`);
    hash.update(metadata.isSymbolicLink() ? await readlink(fullPath) : await readFile(fullPath));
  }
  return hash.digest("hex");
}

export async function worktreeObservation(repoRoot: string): Promise<{
  head: string;
  fingerprint: string;
  status: string;
  patch: string;
  changedFiles: string[];
}> {
  for (let captureAttempt = 1; captureAttempt <= 3; captureAttempt += 1) {
    const [headBefore, fingerprintBefore] = await Promise.all([
      gitValue(repoRoot, "rev-parse", "HEAD"),
      worktreeFingerprint(repoRoot),
    ]);
    const [{ stdout: statusOutput }, { stdout: trackedPatch }, { stdout: trackedNames }, { stdout: untrackedOutput }] = await Promise.all([
      execFileAsync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
        cwd: repoRoot,
        maxBuffer: 64 * 1024 * 1024,
      }),
      execFileAsync("git", ["diff", "--binary", "--no-ext-diff", "HEAD", "--"], {
        cwd: repoRoot,
        maxBuffer: 64 * 1024 * 1024,
      }),
      execFileAsync("git", ["diff", "--name-only", "-z", "HEAD", "--"], {
        cwd: repoRoot,
        encoding: "buffer",
        maxBuffer: 64 * 1024 * 1024,
      }),
      execFileAsync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
        cwd: repoRoot,
        encoding: "buffer",
        maxBuffer: 64 * 1024 * 1024,
      }),
    ]);
    const untrackedPaths = untrackedOutput.toString("utf8").split("\0").filter(Boolean).sort();
    const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
    const untrackedPatches = await Promise.all(untrackedPaths.map(async (path) => {
      try {
        await execFileAsync("git", ["diff", "--binary", "--no-index", "--", nullDevice, path], {
          cwd: repoRoot,
          maxBuffer: 64 * 1024 * 1024,
        });
        return "";
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === 1 && "stdout" in error) {
          return String(error.stdout);
        }
        throw error;
      }
    }));
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
}
