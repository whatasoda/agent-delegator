import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { managedSkillMarker } from "../src/distribution.js";
import packageJson from "../package.json";

const temporaryDirectories: string[] = [];
const cli = resolve(import.meta.dir, "../src/cli.ts");

async function run(args: string[], environment: Record<string, string | undefined> = process.env) {
  const child = Bun.spawn([process.execPath, cli, ...args], {
    cwd: resolve(import.meta.dir, ".."),
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("setup and sync commands", () => {
  test("installs the embedded skill under CLAUDE_CONFIG_DIR and configures automatic updates", async () => {
    const config = await mkdtemp(join(tmpdir(), "agent-delegator-cli-setup-"));
    temporaryDirectories.push(config);
    const result = await run(["setup", "--auto-update", "--json"], {
      ...process.env,
      CLAUDE_CONFIG_DIR: config,
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "created", auto_update: true });
    const skill = await readFile(join(config, "skills", "agent-delegator", "SKILL.md"), "utf8");
    expect(skill).toContain(managedSkillMarker);
    expect(skill).toContain("agent-delegator update-check");
  });

  test("sync is idempotent and honors an explicit config directory", async () => {
    const config = await mkdtemp(join(tmpdir(), "agent-delegator-cli-sync-"));
    temporaryDirectories.push(config);
    expect((await run(["sync", "--claude-config-dir", config, "--json"])).exitCode).toBe(0);
    const second = await run(["sync", "--claude-config-dir", config, "--json"]);

    expect(second.exitCode).toBe(0);
    expect(JSON.parse(second.stdout)).toMatchObject({ status: "unchanged", claude_config_dir: config });
  });

  test("returns cached status immediately and refreshes it in a detached process", async () => {
    const config = await mkdtemp(join(tmpdir(), "agent-delegator-cli-update-check-"));
    temporaryDirectories.push(config);
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ "dist-tags": { alpha: "0.1.0-alpha.999" } }),
    });
    try {
      const result = await run(["update-check", "--json"], {
        ...process.env,
        CLAUDE_CONFIG_DIR: config,
        AGENT_DELEGATOR_UPDATE_REGISTRY_URL: server.url.toString(),
      });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ notice: null, refreshStarted: true });

      const statePath = join(config, "agent-delegator", "update-state.json");
      let state: { lastCheck?: { latestVersion?: string } } = {};
      for (let attempt = 0; attempt < 100; attempt += 1) {
        state = await readFile(statePath, "utf8").then(JSON.parse).catch(() => ({}));
        if (state.lastCheck?.latestVersion) break;
        await Bun.sleep(10);
      }
      expect(state.lastCheck?.latestVersion).toBe("0.1.0-alpha.999");
    } finally {
      server.stop(true);
    }
  });

  test("the update command synchronizes the skill when the installed version is current", async () => {
    const config = await mkdtemp(join(tmpdir(), "agent-delegator-cli-update-"));
    temporaryDirectories.push(config);
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ "dist-tags": { alpha: packageJson.version } }),
    });
    try {
      const result = await run(["update", "--json"], {
        ...process.env,
        CLAUDE_CONFIG_DIR: config,
        AGENT_DELEGATOR_UPDATE_REGISTRY_URL: server.url.toString(),
      });

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ status: "updated", version: packageJson.version });
      expect(await readFile(join(config, "skills", "agent-delegator", "SKILL.md"), "utf8"))
        .toContain(managedSkillMarker);
    } finally {
      server.stop(true);
    }
  });

  test("installs a newer exact version and invokes sync through Bun's global bin", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-delegator-cli-upgrade-"));
    temporaryDirectories.push(root);
    const config = join(root, "claude");
    const globalBin = join(root, "bin");
    const bunLog = join(root, "bun.log");
    const syncLog = join(root, "sync.log");
    const fakeBun = join(root, "fake-bun");
    await mkdir(globalBin);
    await writeFile(
      fakeBun,
      `#!/usr/bin/env bun
const args = process.argv.slice(2);
if (args[0] === "add") await Bun.write(process.env.FAKE_BUN_LOG, args.join(" "));
else if (args.join(" ") === "pm bin -g") process.stdout.write(process.env.FAKE_GLOBAL_BIN + "\\n");
else process.exit(2);
`,
    );
    await writeFile(
      join(globalBin, "agent-delegator"),
      `#!/usr/bin/env bun
await Bun.write(process.env.FAKE_SYNC_LOG, process.argv.slice(2).join(" "));
`,
    );
    await Promise.all([chmod(fakeBun, 0o755), chmod(join(globalBin, "agent-delegator"), 0o755)]);
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ "dist-tags": { alpha: "0.1.0-alpha.999" } }),
    });
    try {
      const result = await run(["update", "--json"], {
        ...process.env,
        CLAUDE_CONFIG_DIR: config,
        AGENT_DELEGATOR_UPDATE_REGISTRY_URL: server.url.toString(),
        AGENT_DELEGATOR_BUN_COMMAND: fakeBun,
        FAKE_BUN_LOG: bunLog,
        FAKE_GLOBAL_BIN: globalBin,
        FAKE_SYNC_LOG: syncLog,
      });

      expect(result.exitCode).toBe(0);
      expect(await readFile(bunLog, "utf8")).toBe("add --global @whatasoda/agent-delegator@0.1.0-alpha.999");
      expect(await readFile(syncLog, "utf8")).toBe(`sync --claude-config-dir ${config} --json`);
    } finally {
      server.stop(true);
    }
  });
});
