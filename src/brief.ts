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

export interface CitationTurnCorrection {
  claim: string;
  source_id: string;
  quote: string;
  cited_turn: number;
  corrected_turn: number;
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function presentationNormalizedText(value: string): string {
  // Fall back only for source presentation artifacts. Case and single-character code operators stay
  // significant so this does not turn referential grounding into semantic/paraphrase matching.
  return value
    .normalize("NFC")
    .replace(/\n[ \t]*(?:\/\/+|\*+|#+|--)[ \t]?/g, "\n")
    .replace(/\*\*|~~|`+/g, "")
    .replace(
      /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])[\s\u3000]+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])/gu,
      "$1",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function quoteOccursIn(content: string, quote: string): boolean {
  if (normalizedText(content).includes(normalizedText(quote))) return true;
  const normalizedQuote = presentationNormalizedText(quote);
  return normalizedQuote.length > 0 && presentationNormalizedText(content).includes(normalizedQuote);
}

const forbiddenDelegatedActions = [
  {
    action: "commit",
    pattern: /\bgit\s+commit\b|\b(?:must|shall|required\s+to)\s+commit\b|コミット(?:する|して|せよ|を作成|を実行)/giu,
  },
  {
    action: "push",
    pattern: /\bgit\s+push\b|\b(?:must|shall|required\s+to)\s+push\b|プッシュ(?:する|して|せよ|を実行)/giu,
  },
  {
    action: "open a pull request",
    pattern: /\bgh\s+pr\s+create\b|\b(?:open|create)\s+(?:a\s+)?(?:pull\s+request|PR)\b|(?:PR|プルリクエスト)を(?:作成|起票)する/giu,
  },
  {
    action: "merge",
    pattern: /\bgit\s+merge\b|\b(?:must|shall|required\s+to)\s+merge\b|マージ(?:する|して|せよ|を実行)/giu,
  },
  {
    action: "deploy",
    pattern: /\b(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?deploy\b|\b(?:wrangler|vercel)\s+deploy\b|\b(?:must|shall|required\s+to)\s+deploy\b|デプロイ(?:する|して|せよ|を実行)/giu,
  },
] as const;

function isNegatedAction(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 48), start).toLowerCase();
  const after = text.slice(end, Math.min(text.length, end + 32)).toLowerCase();
  return /(?:do\s+not|don't|must\s+not|never|without)[^.!?;\n]{0,48}$/.test(before) ||
    /(?:禁止|行わない|実行しない|しない|せず|不要)/u.test(after);
}

function forbiddenAction(text: string): string | null {
  for (const candidate of forbiddenDelegatedActions) {
    candidate.pattern.lastIndex = 0;
    for (const match of text.matchAll(candidate.pattern)) {
      const start = match.index ?? 0;
      if (!isNegatedAction(text, start, start + match[0].length)) return candidate.action;
    }
  }
  return null;
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

function transcriptTurns(content: string): { turn: number; content: string }[] {
  const turns: { turn: number; content: string }[] = [];
  const pattern = /<transcript-turn number=["'](\d+)["'][^>]*>\n([\s\S]*?)\n<\/transcript-turn>/g;
  for (const match of content.matchAll(pattern)) {
    turns.push({
      turn: Number(match[1]),
      content: match[2]!
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&"),
    });
  }
  return turns;
}

function contiguousOverlapScore(content: string, quote: string): number {
  const quoteCharacters = Array.from(presentationNormalizedText(quote));
  if (quoteCharacters.length < 8 || quoteCharacters.length > 512) return 0;
  const row = new Uint16Array(quoteCharacters.length + 1);
  let longest = 0;
  for (const contentCharacter of presentationNormalizedText(content)) {
    for (let index = quoteCharacters.length; index > 0; index -= 1) {
      row[index] = contentCharacter === quoteCharacters[index - 1]
        ? row[index - 1]! + 1
        : 0;
      if (row[index]! > longest) longest = row[index]!;
    }
  }
  return longest / quoteCharacters.length;
}

function nearestTranscriptTurns(
  turns: { turn: number; content: string }[],
  quote: string,
): { turn: number; score: number }[] {
  return turns
    .map((turn) => ({ turn: turn.turn, score: contiguousOverlapScore(turn.content, quote) }))
    .filter((candidate) => candidate.score >= 0.5)
    .sort((left, right) => right.score - left.score || left.turn - right.turn)
    .slice(0, 3);
}

function nearestTurnDiagnostic(candidates: { turn: number; score: number }[]): string {
  if (candidates.length === 0) return "";
  const label = candidates.length === 1 ? "turn" : "turns";
  return `; nearest transcript ${label} by contiguous overlap: ${candidates
    .map((candidate) => `${candidate.turn} (${Math.round(candidate.score * 100)}%)`)
    .join(", ")}`;
}

function briefSourceGroups(brief: BriefDraft): { label: string; sources: BriefSource[] }[] {
  return [
    ...brief.decisions.map((item, index) => ({ label: `decision ${index + 1}`, sources: item.sources })),
    ...brief.constraints.map((item, index) => ({ label: `constraint ${index + 1}`, sources: item.sources })),
    ...brief.unresolved_items.map((item, index) => ({ label: `unresolved item ${index + 1}`, sources: item.sources })),
  ];
}

export function repairBriefCitationTurns(
  brief: BriefDraft,
  evidenceSources: Map<string, BriefEvidenceSource>,
): { brief: BriefDraft; corrections: CitationTurnCorrection[] } {
  const repaired = structuredClone(brief);
  const corrections: CitationTurnCorrection[] = [];
  for (const group of briefSourceGroups(repaired)) {
    for (const source of group.sources) {
      if (source.turn === null) continue;
      const evidence = evidenceSources.get(source.source_id);
      if (evidence?.kind !== "transcript" || evidence.content === undefined) continue;
      const cited = citedContent(source, evidence);
      if (cited !== null && quoteOccursIn(cited, source.quote)) continue;
      const candidates = transcriptTurns(evidence.content)
        .filter((turn) => quoteOccursIn(turn.content, source.quote));
      if (candidates.length !== 1) continue;
      const citedTurn = source.turn;
      source.turn = candidates[0]!.turn;
      corrections.push({
        claim: group.label,
        source_id: source.source_id,
        quote: source.quote,
        cited_turn: citedTurn,
        corrected_turn: source.turn,
      });
    }
  }
  return { brief: repaired, corrections };
}

export function validateBriefEvidence(
  brief: BriefDraft,
  evidenceSources: Map<string, BriefEvidenceSource>,
): string[] {
  const errors: string[] = [];
  for (const group of briefSourceGroups(brief)) {
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
      const turns = evidence.kind === "transcript" && source.turn !== null && evidence.content !== undefined
        ? transcriptTurns(evidence.content)
        : [];
      const candidateTurns = turns
        .filter((turn) => quoteOccursIn(turn.content, source.quote))
        .map((turn) => turn.turn);
      const nearestTurns = candidateTurns.length === 0
        ? nearestTranscriptTurns(turns, source.quote)
        : [];
      if (evidence.content !== undefined && content === null) {
        if (candidateTurns.length) {
          errors.push(
            `${group.label} quote occurs in ${source.source_id} transcript turn${candidateTurns.length === 1 ? "" : "s"} ${candidateTurns.join(", ")}, not cited turn ${source.turn}`,
          );
        } else {
          errors.push(
            `${group.label} cites turn ${source.turn} that is absent from ${source.source_id}${nearestTurnDiagnostic(nearestTurns)}`,
          );
        }
      } else if (content !== null && !quoteOccursIn(content, source.quote)) {
        if (candidateTurns.length) {
          errors.push(
            `${group.label} quote occurs in ${source.source_id} transcript turn${candidateTurns.length === 1 ? "" : "s"} ${candidateTurns.join(", ")}, not cited turn ${source.turn}`,
          );
        } else {
          errors.push(
            `${group.label} quote does not occur in ${source.source_id}${source.turn ? ` turn ${source.turn}` : ""}${nearestTurnDiagnostic(nearestTurns)}`,
          );
        }
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
    if (constraint.level === "must") {
      const action = forbiddenAction(constraint.rule);
      if (action) errors.push(`MUST constraint ${index + 1} requires forbidden delegated action: ${action}`);
    }
  }
  for (const [index, command] of brief.verification.entries()) {
    const action = forbiddenAction(command);
    if (action) errors.push(`Verification item ${index + 1} requires forbidden delegated action: ${action}`);
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
