import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectEvidence, type ContextRequest, verifyEvidenceBundle } from "../src/evidence.js";

const temporaryDirectories: string[] = [];

async function fixture(): Promise<{ root: string; repo: string; runDir: string; transcript: string }> {
  const root = await mkdtemp(join(tmpdir(), "agent-delegator-evidence-"));
  temporaryDirectories.push(root);
  const repo = join(root, "repo");
  const runDir = join(root, "run");
  const transcript = join(root, "conversation.jsonl");
  await mkdir(join(repo, "docs"), { recursive: true });
  await mkdir(runDir, { recursive: true });
  await writeFile(join(repo, "AGENTS.md"), "Project policy secret=project-secret-value\n");
  await writeFile(join(repo, "docs", "api.md"), "Current API contract\n");
  await writeFile(join(repo, "docs", "old.md"), "Old unrelated notes\n");
  await writeFile(
    join(repo, "agent-delegator.project.json"),
    JSON.stringify({
      schema_version: "1",
      default_sources: [
        { kind: "file", path: "AGENTS.md", role: "policy", selected_because: "Project policy" },
      ],
      topics: {
        api: {
          sources: [
            { kind: "glob", pattern: "docs/*.md", role: "specification", selected_because: "API docs" },
          ],
        },
      },
    }),
  );
  await writeFile(
    transcript,
    [
      JSON.stringify({ type: "user", message: { content: "unrelated opening" } }),
      JSON.stringify({ type: "assistant", message: { content: "API decision" } }),
      JSON.stringify({ type: "user", message: { content: "Confirmed access_token=abcdefghijklmnop" } }),
      JSON.stringify({ type: "assistant", message: { content: "unrelated ending" } }),
    ].join("\n"),
  );
  return { root, repo, runDir, transcript };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("evidence collection", () => {
  test("collects a transcript slice and profile sources into a hashed bundle", async () => {
    const { repo, runDir, transcript } = await fixture();
    const request: ContextRequest = {
      schema_version: "1",
      objective: "Change the API",
      profile_topics: ["api"],
      transcripts: [
        {
          kind: "transcript",
          path: transcript,
          from_turn: 2,
          to_turn: 3,
          role: "decision",
          selected_because: "Relevant decision range",
        },
      ],
      sources: [],
    };

    const { bundle } = await collectEvidence({ repoRoot: repo, runDir, request, redact: true });

    expect(bundle.sources).toHaveLength(4);
    expect(bundle.sources.map((source) => source.role)).toEqual([
      "decision",
      "policy",
      "specification",
      "specification",
    ]);
    expect(bundle.project_profile?.path).toBe("agent-delegator.project.json");
    const evidence = await readFile(join(runDir, "evidence.md"), "utf8");
    expect(evidence).toContain("### source-001:");
    expect(evidence).toContain("API decision");
    expect(evidence).not.toContain("unrelated opening");
    expect(evidence).not.toContain("unrelated ending");
    expect(evidence).not.toContain("abcdefghijklmnop");
    expect(evidence).not.toContain("project-secret-value");
    expect(await readFile(join(runDir, "context-request.json"), "utf8")).toContain('"profile_topics"');
  });

  test("rejects unknown profile topics", async () => {
    const { repo, runDir, transcript } = await fixture();
    const request: ContextRequest = {
      schema_version: "1",
      objective: "Unknown route",
      profile_topics: ["missing"],
      transcripts: [{ kind: "transcript", path: transcript }],
      sources: [],
    };

    await expect(collectEvidence({ repoRoot: repo, runDir, request })).rejects.toThrow(
      "Project profile does not define topic: missing",
    );
  });

  test("rejects repository sources that escape the repository root", async () => {
    const { root, repo, runDir, transcript } = await fixture();
    const outside = join(root, "outside.md");
    await writeFile(outside, "outside\n");
    const request: ContextRequest = {
      schema_version: "1",
      objective: "Escape check",
      project_profile: null,
      profile_topics: [],
      transcripts: [{ kind: "transcript", path: transcript }],
      sources: [{ kind: "file", path: "../outside.md" }],
    };

    await expect(collectEvidence({ repoRoot: repo, runDir, request })).rejects.toThrow(
      "Repository source escapes the repository root",
    );
  });

  test("collects multiple independently sliced transcripts", async () => {
    const { root, repo, runDir, transcript } = await fixture();
    const secondTranscript = join(root, "second-conversation.jsonl");
    await writeFile(
      secondTranscript,
      [
        JSON.stringify({ type: "user", message: { content: "second unrelated opening" } }),
        JSON.stringify({ type: "assistant", message: { content: "second selected decision" } }),
      ].join("\n"),
    );
    const request: ContextRequest = {
      schema_version: "1",
      objective: "Combine decisions",
      project_profile: null,
      profile_topics: [],
      transcripts: [
        { kind: "transcript", path: transcript, from_turn: 2, to_turn: 2 },
        { kind: "transcript", path: secondTranscript, from_turn: 2, to_turn: 2 },
      ],
      sources: [],
    };

    const { bundle } = await collectEvidence({ repoRoot: repo, runDir, request });

    expect(bundle.sources.map((source) => source.revision)).toEqual(["turns:2-2", "turns:2-2"]);
    const evidence = await readFile(join(runDir, "evidence.md"), "utf8");
    expect(evidence).toContain("API decision");
    expect(evidence).toContain("second selected decision");
    expect(evidence).not.toContain("second unrelated opening");
  });

  test("records an optional empty glob and rejects a required empty glob", async () => {
    const { root, repo, runDir, transcript } = await fixture();
    const optionalRequest: ContextRequest = {
      schema_version: "1",
      objective: "Optional glob",
      project_profile: null,
      profile_topics: [],
      transcripts: [{ kind: "transcript", path: transcript }],
      sources: [{ kind: "glob", pattern: "missing/*.md", required: false }],
    };
    const { bundle } = await collectEvidence({ repoRoot: repo, runDir, request: optionalRequest });
    expect(bundle.excluded_sources).toEqual([
      { locator: "missing/*.md", reason: "Optional glob matched no files" },
    ]);

    const requiredRun = join(root, "required-run");
    await mkdir(requiredRun);
    const requiredRequest = structuredClone(optionalRequest);
    requiredRequest.sources[0]!.required = true;
    await expect(collectEvidence({ repoRoot: repo, runDir: requiredRun, request: requiredRequest })).rejects.toThrow(
      "Required source glob matched no files",
    );
  });

  test("rejects a repository symlink that resolves outside the root", async () => {
    const { root, repo, runDir, transcript } = await fixture();
    const outside = join(root, "outside-via-link.md");
    await writeFile(outside, "outside\n");
    await symlink(outside, join(repo, "linked.md"));
    const request: ContextRequest = {
      schema_version: "1",
      objective: "Symlink escape check",
      project_profile: null,
      profile_topics: [],
      transcripts: [{ kind: "transcript", path: transcript }],
      sources: [{ kind: "file", path: "linked.md", required: false }],
    };

    await expect(collectEvidence({ repoRoot: repo, runDir, request })).rejects.toThrow(
      "Repository source escapes the repository root",
    );
  });

  test("rejects an optional glob when a match resolves outside the repository", async () => {
    const { repo, runDir, transcript } = await fixture();
    const request: ContextRequest = {
      schema_version: "1",
      objective: "Optional glob escape check",
      project_profile: null,
      profile_topics: [],
      transcripts: [{ kind: "transcript", path: transcript }],
      sources: [{ kind: "glob", pattern: "../*.jsonl", required: false }],
    };

    await expect(collectEvidence({ repoRoot: repo, runDir, request })).rejects.toThrow(
      "Repository source escapes the repository root",
    );
  });

  test("rejects an escaping optional glob even when it matches no files", async () => {
    const { repo, runDir, transcript } = await fixture();
    const request: ContextRequest = {
      schema_version: "1",
      objective: "Static glob escape check",
      project_profile: null,
      profile_topics: [],
      transcripts: [{ kind: "transcript", path: transcript }],
      sources: [{ kind: "glob", pattern: "../definitely-missing/*.md", required: false }],
    };

    await expect(collectEvidence({ repoRoot: repo, runDir, request })).rejects.toThrow(
      "Repository source escapes the repository root",
    );
  });

  test("rejects binary files and source selections over their byte limit", async () => {
    const { root, repo, runDir, transcript } = await fixture();
    await writeFile(join(repo, "binary.dat"), Buffer.from([1, 0, 2]));
    const binaryRequest: ContextRequest = {
      schema_version: "1",
      objective: "Binary check",
      project_profile: null,
      profile_topics: [],
      transcripts: [{ kind: "transcript", path: transcript }],
      sources: [{ kind: "file", path: "binary.dat" }],
    };
    await expect(collectEvidence({ repoRoot: repo, runDir, request: binaryRequest })).rejects.toThrow(
      "Evidence source appears to be binary",
    );

    const limitedRun = join(root, "limited-run");
    await mkdir(limitedRun);
    const limitedRequest = structuredClone(binaryRequest);
    limitedRequest.sources = [];
    limitedRequest.limits = { max_source_bytes: 8 };
    await expect(collectEvidence({ repoRoot: repo, runDir: limitedRun, request: limitedRequest })).rejects.toThrow(
      "Evidence source exceeds max_source_bytes",
    );
    expect(await readdir(limitedRun)).not.toContain("evidence");
  });

  test("records glob-matched binary or oversized files as exclusions instead of failing", async () => {
    const { repo, runDir, transcript } = await fixture();
    await mkdir(join(repo, "docs"), { recursive: true });
    await writeFile(join(repo, "docs", "diagram.md"), Buffer.from([1, 0, 2]));
    await writeFile(join(repo, "docs", "huge.md"), "x".repeat(4096));
    await writeFile(join(repo, "docs", "usable.md"), "A small usable doc\n");
    const request: ContextRequest = {
      schema_version: "1",
      objective: "Lenient glob",
      project_profile: null,
      profile_topics: [],
      transcripts: [{ kind: "transcript", path: transcript }],
      sources: [{ kind: "glob", pattern: "docs/*.md", role: "specification" }],
      limits: { max_source_bytes: 2048 },
    };

    const { bundle } = await collectEvidence({ repoRoot: repo, runDir, request });

    expect(bundle.excluded_sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ locator: "docs/diagram.md", reason: "Binary content" }),
      expect.objectContaining({ locator: "docs/huge.md", reason: "Exceeds max_source_bytes (2048)" }),
    ]));
    expect(bundle.sources.some((source) => source.locator.endsWith("docs/usable.md"))).toBe(true);
  });

  test("caps raw transcript input before reading it into memory", async () => {
    const { repo, runDir, transcript } = await fixture();
    const request: ContextRequest = {
      schema_version: "1",
      objective: "Transcript input cap",
      project_profile: null,
      profile_topics: [],
      transcripts: [{ kind: "transcript", path: transcript }],
      sources: [],
      limits: { max_transcript_input_bytes: 8 },
    };

    await expect(collectEvidence({ repoRoot: repo, runDir, request })).rejects.toThrow(
      "Transcript input exceeds max_transcript_input_bytes",
    );
    expect(await readdir(runDir)).not.toContain("evidence");
  });

  test("counts deduplicated usable sources and keeps snapshot files private", async () => {
    const { repo, runDir, transcript } = await fixture();
    const request: ContextRequest = {
      schema_version: "1",
      objective: "Deduplicated count",
      project_profile: null,
      profile_topics: [],
      transcripts: [{ kind: "transcript", path: transcript }],
      sources: [
        { kind: "file", path: "AGENTS.md" },
        { kind: "file", path: "AGENTS.md" },
      ],
      limits: { max_files: 2 },
    };
    const { bundle } = await collectEvidence({ repoRoot: repo, runDir, request });
    expect(bundle.sources).toHaveLength(2);
    expect((await stat(join(runDir, bundle.sources[0]!.snapshot_path))).mode & 0o777).toBe(0o600);
  });

  test("verifies combined evidence and keeps snapshot paths inside the run", async () => {
    const { root, repo, runDir, transcript } = await fixture();
    const request: ContextRequest = {
      schema_version: "1",
      objective: "Bundle verification",
      project_profile: null,
      profile_topics: [],
      transcripts: [{ kind: "transcript", path: transcript }],
      sources: [],
    };
    await collectEvidence({ repoRoot: repo, runDir, request });
    await expect(verifyEvidenceBundle(runDir)).resolves.toBeUndefined();

    const evidencePath = join(runDir, "evidence.md");
    await writeFile(evidencePath, `${await readFile(evidencePath, "utf8")}tampered\n`);
    await expect(verifyEvidenceBundle(runDir)).rejects.toThrow("evidence.md changed after evidence collection");

    const secondRun = join(root, "escape-run");
    await mkdir(secondRun);
    await collectEvidence({ repoRoot: repo, runDir: secondRun, request });
    const outside = join(root, "outside-snapshot.md");
    await writeFile(outside, "outside snapshot\n");
    const bundlePath = join(secondRun, "evidence-bundle.json");
    const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
    bundle.sources[0].snapshot_path = "../outside-snapshot.md";
    bundle.sources[0].sha256 = new Bun.CryptoHasher("sha256").update("outside snapshot\n").digest("hex");
    await writeFile(bundlePath, JSON.stringify(bundle));
    await expect(verifyEvidenceBundle(secondRun)).rejects.toThrow("Evidence snapshot escapes the run directory");
  });
});
