import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApproval, verifyApproval } from "../src/approval.js";
import { sha256File } from "../src/files.js";

const temporaryDirectories: string[] = [];

function approvalOptions(runDir: string) {
  return {
    approvedBy: "claude",
    allowUnresolved: false,
    repoRoot: runDir,
    baseCommit: "0123456789abcdef0123456789abcdef01234567",
    worktreeSha256: "a".repeat(64),
  };
}

async function approvalFixture(): Promise<string> {
  const runDir = await mkdtemp(join(tmpdir(), "agent-delegator-approval-"));
  temporaryDirectories.push(runDir);
  await mkdir(join(runDir, "evidence"));
  await writeFile(join(runDir, "brief.json"), "{}\n");
  await writeFile(join(runDir, "brief.md"), "# Brief\n");
  await writeFile(join(runDir, "evidence.md"), "# Evidence\n");
  await writeFile(join(runDir, "context-request.json"), "{}\n");
  const snapshotPath = join(runDir, "evidence", "source-001.md");
  await writeFile(snapshotPath, "source evidence\n");
  await writeFile(
    join(runDir, "evidence-bundle.json"),
    `${JSON.stringify({
      schema_version: "1",
      objective: "Approval fixture",
      repo_root: runDir,
      generated_at: new Date().toISOString(),
      context_request_sha256: await sha256File(join(runDir, "context-request.json")),
      evidence_markdown_sha256: await sha256File(join(runDir, "evidence.md")),
      project_profile: null,
      sources: [{
        id: "source-001",
        kind: "file",
        role: "context",
        trust: "project",
        locator: "fixture.md",
        revision: null,
        selected_because: "Approval fixture",
        snapshot_path: "evidence/source-001.md",
        sha256: await sha256File(snapshotPath),
        bytes: 16,
      }],
      excluded_sources: [],
    })}\n`,
  );
  return runDir;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("approval hashes", () => {
  test("accepts unchanged inputs", async () => {
    const runDir = await approvalFixture();

    const approval = await createApproval(runDir, approvalOptions(runDir));
    expect(approval.schemaVersion).toBe(3);
    expect(approval.repoRoot).toBe(runDir);
    await expect(verifyApproval(runDir)).resolves.toMatchObject({ schemaVersion: 3 });
  });

  for (const [file, expectedMessage] of [
    ["brief.json", "brief.json changed after approval"],
    ["brief.md", "brief.md changed after approval"],
    ["evidence-bundle.json", "evidence-bundle.json changed after approval"],
    ["evidence.md", "evidence.md changed after approval"],
  ] as const) {
    test(`rejects a post-approval change to ${file}`, async () => {
      const runDir = await approvalFixture();

      await createApproval(runDir, approvalOptions(runDir));
      await writeFile(join(runDir, file), "changed after approval\n");

      await expect(verifyApproval(runDir)).rejects.toThrow(expectedMessage);
    });
  }

  test("rejects a changed evidence snapshot even when the bundle is unchanged", async () => {
    const runDir = await approvalFixture();
    await createApproval(runDir, approvalOptions(runDir));
    await writeFile(join(runDir, "evidence", "source-001.md"), "changed source\n");

    await expect(verifyApproval(runDir)).rejects.toThrow("evidence/source-001.md changed after evidence collection");
  });

  test("rejects a changed Context Request", async () => {
    const runDir = await approvalFixture();
    await createApproval(runDir, approvalOptions(runDir));
    await writeFile(join(runDir, "context-request.json"), "{\"changed\":true}\n");

    await expect(verifyApproval(runDir)).rejects.toThrow("context-request.json changed after evidence collection");
  });

  test("binds approval to the expected repository identity", async () => {
    const runDir = await approvalFixture();
    const options = approvalOptions(runDir);
    await createApproval(runDir, options);

    await expect(
      verifyApproval(runDir, { repoRoot: runDir, baseCommit: "different" }),
    ).rejects.toThrow("Approval repository identity does not match");
  });

  test("rejects malformed approval records before using them", async () => {
    const runDir = await approvalFixture();
    const approval = await createApproval(runDir, approvalOptions(runDir));
    await writeFile(join(runDir, "approval.json"), JSON.stringify({ ...approval, unexpected: true }));

    await expect(verifyApproval(runDir)).rejects.toThrow(
      "approval.json does not match a supported approval schema",
    );
  });
});
