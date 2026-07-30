import Ajv2020 from "ajv/dist/2020.js";
import schema from "../schemas/research-result.schema.json";

export interface ResearchResult {
  status: "answered" | "needs-input" | "blocked";
  summary: string;
  findings: { finding: string; basis: string[] }[];
  recommendations: string[];
  uncertainties: string[];
  follow_up_question: string;
}

const validateSchema = new Ajv2020({ allErrors: true }).compile<ResearchResult>(schema);

export function validateResearchResult(value: unknown): string[] {
  if (!validateSchema(value)) {
    return (validateSchema.errors ?? []).map(
      (error) => `Research result ${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
    );
  }
  if ((value.status === "needs-input" || value.status === "blocked") && !value.follow_up_question.trim()) {
    return [`Research result /follow_up_question must be non-empty when status is ${value.status}`];
  }
  return [];
}
