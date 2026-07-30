import Ajv2020 from "ajv/dist/2020.js";
import verificationResultSchema from "../schemas/verification-result.schema.json";

export interface VerificationResult {
  status: "passed" | "failed" | "partial" | "not-run";
  summary: string;
  policy_sources: string[];
  checks: {
    command: string;
    status: "passed" | "failed" | "not-run";
    details: string;
    basis: string;
  }[];
  remaining_risks: string[];
}

const validateSchema = new Ajv2020({ allErrors: true }).compile<VerificationResult>(verificationResultSchema);

export function validateVerificationResult(value: unknown): string[] {
  if (!validateSchema(value)) {
    return (validateSchema.errors ?? []).map(
      (error) => `Verification result schema ${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
    );
  }
  const checks = value.checks;
  if (value.status === "passed" && (checks.length === 0 || checks.some((check) => check.status !== "passed"))) {
    return ["passed verification requires at least one check and every check must pass"];
  }
  if (value.status === "failed" && !checks.some((check) => check.status === "failed")) {
    return ["failed verification requires at least one failed check"];
  }
  if (value.status === "not-run" && checks.some((check) => check.status !== "not-run")) {
    return ["not-run verification may only contain not-run checks"];
  }
  return [];
}
