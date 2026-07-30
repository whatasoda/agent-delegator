import { chmod, lstat, mkdir, readlink, realpath, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { registryPath } from "./registry.js";

export type CodexHomeMode = "shared" | "isolated" | "custom";
export type CodexAuthStore = "auto" | "keyring" | "file" | "shared-file";

export interface CodexEnvironmentSelection {
  mode: CodexHomeMode;
  home: string | null;
  authStore: CodexAuthStore;
}

function validatedAuthStore(value: string | undefined, fallback: CodexAuthStore): CodexAuthStore {
  const selected = value?.trim() || fallback;
  if (selected !== "auto" && selected !== "keyring" && selected !== "file" && selected !== "shared-file") {
    throw new Error("--codex-auth-store must be auto, keyring, file, or shared-file");
  }
  return selected;
}

export function selectCodexEnvironment(
  runId: string,
  homeOption?: string,
  authStoreOption?: string,
): CodexEnvironmentSelection {
  const selectedHome = homeOption?.trim() || process.env.AGENT_DELEGATOR_CODEX_HOME?.trim() || "shared";
  if (selectedHome === "shared") {
    const authStore = validatedAuthStore(authStoreOption ?? process.env.AGENT_DELEGATOR_CODEX_AUTH_STORE, "auto");
    if (authStore === "shared-file") throw new Error("shared-file authentication requires an isolated or custom Codex home");
    return {
      mode: "shared",
      home: null,
      authStore,
    };
  }
  const home = selectedHome === "isolated"
    ? join(dirname(registryPath()), "codex-homes", runId)
    : isAbsolute(selectedHome)
      ? resolve(selectedHome)
      : (() => { throw new Error("--codex-home must be shared, isolated, or an absolute path"); })();
  return {
    mode: selectedHome === "isolated" ? "isolated" : "custom",
    home,
    authStore: validatedAuthStore(authStoreOption ?? process.env.AGENT_DELEGATOR_CODEX_AUTH_STORE, "keyring"),
  };
}

export async function prepareCodexEnvironment(selection: CodexEnvironmentSelection): Promise<void> {
  if (!selection.home) return;
  await mkdir(selection.home, { recursive: true, mode: 0o700 });
  await chmod(selection.home, 0o700);
  if (selection.authStore !== "shared-file") return;
  const sharedHome = resolve(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"));
  const source = join(sharedHome, "auth.json");
  const target = join(selection.home, "auth.json");
  let sourceRealPath: string;
  try {
    sourceRealPath = await realpath(source);
    if (!(await lstat(sourceRealPath)).isFile()) throw new Error("not a file");
  } catch {
    throw new Error(`Cannot share Codex file authentication because ${source} is not a readable file`);
  }
  try {
    const metadata = await lstat(target);
    if (!metadata.isSymbolicLink() || await realpath(resolve(selection.home, await readlink(target))) !== sourceRealPath) {
      throw new Error(`Refusing to replace existing isolated authentication at ${target}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    await symlink(sourceRealPath, target);
  }
}

export function codexProcessEnvironment(selection: CodexEnvironmentSelection): NodeJS.ProcessEnv | undefined {
  return selection.home ? { ...process.env, CODEX_HOME: selection.home } : undefined;
}

export function codexConfigArgs(selection: CodexEnvironmentSelection): string[] {
  if (selection.mode === "shared" && selection.authStore === "auto") return [];
  const store = selection.authStore === "shared-file" ? "file" : selection.authStore;
  return ["--config", `cli_auth_credentials_store=\"${store}\"`];
}
