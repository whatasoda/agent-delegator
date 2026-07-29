import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendRunRegistryEntry, readRegisteredRunsDirs, registryPath } from "../src/registry.js";

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
});
