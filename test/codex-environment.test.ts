import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readlink, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  codexConfigArgs,
  codexProcessEnvironment,
  prepareCodexEnvironment,
  selectCodexEnvironment,
} from "../src/codex-environment.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  delete process.env.CODEX_HOME;
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("Codex environment selection", () => {
  test("preserves the existing shared home by default", () => {
    const selection = selectCodexEnvironment("run-1", "shared");
    expect(selection).toEqual({ mode: "shared", home: null, authStore: "auto" });
    expect(codexProcessEnvironment(selection)).toBeUndefined();
    expect(codexConfigArgs(selection)).toEqual([]);
  });

  test("creates a private custom home and defaults to keyring authentication", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-delegator-codex-home-"));
    temporaryDirectories.push(root);
    const home = join(root, "isolated");
    const selection = selectCodexEnvironment("run-1", home);
    await prepareCodexEnvironment(selection);

    expect(selection).toEqual({ mode: "custom", home, authStore: "keyring" });
    expect(codexProcessEnvironment(selection)?.CODEX_HOME).toBe(home);
    expect((await stat(home)).mode & 0o777).toBe(0o700);
  });

  test("rejects relative custom homes and unknown auth stores", () => {
    expect(() => selectCodexEnvironment("run-1", "relative/path")).toThrow("absolute path");
    expect(() => selectCodexEnvironment("run-1", "shared", "vault")).toThrow("auto, keyring, file, or shared-file");
    expect(() => selectCodexEnvironment("run-1", "shared", "shared-file")).toThrow("isolated or custom");
  });

  test("shares only an explicitly selected file credential through a symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-delegator-shared-auth-"));
    temporaryDirectories.push(root);
    const shared = join(root, "shared");
    const isolated = join(root, "isolated");
    await mkdir(shared);
    await writeFile(join(shared, "auth.json"), '{"fixture":true}\n');
    process.env.CODEX_HOME = shared;
    const selection = selectCodexEnvironment("run-1", isolated, "shared-file");
    await prepareCodexEnvironment(selection);

    expect(await readlink(join(isolated, "auth.json"))).toBe(await realpath(join(shared, "auth.json")));
    expect(await readFile(join(isolated, "auth.json"), "utf8")).toBe('{"fixture":true}\n');
    expect(codexConfigArgs(selection)).toContain('cli_auth_credentials_store="file"');
  });
});
