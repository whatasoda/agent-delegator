import { describe, expect, test } from "bun:test";
import { validateVerificationResult } from "../src/verification.js";

describe("verification result", () => {
  test("accepts an evidence-based passed result", () => {
    expect(validateVerificationResult({
      status: "passed",
      summary: "The focused smoke test passed",
      policy_sources: ["AGENTS.md", "package.json"],
      checks: [{ command: "bun run test", status: "passed", details: "12 tests", basis: "AGENTS.md" }],
      remaining_risks: [],
    })).toEqual([]);
  });

  test("keeps aggregate status consistent with checks", () => {
    expect(validateVerificationResult({
      status: "passed",
      summary: "Nothing ran",
      policy_sources: [],
      checks: [],
      remaining_risks: [],
    })).toContain("passed verification requires at least one check and every check must pass");
  });
});
