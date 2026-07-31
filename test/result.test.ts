import { describe, expect, test } from "bun:test";
import { validateImplementationResult } from "../src/result.js";

function result(status: "completed" | "needs-decision" | "blocked" = "completed") {
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
});
