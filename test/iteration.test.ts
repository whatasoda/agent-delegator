import { describe, expect, test } from "bun:test";
import {
  iterationAsImplementationResult,
  normalizeIterationResult,
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
  commit_message: "",
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

  test("normalizes a blocked outcome without losing verification details", () => {
    const blocked: IterationResult = {
      ...converged,
      outcome: "blocked",
      verification: [{
        command: "bun run typecheck",
        status: "environment_blocked",
        details: "Dependencies are unavailable in the sandbox",
      }],
    };
    const normalized = normalizeIterationResult(blocked);
    expect(normalized.value).toMatchObject({
      outcome: "needs-decision",
      question: "The Brief is satisfied.",
      verification: [{ status: "environment_blocked" }],
    });
    expect(validateIterationResult(normalized.value)).toEqual([]);
  });
});
