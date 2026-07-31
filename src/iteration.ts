import Ajv2020 from "ajv/dist/2020.js";
import schema from "../schemas/iteration-result.schema.json";
import type { ImplementationResult } from "./result.js";

export interface IterationResult {
  outcome: "improved" | "converged" | "needs-decision" | "blocked";
  summary: string;
  changed_files: string[];
  implementation_decisions: { decision: string; reason: string }[];
  brief_deviations: { deviation: string; reason: string }[];
  verification: { command: string; status: "passed" | "failed" | "not-run"; details: string }[];
  remaining_risks: string[];
  question: string;
  commit_message: string;
}

const validateSchema = new Ajv2020({ allErrors: true }).compile<IterationResult>(schema);

export function validateIterationResult(value: unknown): string[] {
  if (!validateSchema(value)) {
    return (validateSchema.errors ?? []).map(
      (error) => `Iteration result ${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
    );
  }
  if (value.outcome === "improved" && value.changed_files.length === 0) {
    return ["Iteration result /changed_files must be non-empty when outcome is improved"];
  }
  if (value.outcome === "converged" && value.changed_files.length > 0) {
    return ["Iteration result /changed_files must be empty when outcome is converged"];
  }
  if ((value.outcome === "needs-decision" || value.outcome === "blocked") && !value.question.trim()) {
    return [`Iteration result /question must be non-empty when outcome is ${value.outcome}`];
  }
  return [];
}

export function iterationAsImplementationResult(value: IterationResult): ImplementationResult {
  return {
    status: value.outcome === "needs-decision" || value.outcome === "blocked" ? value.outcome : "completed",
    summary: value.summary,
    changed_files: value.changed_files,
    implementation_decisions: value.implementation_decisions,
    brief_deviations: value.brief_deviations,
    verification: value.verification,
    remaining_risks: value.remaining_risks,
    question: value.question,
    commit_message: value.commit_message,
  };
}
