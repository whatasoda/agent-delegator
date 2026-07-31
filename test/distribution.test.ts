import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cachedUpdateNotice,
  claudeSkillPath,
  compareSemver,
  managedSkillMarker,
  readUpdateState,
  refreshUpdateState,
  resolveClaudeConfigDir,
  setAutoUpdate,
  syncClaudeSkill,
} from "../src/distribution.js";

const temporaryDirectories: string[] = [];

async function temporaryClaudeConfig(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "agent-delegator-distribution-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});
describe("Claude skill distribution", () => {
  test("resolves CLAUDE_CONFIG_DIR and synchronizes managed content idempotently", async () => {
    const config = await temporaryClaudeConfig();
    expect(resolveClaudeConfigDir(undefined, { CLAUDE_CONFIG_DIR: config })).toBe(config);
    const content = `---\nname: agent-delegator\n---\n${managedSkillMarker}\nmanaged\n`;

    await expect(syncClaudeSkill({ claudeConfigDir: config, content })).resolves.toMatchObject({ status: "created" });
    await expect(syncClaudeSkill({ claudeConfigDir: config, content })).resolves.toMatchObject({ status: "unchanged" });

    expect(await readFile(claudeSkillPath(config), "utf8")).toBe(content);
  });

  test("does not overwrite an unmanaged personal skill without force", async () => {
    const config = await temporaryClaudeConfig();
    const path = claudeSkillPath(config);
    await mkdir(join(config, "skills", "agent-delegator"), { recursive: true });
    await writeFile(path, "personal instructions\n");
    const content = `${managedSkillMarker}\nmanaged\n`;

    await expect(syncClaudeSkill({ claudeConfigDir: config, content })).rejects.toThrow("unmanaged skill");
    await expect(syncClaudeSkill({ claudeConfigDir: config, content, force: true }))
      .resolves.toMatchObject({ status: "updated" });
  });
});

describe("update checks", () => {
  test("compares stable and prerelease SemVer values", () => {
    expect(compareSemver("0.1.0-alpha.10", "0.1.0-alpha.9")).toBeGreaterThan(0);
    expect(compareSemver("0.1.0", "0.1.0-alpha.10")).toBeGreaterThan(0);
    expect(compareSemver("0.1.0-alpha.9", "0.1.0-alpha.9")).toBe(0);
  });

  test("caches an available version for the next invocation", async () => {
    const config = await temporaryClaudeConfig();
    const result = await refreshUpdateState({
      claudeConfigDir: config,
      currentVersion: "0.1.0-alpha.9",
      latestVersion: async () => "0.1.0-alpha.10",
      autoUpdate: async () => { throw new Error("should not update"); },
    });

    expect(result.state.lastCheck).toMatchObject({ latestVersion: "0.1.0-alpha.10", updateAvailable: true });
    expect(cachedUpdateNotice(result.state)).toContain("agent-delegator update");
  });

  test("attempts automatic update only once for each version, including failures", async () => {
    const config = await temporaryClaudeConfig();
    await setAutoUpdate(config, true);
    let attempts = 0;
    const refresh = () => refreshUpdateState({
      claudeConfigDir: config,
      currentVersion: "0.1.0-alpha.9",
      latestVersion: async () => "0.1.0-alpha.10",
      autoUpdate: async () => {
        attempts += 1;
        throw new Error("offline");
      },
    });

    await refresh();
    await refresh();

    expect(attempts).toBe(1);
    const state = await readUpdateState(config);
    expect(state.attempts["0.1.0-alpha.10"]).toMatchObject({ status: "failed", error: "offline" });
    expect(cachedUpdateNotice(state)).toContain("failed once");
  });
});
