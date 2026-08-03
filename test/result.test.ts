import { describe, expect, test } from "bun:test";
import {
  type ImplementationResult,
  normalizeImplementationResult,
  validateImplementationResult,
} from "../src/result.js";

function result(status: "completed" | "needs-decision" | "blocked" = "completed"): ImplementationResult {
  return {
    status,
    summary: "Implemented the approved task",
    changed_files: [],
    implementation_decisions: [],
    brief_deviations: [],
    verification: [],
    remaining_risks: [],
    question: status === "completed" ? "" : "Which approved option should be used?",
    commit_message: "",
  };
}

describe("implementation result", () => {
  test("accepts a complete schema-constrained result", () => {
    expect(validateImplementationResult(result())).toEqual([]);
  });

  test("accepts a completed implementation with environment-blocked verification", () => {
    const payload = result();
    payload.verification = [{
      command: "bun run test",
      status: "environment_blocked",
      details: "The sandbox cannot bind the test server port",
    }];
    payload.remaining_risks = ["The integration owner must rerun bun run test outside the sandbox"];
    expect(validateImplementationResult(payload)).toEqual([]);
  });

  test("rejects missing fields instead of accepting status alone", () => {
    expect(validateImplementationResult({ status: "completed" }).join("\n")).toContain(
      "must have required property 'summary'",
    );
  });

  test("requires the strict-output commit message placeholder", () => {
    const { commit_message: _commitMessage, ...missing } = result();
    expect(validateImplementationResult(missing).join("\n")).toContain(
      "must have required property 'commit_message'",
    );
  });

  test("requires a focused question for resumable statuses", () => {
    const payload = result("needs-decision");
    payload.question = "";
    expect(validateImplementationResult(payload)).toContain(
      "needs-decision result must contain a focused non-empty question",
    );
  });

  test("normalizes a blocked result without a question while preserving its report", () => {
    const payload = result("blocked");
    payload.question = "";
    payload.changed_files = ["src/index.ts"];
    const normalized = normalizeImplementationResult(payload);

    expect(normalized.value).toMatchObject({
      status: "needs-decision",
      question: "Implemented the approved task",
      changed_files: ["src/index.ts"],
    });
    expect(normalized.normalization).toMatchObject({ code: "blocked_missing_question" });
    expect(validateImplementationResult(normalized.value)).toEqual([]);
    expect(payload.status).toBe("blocked");
  });
});
