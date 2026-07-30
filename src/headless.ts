import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { readJson, writeJsonAtomic } from "./files.js";
import { registryPath } from "./registry.js";

export type HeadlessBackend = "process" | "herdr";
export type HeadlessJobStatus = "launching" | "running" | "completed" | "failed" | "lost";

export interface HeadlessJob {
  schema_version: "1";
  id: string;
  backend: HeadlessBackend;
  status: HeadlessJobStatus;
  command: string;
  run_id: string;
  run_dir: string;
  repo_root: string;
  controller_pid: number | null;
  herdr_workspace_id: string | null;
  herdr_tab_id: string | null;
  herdr_pane_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  exit_code: number | null;
  error: string | null;
  stdout_path: string;
  stderr_path: string;
}

export function headlessRoot(): string {
  const override = process.env.AGENT_DELEGATOR_HEADLESS_DIR;
  return override ? resolve(override) : join(dirname(registryPath()), "headless");
}

export function makeHeadlessJobId(now = new Date()): string {
  return `${now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${randomUUID().slice(0, 8)}`;
}

export function headlessJobDirectory(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) throw new Error("Invalid headless job ID");
  return join(headlessRoot(), id);
}

export function headlessJobPath(id: string): string {
  return join(headlessJobDirectory(id), "job.json");
}

export async function writeHeadlessJob(path: string, job: HeadlessJob): Promise<void> {
  job.updated_at = new Date().toISOString();
  await writeJsonAtomic(path, job);
}

export async function readHeadlessJob(path: string): Promise<HeadlessJob> {
  const job = await readJson<HeadlessJob>(path);
  if (job.schema_version !== "1" || !job.id || !job.command || !job.run_dir) {
    throw new Error(`Invalid headless job record: ${path}`);
  }
  return job;
}

export async function listHeadlessJobs(): Promise<HeadlessJob[]> {
  let entries;
  try {
    entries = await readdir(headlessRoot(), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
  const jobs: HeadlessJob[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      jobs.push(await readHeadlessJob(join(headlessRoot(), entry.name, "job.json")));
    } catch {}
  }
  return jobs.sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export async function finishHeadlessJob(
  path: string,
  status: "completed" | "failed",
  exitCode: number,
  error: string | null,
): Promise<void> {
  const job = await readHeadlessJob(path);
  job.status = status;
  job.exit_code = exitCode;
  job.error = error;
  job.completed_at = new Date().toISOString();
  await writeHeadlessJob(path, job);
}

export async function waitForHeadlessLaunch(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const job = await readHeadlessJob(path);
    if (job.status !== "launching") return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error("Headless launcher did not finish recording the controller");
}
