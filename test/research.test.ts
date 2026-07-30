import { describe, expect, test } from "bun:test";
import { validateResearchResult } from "../src/research.js";

describe("research result", () => {
  test("accepts a complete evidence-oriented response", () => {
    expect(validateResearchResult({
      status: "answered",
      summary: "The behavior is localized.",
      findings: [{ finding: "The CLI owns dispatch.", basis: ["src/cli.ts"] }],
      recommendations: ["Keep the new path read-only."],
      uncertainties: [],
      follow_up_question: "",
    })).toEqual([]);
  });

  test("rejects an unstructured answer", () => {
    expect(validateResearchResult({ status: "answered", summary: "Done" }).length).toBeGreaterThan(0);
  });

  test("requires a focused question when more input is needed", () => {
    expect(validateResearchResult({
      status: "needs-input",
      summary: "A decision is missing.",
      findings: [],
      recommendations: [],
      uncertainties: ["The target is ambiguous."],
      follow_up_question: "",
    })).toEqual(["Research result /follow_up_question must be non-empty when status is needs-input"]);
    expect(validateResearchResult({
      status: "blocked",
      summary: "Repository access is unavailable.",
      findings: [],
      recommendations: [],
      uncertainties: [],
      follow_up_question: "",
    })).toEqual(["Research result /follow_up_question must be non-empty when status is blocked"]);
  });

  test("requires a basis for every finding", () => {
    expect(validateResearchResult({
      status: "answered",
      summary: "A finding lacks evidence.",
      findings: [{ finding: "The CLI owns dispatch.", basis: [] }],
      recommendations: [],
      uncertainties: [],
      follow_up_question: "",
    }).some((error) => error.includes("/findings/0/basis"))).toBe(true);
  });
});
