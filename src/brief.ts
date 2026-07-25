import Ajv2020 from "ajv/dist/2020.js";
import briefSchema from "../schemas/brief.schema.json";

export interface BriefSource {
  source_id: string;
  turn: number | null;
  quote: string;
}

export interface BriefDecision {
  statement: string;
  status: "accepted" | "rejected" | "superseded" | "proposed" | "unresolved";
  rationale: string;
  sources: BriefSource[];
}

export interface BriefConstraint {
  level: "must" | "should" | "may";
  rule: string;
  rationale: string;
  failure_mode: string;
  sources: BriefSource[];
}

export interface BriefDraft {
  schema_version: "1";
  objective: string;
  motivation: string;
  current_behavior: string[];
  desired_behavior: string[];
  decisions: BriefDecision[];
  constraints: BriefConstraint[];
  scope: { in_scope: string[]; out_of_scope: string[] };
  implementation_guidance: string[];
  acceptance_criteria: string[];
  verification: string[];
  escalation_conditions: string[];
  unresolved_items: { question: string; why_it_matters: string; sources: BriefSource[] }[];
}

const validateBriefSchema = new Ajv2020({ allErrors: true }).compile<BriefDraft>(briefSchema);

function bullets(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None recorded";
}

function sources(items: BriefSource[]): string {
  return items.length > 0
    ? items
        .map((source) => `${source.source_id}${source.turn !== null ? ` turn ${source.turn}` : ""}: “${source.quote}”`)
        .join("; ")
    : "no source recorded";
}

export interface BriefEvidenceSource {
  kind: "transcript" | "file";
  revision: string | null;
  content?: string;
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function citedContent(source: BriefSource, evidence: BriefEvidenceSource): string | null {
  if (evidence.content === undefined) return null;
  if (source.turn === null || evidence.kind === "file") return evidence.content;
  const turnPattern = new RegExp(
    `<transcript-turn number=["']${source.turn}["'][^>]*>\\n([\\s\\S]*?)\\n</transcript-turn>`,
  );
  const encoded = turnPattern.exec(evidence.content)?.[1];
  return encoded
    ?.replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&") ?? null;
}

export function validateBriefEvidence(
  brief: BriefDraft,
  evidenceSources: Map<string, BriefEvidenceSource>,
): string[] {
  const errors: string[] = [];
  const groups: { label: string; sources: BriefSource[] }[] = [
    ...brief.decisions.map((item, index) => ({ label: `decision ${index + 1}`, sources: item.sources })),
    ...brief.constraints.map((item, index) => ({ label: `constraint ${index + 1}`, sources: item.sources })),
    ...brief.unresolved_items.map((item, index) => ({ label: `unresolved item ${index + 1}`, sources: item.sources })),
  ];
  for (const group of groups) {
    for (const source of group.sources) {
      const evidence = evidenceSources.get(source.source_id);
      if (!evidence) {
        errors.push(`${group.label} cites unknown evidence source ${source.source_id}`);
        continue;
      }
      if (source.turn !== null && evidence.kind !== "transcript") {
        errors.push(`${group.label} cites turn ${source.turn} on non-transcript source ${source.source_id}`);
        continue;
      }
      const turnRange = evidence.revision?.match(/^turns:(\d+)-(\d+)$/);
      if (
        source.turn !== null &&
        turnRange &&
        (source.turn < Number(turnRange[1]) || source.turn > Number(turnRange[2]))
      ) {
        errors.push(
          `${group.label} cites turn ${source.turn} outside ${source.source_id} range ${turnRange[1]}-${turnRange[2]}`,
        );
      }
      const content = citedContent(source, evidence);
      if (evidence.content !== undefined && content === null) {
        errors.push(`${group.label} cites turn ${source.turn} that is absent from ${source.source_id}`);
      } else if (content !== null && !normalizedText(content).includes(normalizedText(source.quote))) {
        errors.push(`${group.label} quote does not occur in ${source.source_id}${source.turn ? ` turn ${source.turn}` : ""}`);
      }
    }
  }
  return errors;
}

export function validateBrief(brief: unknown): string[] {
  if (!validateBriefSchema(brief)) {
    return (validateBriefSchema.errors ?? []).map((error) => {
      const location = error.instancePath || "/";
      return `Brief schema ${location} ${error.message ?? "is invalid"}`;
    });
  }
  const errors: string[] = [];
  if (brief.schema_version !== "1") errors.push("schema_version must be 1");
  if (!brief.objective.trim()) errors.push("objective is empty");
  for (const [index, constraint] of brief.constraints.entries()) {
    if (constraint.level === "must" && constraint.sources.length === 0) {
      errors.push(`MUST constraint ${index + 1} has no evidence source`);
    }
    if (constraint.level === "must" && !constraint.rationale.trim()) {
      errors.push(`MUST constraint ${index + 1} has no rationale`);
    }
    if (constraint.level === "must" && !constraint.failure_mode.trim()) {
      errors.push(`MUST constraint ${index + 1} has no failure mode`);
    }
  }
  return errors;
}

export function renderBrief(brief: BriefDraft): string {
  const decisions = brief.decisions
    .map(
      (decision) =>
        `- **${decision.status}** — ${decision.statement}\n  - Why: ${decision.rationale}\n  - Evidence: ${sources(decision.sources)}`,
    )
    .join("\n");
  const constraints = brief.constraints
    .map(
      (constraint) =>
        `- **${constraint.level.toUpperCase()}** — ${constraint.rule}\n  - Why: ${constraint.rationale}\n  - Failure mode: ${constraint.failure_mode}\n  - Evidence: ${sources(constraint.sources)}`,
    )
    .join("\n");
  const unresolved = brief.unresolved_items
    .map(
      (item) =>
        `- ${item.question}\n  - Why it matters: ${item.why_it_matters}\n  - Evidence: ${sources(item.sources)}`,
    )
    .join("\n");

  return `# Implementation Brief

## Objective

${brief.objective}

## Motivation

${brief.motivation}

## Current behavior

${bullets(brief.current_behavior)}

## Desired behavior

${bullets(brief.desired_behavior)}

## Decision ledger

${decisions || "- None recorded"}

## Constraints

${constraints || "- None recorded"}

## In scope

${bullets(brief.scope.in_scope)}

## Out of scope

${bullets(brief.scope.out_of_scope)}

## Implementation guidance

${bullets(brief.implementation_guidance)}

## Acceptance criteria

${bullets(brief.acceptance_criteria)}

## Verification

${bullets(brief.verification)}

## Escalation conditions

${bullets(brief.escalation_conditions)}

## Unresolved items

${unresolved || "- None"}
`;
}
