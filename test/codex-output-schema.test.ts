import { describe, expect, test } from "bun:test";
import briefSchema from "../schemas/brief.schema.json";
import iterationResultSchema from "../schemas/iteration-result.schema.json";
import researchResultSchema from "../schemas/research-result.schema.json";
import resultSchema from "../schemas/result.schema.json";
import verificationResultSchema from "../schemas/verification-result.schema.json";

const codexOutputSchemas = {
  brief: briefSchema,
  implementation: resultSchema,
  iteration: iterationResultSchema,
  research: researchResultSchema,
  verification: verificationResultSchema,
};

function strictObjectErrors(value: unknown, path = "$", errors: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => strictObjectErrors(item, `${path}[${index}]`, errors));
    return errors;
  }
  if (typeof value !== "object" || value === null) return errors;
  const schema = value as Record<string, unknown>;
  if (schema.type === "object") {
    const properties = typeof schema.properties === "object" && schema.properties !== null
      ? Object.keys(schema.properties as Record<string, unknown>).sort()
      : [];
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === "string").sort()
      : [];
    if (schema.additionalProperties !== false) errors.push(`${path} must set additionalProperties to false`);
    if (JSON.stringify(required) !== JSON.stringify(properties)) {
      errors.push(`${path} required keys must equal property keys: ${required.join(",")} != ${properties.join(",")}`);
    }
  }
  for (const [key, child] of Object.entries(schema)) strictObjectErrors(child, `${path}.${key}`, errors);
  return errors;
}

describe("Codex structured output schemas", () => {
  for (const [name, schema] of Object.entries(codexOutputSchemas)) {
    test(`${name} is strict-compatible at every object`, () => {
      expect(strictObjectErrors(schema)).toEqual([]);
    });
  }
});
