import { execFile } from "node:child_process";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface SessionRecord {
  sessionId?: string;
  cwd?: string;
  transcriptPath?: string;
  transcript_path?: string;
}

interface IndexEntry {
  sessionId?: string;
  fullPath?: string;
  projectPath?: string;
}

export interface ResolveTranscriptOptions {
  cwd: string;
  transcriptPath?: string;
  sessionId?: string;
  claudeConfigDir?: string;
  startPid?: number;
  maxParentDepth?: number;
  allowLatestFallback?: boolean;
}

export interface ResolvedTranscript {
  path: string;
  sessionId: string | null;
  sessionCwd: string | null;
  method: "explicit" | "process-tree" | "session-id" | "latest-for-cwd";
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function projectDirectoryName(cwd: string): string {
  // Claude Code folds every non-alphanumeric character to "-" (verified: /Users/x/.claude ->
  // -Users-x--claude, sup_pjsys -> sup-pjsys), not just the path separators.
  return resolve(cwd).replace(/[^A-Za-z0-9]/g, "-");
}

async function findInIndex(indexPath: string, sessionId: string): Promise<string | null> {
  const index = await readJson<{ entries?: IndexEntry[] }>(indexPath);
  const match = index?.entries?.find((entry) => entry.sessionId === sessionId);
  return match?.fullPath && (await exists(match.fullPath)) ? match.fullPath : null;
}

async function findBySessionId(
  projectsDir: string,
  sessionId: string,
  sessionCwd?: string,
): Promise<string | null> {
  if (sessionCwd) {
    const projectDir = join(projectsDir, projectDirectoryName(sessionCwd));
    const direct = join(projectDir, `${sessionId}.jsonl`);
    if (await exists(direct)) return direct;
    const indexed = await findInIndex(join(projectDir, "sessions-index.json"), sessionId);
    if (indexed) return indexed;
  }

  const directories = await readdir(projectsDir, { withFileTypes: true }).catch(() => []);
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const projectDir = join(projectsDir, directory.name);
    const direct = join(projectDir, `${sessionId}.jsonl`);
    if (await exists(direct)) return direct;
    const indexed = await findInIndex(join(projectDir, "sessions-index.json"), sessionId);
    if (indexed) return indexed;
  }
  return null;
}

async function parentPid(pid: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "ppid=", "-p", String(pid)]);
    const parsed = Number.parseInt(stdout.trim(), 10);
    return Number.isInteger(parsed) && parsed > 1 ? parsed : null;
  } catch {
    return null;
  }
}

async function findParentSession(
  sessionsDir: string,
  startPid: number,
  maxDepth: number,
): Promise<SessionRecord | null> {
  let pid: number | null = startPid;
  for (let depth = 0; depth < maxDepth && pid; depth += 1) {
    const record = await readJson<SessionRecord>(join(sessionsDir, `${pid}.json`));
    if (record?.sessionId) return record;
    pid = await parentPid(pid);
  }
  return null;
}

async function findLatestForCwd(projectsDir: string, cwd: string): Promise<string | null> {
  const projectDir = join(projectsDir, projectDirectoryName(cwd));
  const entries = await readdir(projectDir, { withFileTypes: true }).catch(() => []);
  const candidates: { path: string; mtimeMs: number }[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const path = join(projectDir, entry.name);
    const metadata = await stat(path).catch(() => null);
    if (metadata) candidates.push({ path, mtimeMs: metadata.mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.path ?? null;
}

export async function resolveClaudeTranscript(
  options: ResolveTranscriptOptions,
): Promise<ResolvedTranscript> {
  if (options.transcriptPath) {
    const path = resolve(options.transcriptPath);
    if (!(await exists(path))) throw new Error(`Transcript does not exist: ${path}`);
    return { path, sessionId: options.sessionId ?? null, sessionCwd: null, method: "explicit" };
  }

  const configDir = resolve(
    options.claudeConfigDir ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
  );
  const sessionsDir = join(configDir, "sessions");
  const projectsDir = join(configDir, "projects");

  if (options.sessionId) {
    const path = await findBySessionId(projectsDir, options.sessionId, options.cwd);
    if (!path) throw new Error(`Claude transcript was not found for session ${options.sessionId}`);
    return {
      path,
      sessionId: options.sessionId,
      sessionCwd: options.cwd,
      method: "session-id",
    };
  }

  const record = await findParentSession(
    sessionsDir,
    options.startPid ?? process.ppid,
    options.maxParentDepth ?? 8,
  );
  if (record?.sessionId) {
    const recordedPath = record.transcriptPath ?? record.transcript_path;
    if (recordedPath && (await exists(recordedPath))) {
      return {
        path: recordedPath,
        sessionId: record.sessionId,
        sessionCwd: record.cwd ?? null,
        method: "process-tree",
      };
    }
    const path = await findBySessionId(projectsDir, record.sessionId, record.cwd);
    if (path) {
      return {
        path,
        sessionId: record.sessionId,
        sessionCwd: record.cwd ?? null,
        method: "process-tree",
      };
    }
  }

  if (options.allowLatestFallback === true) {
    const path = await findLatestForCwd(projectsDir, options.cwd);
    if (path) {
      return {
        path,
        sessionId: path.split("/").at(-1)?.replace(/\.jsonl$/, "") ?? null,
        sessionCwd: options.cwd,
        method: "latest-for-cwd",
      };
    }
  }

  throw new Error(
    "Could not resolve the current Claude transcript. Run from Claude Code or pass --transcript/--session-id.",
  );
}
