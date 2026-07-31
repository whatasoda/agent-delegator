import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import claudeUsageSchema from "../schemas/claude-usage.schema.json";
import {
  captureClaudeUsageBoundary,
  initializeClaudeUsage,
  readClaudeUsageSummary,
} from "../src/claude-usage.js";
import type { EvidenceBundle } from "../src/evidence.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

function assistant(id: string, usage: [number, number, number, number], content: unknown = "answer"): string {
  return JSON.stringify({
    type: "assistant",
    uuid: `${id}-fragment`,
    timestamp: "2026-07-31T00:00:00.000Z",
    message: {
      id,
      model: "claude-fixture",
      content,
      usage: {
        input_tokens: usage[0],
        cache_creation_input_tokens: usage[1],
        cache_read_input_tokens: usage[2],
        output_tokens: usage[3],
      },
    },
  });
}

describe("Claude transcript usage", () => {
  test("deduplicates streamed message fragments and captures selected and incremental phases", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "agent-delegator-claude-usage-"));
    temporaryDirectories.push(runDir);
    const transcript = join(runDir, "transcript.jsonl");
    const lines = [
      JSON.stringify({ type: "user", message: { content: "design" } }),
      assistant("msg-design", [2, 10, 20, 3], [{ type: "text", text: "decision" }]),
      assistant("msg-design", [2, 10, 20, 3], [{ type: "tool_use", name: "Read" }]),
      JSON.stringify({ type: "user", message: { content: "approved" } }),
    ];
    await writeFile(transcript, `${lines.join("\n")}\n`);
    const bundle = {
      schema_version: "1",
      objective: "fixture",
      repo_root: runDir,
      generated_at: "2026-07-31T00:00:00.000Z",
      context_request_sha256: "a".repeat(64),
      evidence_markdown_sha256: "b".repeat(64),
      project_profile: null,
      sources: [{
        id: "source-001", kind: "transcript", role: "decision", trust: "conversation",
        locator: transcript, revision: "turns:1-2", selected_because: "fixture",
        snapshot_path: "evidence/source.md", sha256: "c".repeat(64), bytes: 1,
      }],
      excluded_sources: [],
    } satisfies EvidenceBundle;

    await initializeClaudeUsage(runDir, bundle);
    let summary = await readClaudeUsageSummary(runDir);
    expect(summary.messages).toBe(1);
    expect(summary.fresh_tokens).toBe(15);
    expect(summary.processed_tokens).toBe(35);
    expect(summary.phases.design.output_tokens).toBe(3);

    await writeFile(transcript, `${lines.join("\n")}\n${assistant("msg-launch", [1, 4, 30, 5])}\n`);
    await captureClaudeUsageBoundary(runDir, transcript, "implement");
    summary = await readClaudeUsageSummary(runDir);
    expect(summary.messages).toBe(2);
    expect(summary.phases.orchestration.output_tokens).toBe(5);

    await writeFile(transcript, `${lines.join("\n")}\n${assistant("msg-launch", [1, 4, 30, 5])}\n${assistant("msg-review", [3, 6, 40, 7])}\n`);
    await captureClaudeUsageBoundary(runDir, transcript, "evaluate");
    summary = await readClaudeUsageSummary(runDir);
    expect(summary.messages).toBe(3);
    expect(summary.phases.review.output_tokens).toBe(7);
    expect(summary.message_ids.every((id) => /^[0-9a-f]{64}$/.test(id))).toBe(true);

    const artifact = JSON.parse(await readFile(join(runDir, "claude-usage.json"), "utf8"));
    const ajv = new Ajv2020({ formats: { "date-time": true } });
    expect(ajv.validate(claudeUsageSchema, artifact)).toBe(true);
    expect(JSON.stringify(artifact)).not.toContain("msg-design");
  });

  test("reports legacy runs without an artifact as unavailable", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "agent-delegator-claude-legacy-"));
    temporaryDirectories.push(runDir);
    expect(await readClaudeUsageSummary(runDir)).toMatchObject({
      status: "unavailable", method: null, messages: 0,
    });
  });

  test("backfills only selected evidence for a legacy run and marks the missing interval partial", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "agent-delegator-claude-backfill-"));
    temporaryDirectories.push(runDir);
    const transcript = join(runDir, "transcript.jsonl");
    await writeFile(transcript, [
      JSON.stringify({ type: "user", message: { content: "design" } }),
      assistant("msg-selected", [1, 2, 3, 4]),
      JSON.stringify({ type: "user", message: { content: "later" } }),
      assistant("msg-unattributable", [10, 20, 30, 40]),
    ].join("\n"));
    await writeFile(join(runDir, "evidence-bundle.json"), `${JSON.stringify({
      schema_version: "1", objective: "legacy", repo_root: runDir,
      generated_at: "2026-07-31T00:00:00.000Z",
      context_request_sha256: "a".repeat(64), evidence_markdown_sha256: "b".repeat(64),
      project_profile: null,
      sources: [{
        id: "source-001", kind: "transcript", role: "decision", trust: "conversation",
        locator: transcript, revision: "turns:1-2", selected_because: "fixture",
        snapshot_path: "evidence/source.md", sha256: "c".repeat(64), bytes: 1,
      }], excluded_sources: [],
    })}\n`);

    await captureClaudeUsageBoundary(runDir, transcript, "evaluate");
    const summary = await readClaudeUsageSummary(runDir);
    expect(summary).toMatchObject({ status: "partial", messages: 1, fresh_tokens: 7 });
    expect(JSON.stringify(await readFile(join(runDir, "claude-usage.json"), "utf8")))
      .not.toContain("msg-unattributable");
  });
});
