import { open, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const managedSkillMarker = "<!-- managed-by: @whatasoda/agent-delegator -->";

export interface SkillSyncResult {
  claudeConfigDir: string;
  path: string;
  status: "created" | "updated" | "unchanged";
}

export interface UpdateCheck {
  checkedAt: string;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  error: string | null;
}

export interface UpdateAttempt {
  startedAt: string;
  completedAt: string | null;
  status: "running" | "succeeded" | "failed";
  error: string | null;
}

export interface UpdateState {
  schemaVersion: 1;
  autoUpdate: boolean;
  lastCheck: UpdateCheck | null;
  attempts: Record<string, UpdateAttempt>;
}

export interface RefreshUpdateResult {
  status: "checked" | "busy";
  state: UpdateState;
  autoUpdateVersion: string | null;
}

export function resolveClaudeConfigDir(
  configured?: string,
  environment: Record<string, string | undefined> = process.env,
): string {
  return resolve(configured ?? environment.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"));
}

export function claudeSkillPath(claudeConfigDir: string): string {
  return join(resolve(claudeConfigDir), "skills", "agent-delegator", "SKILL.md");
}

export function updateStatePath(claudeConfigDir: string): string {
  return join(resolve(claudeConfigDir), "agent-delegator", "update-state.json");
}

function defaultUpdateState(): UpdateState {
  return { schemaVersion: 1, autoUpdate: false, lastCheck: null, attempts: {} };
}

function isUpdateCheck(value: unknown): value is UpdateCheck {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const check = value as Partial<UpdateCheck>;
  return typeof check.checkedAt === "string" && typeof check.currentVersion === "string" &&
    (check.latestVersion === null || typeof check.latestVersion === "string") &&
    typeof check.updateAvailable === "boolean" &&
    (check.error === null || typeof check.error === "string");
}

function isUpdateAttempt(value: unknown): value is UpdateAttempt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const attempt = value as Partial<UpdateAttempt>;
  return typeof attempt.startedAt === "string" &&
    (attempt.completedAt === null || typeof attempt.completedAt === "string") &&
    (attempt.status === "running" || attempt.status === "succeeded" || attempt.status === "failed") &&
    (attempt.error === null || typeof attempt.error === "string");
}

function isUpdateState(value: unknown): value is UpdateState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<UpdateState>;
  return candidate.schemaVersion === 1 && typeof candidate.autoUpdate === "boolean" &&
    (candidate.lastCheck === null || isUpdateCheck(candidate.lastCheck)) &&
    typeof candidate.attempts === "object" && candidate.attempts !== null &&
    !Array.isArray(candidate.attempts) && Object.values(candidate.attempts).every(isUpdateAttempt);
}

async function writeAtomic(path: string, content: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function syncClaudeSkill(options: {
  claudeConfigDir: string;
  content: string;
  force?: boolean;
}): Promise<SkillSyncResult> {
  if (!options.content.includes(managedSkillMarker)) {
    throw new Error("Embedded skill is missing its managed-file marker");
  }
  const claudeConfigDir = resolve(options.claudeConfigDir);
  const path = claudeSkillPath(claudeConfigDir);
  let existing: string | null = null;
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existing === options.content) return { claudeConfigDir, path, status: "unchanged" };
  if (existing !== null && !existing.includes(managedSkillMarker) && !options.force) {
    throw new Error(`Refusing to replace unmanaged skill at ${path}; pass --force after reviewing it`);
  }
  await writeAtomic(path, options.content, 0o600);
  return { claudeConfigDir, path, status: existing === null ? "created" : "updated" };
}

export async function readUpdateState(claudeConfigDir: string): Promise<UpdateState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(updateStatePath(claudeConfigDir), "utf8"));
    return isUpdateState(parsed) ? parsed : defaultUpdateState();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
      return defaultUpdateState();
    }
    throw error;
  }
}

export async function writeUpdateState(claudeConfigDir: string, state: UpdateState): Promise<void> {
  await writeAtomic(updateStatePath(claudeConfigDir), `${JSON.stringify(state, null, 2)}\n`, 0o600);
}

export async function setAutoUpdate(claudeConfigDir: string, enabled: boolean): Promise<UpdateState> {
  const state = await readUpdateState(claudeConfigDir);
  state.autoUpdate = enabled;
  await writeUpdateState(claudeConfigDir, state);
  return state;
}

function compareIdentifier(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    const normalizedLeft = left.replace(/^0+(?=\d)/, "");
    const normalizedRight = right.replace(/^0+(?=\d)/, "");
    return normalizedLeft.length === normalizedRight.length
      ? normalizedLeft.localeCompare(normalizedRight)
      : normalizedLeft.length - normalizedRight.length;
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left.localeCompare(right);
}

export function compareSemver(left: string, right: string): number {
  const parse = (value: string): { core: string[]; prerelease: string[] | null } | null => {
    const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
    if (!match) return null;
    return {
      core: [match[1]!, match[2]!, match[3]!],
      prerelease: match[4]?.split(".") ?? null,
    };
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return left === right ? 0 : left.localeCompare(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = compareIdentifier(a.core[index]!, b.core[index]!);
    if (difference !== 0) return difference;
  }
  if (a.prerelease === null || b.prerelease === null) {
    if (a.prerelease === b.prerelease) return 0;
    return a.prerelease === null ? 1 : -1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const aIdentifier = a.prerelease[index];
    const bIdentifier = b.prerelease[index];
    if (aIdentifier === undefined || bIdentifier === undefined) {
      return aIdentifier === bIdentifier ? 0 : aIdentifier === undefined ? -1 : 1;
    }
    const difference = compareIdentifier(aIdentifier, bIdentifier);
    if (difference !== 0) return difference;
  }
  return 0;
}

export async function fetchLatestPackageVersion(options: {
  packageName: string;
  tag: string;
  registryUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const registryUrl = (options.registryUrl ?? "https://registry.npmjs.org").replace(/\/$/, "");
  const response = await (options.fetchImpl ?? fetch)(
    `${registryUrl}/${encodeURIComponent(options.packageName)}`,
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw new Error(`Registry returned HTTP ${response.status}`);
  const metadata = await response.json() as { "dist-tags"?: Record<string, unknown> };
  const version = metadata["dist-tags"]?.[options.tag];
  if (typeof version !== "string" || !version) {
    throw new Error(`Registry response has no ${options.tag} dist-tag`);
  }
  return version;
}

function updateLockPath(claudeConfigDir: string): string {
  return join(resolve(claudeConfigDir), "agent-delegator", "update.lock");
}

async function acquireUpdateLock(claudeConfigDir: string): Promise<(() => Promise<void>) | null> {
  const path = updateLockPath(claudeConfigDir);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const attempt = async (): Promise<(() => Promise<void>) | null> => {
    try {
      const token = crypto.randomUUID();
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(`${token}\n${process.pid}\n${new Date().toISOString()}\n`);
      } catch (error) {
        await handle.close();
        await rm(path, { force: true });
        throw error;
      }
      await handle.close();
      return async () => {
        const current = await readFile(path, "utf8").catch(() => "");
        if (current.startsWith(`${token}\n`)) await rm(path, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return null;
    }
  };
  const acquired = await attempt();
  if (acquired) return acquired;
  const metadata = await stat(path).catch(() => null);
  if (!metadata || Date.now() - metadata.mtimeMs <= 30 * 60 * 1000) return null;
  await rm(path, { force: true });
  return attempt();
}

export async function refreshUpdateState(options: {
  claudeConfigDir: string;
  currentVersion: string;
  latestVersion: () => Promise<string>;
  autoUpdate: (version: string) => Promise<void>;
  now?: () => Date;
}): Promise<RefreshUpdateResult> {
  const release = await acquireUpdateLock(options.claudeConfigDir);
  if (!release) {
    return { status: "busy", state: await readUpdateState(options.claudeConfigDir), autoUpdateVersion: null };
  }
  try {
    const state = await readUpdateState(options.claudeConfigDir);
    const checkedAt = (options.now ?? (() => new Date()))().toISOString();
    let latestVersion: string;
    try {
      latestVersion = await options.latestVersion();
    } catch (error) {
      state.lastCheck = {
        checkedAt,
        currentVersion: options.currentVersion,
        latestVersion: null,
        updateAvailable: false,
        error: error instanceof Error ? error.message : String(error),
      };
      await writeUpdateState(options.claudeConfigDir, state);
      return { status: "checked", state, autoUpdateVersion: null };
    }
    const updateAvailable = compareSemver(latestVersion, options.currentVersion) > 0;
    state.lastCheck = {
      checkedAt,
      currentVersion: options.currentVersion,
      latestVersion,
      updateAvailable,
      error: null,
    };
    await writeUpdateState(options.claudeConfigDir, state);
    if (!state.autoUpdate || !updateAvailable || state.attempts[latestVersion]) {
      return { status: "checked", state, autoUpdateVersion: null };
    }
    state.attempts[latestVersion] = {
      startedAt: checkedAt,
      completedAt: null,
      status: "running",
      error: null,
    };
    await writeUpdateState(options.claudeConfigDir, state);
    try {
      await options.autoUpdate(latestVersion);
      const attempt = state.attempts[latestVersion]!;
      state.attempts[latestVersion] = {
        ...attempt,
        completedAt: (options.now ?? (() => new Date()))().toISOString(),
        status: "succeeded",
        error: null,
      };
      state.lastCheck = { ...state.lastCheck, currentVersion: latestVersion, updateAvailable: false };
    } catch (error) {
      const attempt = state.attempts[latestVersion]!;
      state.attempts[latestVersion] = {
        ...attempt,
        completedAt: (options.now ?? (() => new Date()))().toISOString(),
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    await writeUpdateState(options.claudeConfigDir, state);
    return { status: "checked", state, autoUpdateVersion: latestVersion };
  } finally {
    await release();
  }
}

export function cachedUpdateNotice(state: UpdateState): string | null {
  const check = state.lastCheck;
  if (!check?.updateAvailable || !check.latestVersion) return null;
  const attempt = state.attempts[check.latestVersion];
  if (!state.autoUpdate) {
    return `agent-delegator ${check.latestVersion} is available (current ${check.currentVersion}). Run \`agent-delegator update\`.`;
  }
  if (attempt?.status === "succeeded") return null;
  if (attempt?.status === "failed") {
    return `Automatic update to agent-delegator ${check.latestVersion} failed once: ${attempt.error ?? "unknown error"}. Run \`agent-delegator update\` manually.`;
  }
  return `Automatic update to agent-delegator ${check.latestVersion} is pending in the background.`;
}
