import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cachedUpdateNotice,
  claudeSkillPath,
  compareSemver,
  fetchLatestPackageVersion,
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
    const content = `---\nname: agent-delegator\n---\n${managedSkillMarker}\nmanaged\n`;

    await expect(syncClaudeSkill({ claudeConfigDir: config, content })).rejects.toThrow("unmanaged skill");
    await expect(syncClaudeSkill({ claudeConfigDir: config, content, force: true }))
      .resolves.toMatchObject({ status: "updated" });
  });

  test("rejects embedded content without the managed marker", async () => {
    const config = await temporaryClaudeConfig();
    await expect(syncClaudeSkill({
      claudeConfigDir: config,
      content: "---\nname: agent-delegator\n---\nunmanaged\n",
    }))
      .rejects.toThrow("missing its managed-file marker");
  });

  test("rejects rendered HTML in place of Markdown skill frontmatter", async () => {
    const config = await temporaryClaudeConfig();
    await expect(syncClaudeSkill({
      claudeConfigDir: config,
      content: `<hr /><h2>name: agent-delegator</h2>${managedSkillMarker}`,
    })).rejects.toThrow("missing its Markdown frontmatter");
  });
});

describe("update checks", () => {
  test("compares stable and prerelease SemVer values", () => {
    expect(compareSemver("0.1.0-alpha.10", "0.1.0-alpha.9")).toBeGreaterThan(0);
    expect(compareSemver("0.1.0", "0.1.0-alpha.10")).toBeGreaterThan(0);
    expect(compareSemver("0.1.0-alpha.9", "0.1.0-alpha.9")).toBe(0);
    expect(compareSemver("0.1.0-alpha", "0.1.0-alpha.1")).toBeLessThan(0);
  });

  test("reads the configured registry tag and reports invalid responses", async () => {
    const successFetch = Object.assign(
      async () => Response.json({ "dist-tags": { alpha: "0.1.0-alpha.10" } }),
      { preconnect: fetch.preconnect },
    );
    await expect(fetchLatestPackageVersion({
      packageName: "@whatasoda/agent-delegator",
      tag: "alpha",
      registryUrl: "https://registry.example/",
      fetchImpl: successFetch,
    })).resolves.toBe("0.1.0-alpha.10");

    const missingTagFetch = Object.assign(
      async () => Response.json({ "dist-tags": {} }),
      { preconnect: fetch.preconnect },
    );
    await expect(fetchLatestPackageVersion({
      packageName: "@whatasoda/agent-delegator",
      tag: "alpha",
      fetchImpl: missingTagFetch,
    })).rejects.toThrow("no alpha dist-tag");

    const unavailableFetch = Object.assign(
      async () => new Response("unavailable", { status: 503 }),
      { preconnect: fetch.preconnect },
    );
    await expect(fetchLatestPackageVersion({
      packageName: "@whatasoda/agent-delegator",
      tag: "alpha",
      fetchImpl: unavailableFetch,
    })).rejects.toThrow("HTTP 503");
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

  test("records registry failures and recovers on a later successful check", async () => {
    const config = await temporaryClaudeConfig();
    const failed = await refreshUpdateState({
      claudeConfigDir: config,
      currentVersion: "0.1.0-alpha.9",
      latestVersion: async () => { throw new Error("registry unavailable"); },
      autoUpdate: async () => { throw new Error("should not update"); },
    });
    expect(failed.state.lastCheck).toMatchObject({
      latestVersion: null,
      updateAvailable: false,
      error: "registry unavailable",
    });

    const recovered = await refreshUpdateState({
      claudeConfigDir: config,
      currentVersion: "0.1.0-alpha.9",
      latestVersion: async () => "0.1.0-alpha.10",
      autoUpdate: async () => { throw new Error("should not update"); },
    });
    expect(recovered.state.lastCheck).toMatchObject({
      latestVersion: "0.1.0-alpha.10",
      updateAvailable: true,
      error: null,
    });
  });

  test("replaces a malformed update cache with safe defaults", async () => {
    const config = await temporaryClaudeConfig();
    const stateDirectory = join(config, "agent-delegator");
    await mkdir(stateDirectory);
    const statePath = join(stateDirectory, "update-state.json");
    for (const content of ["not-json", '{"schemaVersion":1,"autoUpdate":true,"attempts":[]}']) {
      await writeFile(statePath, content);

      expect(await readUpdateState(config)).toEqual({
        schemaVersion: 1,
        autoUpdate: false,
        lastCheck: null,
        attempts: {},
      });
    }
  });

  test("returns busy for a live update lock and reclaims a stale lock", async () => {
    const config = await temporaryClaudeConfig();
    const stateDirectory = join(config, "agent-delegator");
    const lockPath = join(stateDirectory, "update.lock");
    await mkdir(stateDirectory);
    await writeFile(lockPath, "existing lock\n");
    let checks = 0;
    const refresh = () => refreshUpdateState({
      claudeConfigDir: config,
      currentVersion: "0.1.0-alpha.9",
      latestVersion: async () => {
        checks += 1;
        return "0.1.0-alpha.9";
      },
      autoUpdate: async () => { throw new Error("should not update"); },
    });

    await expect(refresh()).resolves.toMatchObject({ status: "busy" });
    expect(checks).toBe(0);

    const stale = new Date(Date.now() - 31 * 60 * 1000);
    await utimes(lockPath, stale, stale);
    await expect(refresh()).resolves.toMatchObject({ status: "checked" });
    expect(checks).toBe(1);
    await expect(readFile(lockPath, "utf8")).rejects.toThrow();
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

  test("reports a pending automatic update before an attempt is recorded", () => {
    expect(cachedUpdateNotice({
      schemaVersion: 1,
      autoUpdate: true,
      lastCheck: {
        checkedAt: "2026-07-31T00:00:00.000Z",
        currentVersion: "0.1.0-alpha.9",
        latestVersion: "0.1.0-alpha.10",
        updateAvailable: true,
        error: null,
      },
      attempts: {},
    })).toContain("pending in the background");
  });
});
