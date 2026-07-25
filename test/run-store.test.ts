import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunDirectory, readRunState } from "../src/run-store.js";

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
