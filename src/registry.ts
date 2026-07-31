import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { appendLine } from "./files.js";

export interface RunRegistryEntry {
  schema_version: "1";
  run_id: string;
  runs_dir: string;
  repo_root: string;
  created_at: string;
}

export interface RunHistoryEntry {
  schema_version: "1";
  recorded_at: string;
  run_id: string;
  run_dir: string;
  repo_root: string;
  objective: string;
  status: string;
  created_at: string;
  updated_at: string;
  delegation_pattern: "implementation" | "research" | "interactive" | "autonomous";
  experiment_variant: string | null;
  task_metadata: { task_type: string; complexity: string; tags: string[] };
  models: { compiler: string | null; implementation: string | null; research: string | null; verification?: string | null };
  attempts: {
    collect: number;
    compile: number;
    implement: number;
    resume: number;
    research_turns: number;
    iteration_turns?: number;
    verification_calls?: number;
  };
  failure: string | null;
  failure_phase?: string | null;
  implementation_completed_before_iteration_failure?: boolean;
  salvaged?: boolean;
  autonomous_stop_reason?: string | null;
  codex_environment?: {
    mode: string;
    auth_store: string;
    network_access?: string;
    writable_roots?: string[];
    ui_session?: string | null;
    ui_sessions?: string[];
    verification_network_access?: string | null;
    verification_writable_roots?: string[];
    verification_ui_session?: string | null;
    verification_ui_sessions?: string[];
  };
  evaluation?: {
    recorded_at: string;
    outcome: string;
    brief_quality: string;
    implementation_quality: string;
    communication_quality: string;
    verification: string;
    ratings: Record<string, number>;
    issue_categories: string[];
    tags: string[];
  } | null;
}

export function registryPath(): string {
  const override = process.env.AGENT_DELEGATOR_REGISTRY_PATH;
  return override ? resolve(override) : join(homedir(), ".agent-delegator", "registry.jsonl");
}

export function historyPath(): string {
  const override = process.env.AGENT_DELEGATOR_HISTORY_PATH;
  if (override) return resolve(override);
  return join(dirname(registryPath()), "history.jsonl");
}

// Best-effort by design: losing a registry line only degrades cross-directory
// reporting, while throwing here would abort an otherwise healthy run.
export async function appendRunRegistryEntry(entry: Omit<RunRegistryEntry, "schema_version">): Promise<void> {
  try {
    const path = registryPath();
    await appendLine(path, JSON.stringify({ schema_version: "1", ...entry }));
  } catch {
    // Swallow: observability must never gate the run itself.
  }
}

export async function readRegisteredRunsDirs(): Promise<string[]> {
  let content: string;
  try {
    content = await readFile(registryPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
  const dirs = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // Torn trailing lines from an interrupted append must not take down
    // cross-directory reporting; the affected run stays visible via its own dir.
    try {
      const value = JSON.parse(line) as Partial<RunRegistryEntry>;
      if (typeof value.runs_dir === "string" && value.runs_dir) dirs.add(resolve(value.runs_dir));
    } catch {
      continue;
    }
  }
  return [...dirs];
}

export async function appendRunHistoryEntry(entry: Omit<RunHistoryEntry, "schema_version" | "recorded_at">): Promise<void> {
  try {
    const path = historyPath();
    await appendLine(path, JSON.stringify({
      schema_version: "1",
      recorded_at: new Date().toISOString(),
      ...entry,
    }));
  } catch {
    // Losing a history snapshot must not change the delegated operation's result.
  }
}

export async function readLatestRunHistory(): Promise<RunHistoryEntry[]> {
  let content: string;
  try {
    content = await readFile(historyPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
  const latest = new Map<string, RunHistoryEntry>();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as unknown;
      if (isRunHistoryEntry(value)) {
        latest.set(resolve(value.run_dir), value as RunHistoryEntry);
      }
    } catch {
      continue;
    }
  }
  return [...latest.values()].sort((left, right) => left.created_at.localeCompare(right.created_at));
}

function isRunHistoryEntry(value: unknown): value is RunHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<RunHistoryEntry>;
  return entry.schema_version === "1" &&
    typeof entry.recorded_at === "string" &&
    typeof entry.run_id === "string" &&
    typeof entry.run_dir === "string" &&
    typeof entry.repo_root === "string" &&
    typeof entry.objective === "string" &&
    typeof entry.status === "string" &&
    typeof entry.created_at === "string" &&
    typeof entry.updated_at === "string" &&
    ["implementation", "research", "interactive", "autonomous"].includes(String(entry.delegation_pattern)) &&
    (entry.experiment_variant === null || typeof entry.experiment_variant === "string") &&
    Boolean(entry.task_metadata && typeof entry.task_metadata === "object") &&
    Boolean(entry.models && typeof entry.models === "object") &&
    Boolean(entry.attempts && typeof entry.attempts === "object") &&
    (entry.failure === null || typeof entry.failure === "string") &&
    (entry.failure_phase === undefined || entry.failure_phase === null || typeof entry.failure_phase === "string") &&
    (entry.implementation_completed_before_iteration_failure === undefined ||
      typeof entry.implementation_completed_before_iteration_failure === "boolean") &&
    (entry.salvaged === undefined || typeof entry.salvaged === "boolean") &&
    (entry.autonomous_stop_reason === undefined || entry.autonomous_stop_reason === null ||
      typeof entry.autonomous_stop_reason === "string") &&
    (entry.evaluation === undefined || entry.evaluation === null || typeof entry.evaluation === "object");
}
