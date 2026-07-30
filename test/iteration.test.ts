import { describe, expect, test } from "bun:test";
import {
  iterationAsImplementationResult,
  type IterationResult,
  validateIterationResult,
} from "../src/iteration.js";

const converged: IterationResult = {
  outcome: "converged",
  summary: "The Brief is satisfied.",
  changed_files: [],
  implementation_decisions: [],
  brief_deviations: [],
  verification: [{ command: "bun run test", status: "passed", details: "All tests passed" }],
  remaining_risks: [],
  question: "",
};

describe("iteration result", () => {
  test("maps a converged iteration to a resumable-compatible implementation result", () => {
    expect(validateIterationResult(converged)).toEqual([]);
    expect(iterationAsImplementationResult(structuredClone(converged))).toMatchObject({
      status: "completed",
      summary: "The Brief is satisfied.",
    });
  });

  test("requires changes for improved and a question for escalation", () => {
    expect(validateIterationResult({ ...converged, outcome: "improved" })).toContain(
      "Iteration result /changed_files must be non-empty when outcome is improved",
    );
    expect(validateIterationResult({ ...converged, outcome: "needs-decision" })).toContain(
      "Iteration result /question must be non-empty when outcome is needs-decision",
    );
    expect(validateIterationResult({ ...converged, changed_files: ["src/index.ts"] })).toContain(
      "Iteration result /changed_files must be empty when outcome is converged",
    );
    expect(validateIterationResult({ ...converged, outcome: "blocked" })).toContain(
      "Iteration result /question must be non-empty when outcome is blocked",
    );
  });
});
