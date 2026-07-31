import Ajv2020 from "ajv/dist/2020.js";
import resultSchema from "../schemas/result.schema.json";

export interface ImplementationResult {
  status: "completed" | "needs-decision" | "blocked";
  summary: string;
  changed_files: string[];
  implementation_decisions: { decision: string; reason: string }[];
  brief_deviations: { deviation: string; reason: string }[];
  verification: { command: string; status: "passed" | "failed" | "not-run"; details: string }[];
  remaining_risks: string[];
  question: string;
  commit_message: string;
}

const validateResultSchema = new Ajv2020({ allErrors: true }).compile<ImplementationResult>(resultSchema);

export function validateImplementationResult(value: unknown): string[] {
  if (!validateResultSchema(value)) {
    return (validateResultSchema.errors ?? []).map(
      (error) => `Result schema ${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
    );
  }
  const errors: string[] = [];
  if ((value.status === "needs-decision" || value.status === "blocked") && !value.question.trim()) {
    errors.push(`${value.status} result must contain a focused non-empty question`);
  }
  return errors;
}
