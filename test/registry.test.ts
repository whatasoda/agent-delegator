import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendRunHistoryEntry,
  appendRunRegistryEntry,
  historyPath,
  readLatestRunHistory,
  readRegisteredRunsDirs,
  registryPath,
} from "../src/registry.js";

const temporaryDirectories: string[] = [];
const originalRegistryPath = process.env.AGENT_DELEGATOR_REGISTRY_PATH;

afterEach(async () => {
  if (originalRegistryPath === undefined) delete process.env.AGENT_DELEGATOR_REGISTRY_PATH;
  else process.env.AGENT_DELEGATOR_REGISTRY_PATH = originalRegistryPath;
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("run registry", () => {
  test("appends entries and lists unique runs directories despite torn lines", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-delegator-registry-"));
    temporaryDirectories.push(root);
    const path = join(root, "nested", "registry.jsonl");
    process.env.AGENT_DELEGATOR_REGISTRY_PATH = path;
    expect(registryPath()).toBe(path);
    expect(await readRegisteredRunsDirs()).toEqual([]);

    const entry = { repo_root: root, created_at: "2026-07-29T00:00:00.000Z" };
    await appendRunRegistryEntry({ ...entry, run_id: "one", runs_dir: join(root, "a") });
    await appendRunRegistryEntry({ ...entry, run_id: "two", runs_dir: join(root, "a") });
    await appendRunRegistryEntry({ ...entry, run_id: "three", runs_dir: join(root, "b") });
    expect(await readRegisteredRunsDirs()).toEqual([join(root, "a"), join(root, "b")]);

    const lines = (await readFile(path, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toMatchObject({ schema_version: "1", run_id: "one" });

    await writeFile(path, `${lines.join("\n")}\n{"torn`);
    expect(await readRegisteredRunsDirs()).toEqual([join(root, "a"), join(root, "b")]);
  });

  test("keeps the latest durable state snapshot for each run directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-delegator-history-"));
    temporaryDirectories.push(root);
    process.env.AGENT_DELEGATOR_REGISTRY_PATH = join(root, "registry.jsonl");
    const base = {
      run_id: "trial",
      run_dir: join(root, "runs", "trial"),
      repo_root: join(root, "repo"),
      objective: "Compare a research pattern",
      created_at: "2026-07-30T00:00:00.000Z",
      delegation_pattern: "research" as const,
      experiment_variant: "a",
      task_metadata: { task_type: "investigation", complexity: "small", tags: ["trial"] },
      models: { compiler: null, implementation: null, research: "fixture" },
      attempts: { collect: 1, compile: 0, implement: 0, resume: 0, research_turns: 1 },
      failure: null,
    };
    await appendRunHistoryEntry({ ...base, status: "researching", updated_at: "2026-07-30T00:01:00.000Z" });
    await appendRunHistoryEntry({
      ...base,
      status: "completed",
      updated_at: "2026-07-30T00:02:00.000Z",
      delegation_pattern: "interactive",
    });
    await appendRunHistoryEntry({
      ...base,
      run_dir: join(root, "alternate-runs", "trial"),
      status: "approved",
      updated_at: "2026-07-30T00:03:00.000Z",
    });
    expect((await stat(historyPath())).mode & 0o777).toBe(0o600);
    await writeFile(historyPath(), `${await readFile(historyPath(), "utf8")}\n{}\n{\"torn\"`);

    expect(await readLatestRunHistory()).toEqual([
      expect.objectContaining({ status: "completed", delegation_pattern: "interactive" }),
      expect.objectContaining({ status: "approved", run_dir: join(root, "alternate-runs", "trial") }),
    ]);
  });
});
