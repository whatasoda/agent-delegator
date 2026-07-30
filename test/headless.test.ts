import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  finishHeadlessJob,
  headlessJobPath,
  listHeadlessJobs,
  type HeadlessJob,
  writeHeadlessJob,
} from "../src/headless.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  delete process.env.AGENT_DELEGATOR_HEADLESS_DIR;
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("headless job store", () => {
  test("lists and completes private machine-level job records", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-delegator-headless-"));
    temporaryDirectories.push(root);
    process.env.AGENT_DELEGATOR_HEADLESS_DIR = root;
    const now = new Date().toISOString();
    const path = headlessJobPath("job-1");
    const job: HeadlessJob = {
      schema_version: "1", id: "job-1", backend: "process", status: "running", command: "verify",
      run_id: "run-1", run_dir: "/tmp/run-1", repo_root: "/tmp/repo", controller_pid: process.pid,
      herdr_workspace_id: null, herdr_tab_id: null, herdr_pane_id: null, created_at: now, updated_at: now,
      completed_at: null, exit_code: null, error: null, stdout_path: "/tmp/stdout", stderr_path: "/tmp/stderr",
    };
    await writeHeadlessJob(path, job);
    expect((await listHeadlessJobs())[0]).toMatchObject({ id: "job-1", status: "running" });
    await finishHeadlessJob(path, "completed", 0, null);
    expect((await listHeadlessJobs())[0]).toMatchObject({ status: "completed", exit_code: 0 });
  });
});
