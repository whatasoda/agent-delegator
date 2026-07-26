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
});
