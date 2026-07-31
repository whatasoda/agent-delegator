import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("delegation prompts", () => {
  test("requires cross-variant coverage gaps to remain unresolved", async () => {
    const prompt = await readFile(resolve(import.meta.dir, "../prompts/compile-brief.md"), "utf8");
    const normalized = prompt.replace(/\s+/g, " ");

    expect(normalized).toContain("A narrow source does not justify a broader guarantee");
    expect(normalized).toContain("every relevant variant and branch");
    expect(normalized).toContain("add an unresolved item naming the coverage gap");
    expect(normalized).toContain("do not narrow an explicitly general requirement");
  });

  test("keeps delegated research evidence-oriented and read-only", async () => {
    const prompt = await readFile(resolve(import.meta.dir, "../prompts/research.md"), "utf8");
    const normalized = prompt.replace(/\s+/g, " ");

    expect(normalized).toContain("without editing the repository or mutating external state");
    expect(normalized).toContain("name its basis");
    expect(normalized).toContain("Do not commit, push, create a PR, deploy");
  });

  test("keeps autonomous improvement inside the approved Brief", async () => {
    const prompt = await readFile(resolve(import.meta.dir, "../prompts/iterate.md"), "utf8");
    const normalized = prompt.replace(/\s+/g, " ");

    expect(normalized).toContain("The Brief remains the complete task contract");
    expect(normalized).toContain("Do not broaden scope, revise a MUST, invent product behavior");
    expect(normalized).toContain("Return `converged` when no further meaningful in-scope change is justified");
    expect(normalized).toContain("Do not commit, push, create or merge a PR, deploy");
  });

  test("keeps delegated verification compatible with the workspace sandbox", async () => {
    const compiler = (await readFile(resolve(import.meta.dir, "../prompts/compile-brief.md"), "utf8"))
      .replace(/\s+/g, " ");
    const implementer = (await readFile(resolve(import.meta.dir, "../prompts/implement.md"), "utf8"))
      .replace(/\s+/g, " ");
    const iterator = (await readFile(resolve(import.meta.dir, "../prompts/iterate.md"), "utf8"))
      .replace(/\s+/g, " ");
    const verifier = (await readFile(resolve(import.meta.dir, "../prompts/verify.md"), "utf8"))
      .replace(/\s+/g, " ");

    expect(compiler).toContain("runnable in a workspace-write sandbox");
    expect(compiler).toContain("Network access or additional writable roots may be required only when collected evidence");
    expect(compiler).toContain("Do not assume the sandbox can launch Chrome");
    expect(compiler).toContain("do not normalize or reconstruct it");
    expect(compiler).toContain("Never present an unresolved URL, path, identifier");
    expect(implementer).toContain("Record an unavailable owner-only check as `not-run`");
    expect(implementer).toContain("do not return `blocked` solely because");
    expect(iterator).toContain("network-dependent checks as `not-run`");
    expect(verifier).toContain("read the repository's durable instructions");
    expect(verifier).toContain("do not guess a generic package-manager command");
  });
});
