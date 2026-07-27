import { afterEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { worktreeFingerprint } from "../src/repository.js";
import { createRunDirectory, readRunState } from "../src/run-store.js";

const execFileAsync = promisify(execFile);

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("run store", () => {
  test("rejects run ids that could escape the runs directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-delegator-runs-"));
    temporaryDirectories.push(root);
    await expect(createRunDirectory(join(root, "runs"), "../../escaped")).rejects.toThrow(
      "--run-id must be",
    );
  });

  test("creates private run directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-delegator-runs-"));
    temporaryDirectories.push(root);
    const runDir = await createRunDirectory(join(root, "runs"), "safe-run");
    expect((await stat(runDir)).mode & 0o777).toBe(0o700);
  });

  test("writes a gitignore that keeps run artifacts untracked", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-delegator-runs-"));
    temporaryDirectories.push(root);
    const runsDir = join(root, "runs");
    await createRunDirectory(runsDir, "first-run");
    expect(await readFile(join(runsDir, ".gitignore"), "utf8")).toBe("*\n");
  });

  test("does not clobber an existing runs-directory gitignore", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-delegator-runs-"));
    temporaryDirectories.push(root);
    const runsDir = join(root, "runs");
    await createRunDirectory(runsDir, "first-run");
    await writeFile(join(runsDir, ".gitignore"), "custom\n");
    await createRunDirectory(runsDir, "second-run");
    expect(await readFile(join(runsDir, ".gitignore"), "utf8")).toBe("custom\n");
  });

  test("run artifacts stay outside the worktree fingerprint of a target repository", async () => {
    const repo = await mkdtemp(join(tmpdir(), "agent-delegator-target-"));
    temporaryDirectories.push(repo);
    await execFileAsync("git", ["init"], { cwd: repo });
    await writeFile(join(repo, "README.md"), "seed\n");
    await execFileAsync("git", ["add", "."], { cwd: repo });
    await execFileAsync(
      "git",
      ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-m", "seed"],
      { cwd: repo },
    );
    const cleanFingerprint = await worktreeFingerprint(repo);

    const runDir = await createRunDirectory(join(repo, ".agent-delegator", "runs"), "target-run");
    await writeFile(join(runDir, "state.json"), "{}\n");
    await writeFile(join(runDir, "approval.json"), "{}\n");

    expect(await worktreeFingerprint(repo)).toBe(cleanFingerprint);
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--others", "--exclude-standard"],
      { cwd: repo },
    );
    expect(stdout.trim()).toBe("");
  });

  test("rejects malformed lifecycle state", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-delegator-runs-"));
    temporaryDirectories.push(root);
    const runDir = await createRunDirectory(join(root, "runs"), "bad-state");
    await writeFile(join(runDir, "state.json"), JSON.stringify({ schemaVersion: 1, status: "invented" }));

    await expect(readRunState(runDir)).rejects.toThrow(
      "state.json does not match the supported run-state schema",
    );
  });
});
