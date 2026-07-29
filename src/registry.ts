import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface RunRegistryEntry {
  schema_version: "1";
  run_id: string;
  runs_dir: string;
  repo_root: string;
  created_at: string;
}

export function registryPath(): string {
  const override = process.env.AGENT_DELEGATOR_REGISTRY_PATH;
  return override ? resolve(override) : join(homedir(), ".agent-delegator", "registry.jsonl");
}

// Best-effort by design: losing a registry line only degrades cross-directory
// reporting, while throwing here would abort an otherwise healthy run.
export async function appendRunRegistryEntry(entry: Omit<RunRegistryEntry, "schema_version">): Promise<void> {
  try {
    const path = registryPath();
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await appendFile(path, `${JSON.stringify({ schema_version: "1", ...entry })}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
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
