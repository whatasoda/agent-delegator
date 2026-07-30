import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendLine, writeJsonAtomic } from "../src/files.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("atomic JSON writes", () => {
  test("removes its unique temporary file when rename fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-delegator-atomic-"));
    temporaryDirectories.push(root);
    const target = join(root, "state.json");
    await mkdir(target);

    await expect(writeJsonAtomic(target, { status: "completed" })).rejects.toThrow();
    expect((await readdir(root)).filter((name) => name.startsWith("state.json.tmp-"))).toEqual([]);
  });

  test("starts a fresh line after an interrupted append", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-delegator-lines-"));
    temporaryDirectories.push(root);
    const target = join(root, "history.jsonl");
    await writeFile(target, '{"torn"');

    await appendLine(target, JSON.stringify({ status: "completed" }));

    expect((await readFile(target, "utf8")).split("\n")).toEqual([
      '{"torn"',
      '{"status":"completed"}',
      "",
    ]);
  });
});
