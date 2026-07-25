import { describe, expect, test } from "bun:test";
import { renderBrief, type BriefDraft, validateBrief, validateBriefEvidence } from "../src/brief.js";

function brief(): BriefDraft {
  return {
    schema_version: "1",
    objective: "Delegate an implementation",
    motivation: "Keep design authority with Claude",
    current_behavior: ["Claude implements directly"],
    desired_behavior: ["Codex implements an approved Brief"],
    decisions: [
      {
        statement: "Claude approves before implementation",
        status: "accepted",
        rationale: "The compiler must not become the designer",
        sources: [{ source_id: "source-001", turn: 12, quote: "keep design authority with Claude" }],
      },
    ],
    constraints: [
      {
        level: "must",
        rule: "Require approval",
        rationale: "Avoid lossy reinterpretation",
        failure_mode: "Codex implements an unreviewed design",
        sources: [{ source_id: "source-001", turn: 12, quote: "approve the brief" }],
      },
    ],
    scope: { in_scope: ["local CLI"], out_of_scope: ["deployment"] },
    implementation_guidance: ["Use structured output"],
    acceptance_criteria: ["Approval hash is checked"],
    verification: ["bun test"],
    escalation_conditions: ["A MUST conflicts with docs"],
    unresolved_items: [],
  };
}

describe("Brief", () => {
  test("validates and renders a complete draft", () => {
    const draft = brief();
    expect(validateBrief(draft)).toEqual([]);
    expect(renderBrief(draft)).toContain("## Decision ledger");
    expect(renderBrief(draft)).toContain("**MUST**");
  });

  test("rejects a MUST without evidence", () => {
    const draft = brief();
    draft.constraints[0]!.sources = [];
    expect(validateBrief(draft)).toContain("MUST constraint 1 has no evidence source");
  });

  test("reports a missing required field without throwing", () => {
    const draft = brief() as Partial<BriefDraft>;
    delete draft.scope;

    expect(() => validateBrief(draft)).not.toThrow();
    expect(validateBrief(draft).join("\n")).toContain("must have required property 'scope'");
  });

  test("rejects enum violations and additional properties", () => {
    const draft = brief() as BriefDraft & { invented?: string };
    draft.decisions[0]!.status = "invented" as BriefDraft["decisions"][number]["status"];
    draft.invented = "not allowed";
    const errors = validateBrief(draft).join("\n");

    expect(errors).toContain("must be equal to one of the allowed values");
    expect(errors).toContain("must NOT have additional properties");
  });

  test("requires an explicit null turn for non-transcript citations", () => {
    const draft = brief();
    delete (draft.decisions[0]!.sources[0] as Partial<BriefDraft["decisions"][number]["sources"][number]>).turn;
    expect(validateBrief(draft).join("\n")).toContain("must have required property 'turn'");

    draft.decisions[0]!.sources[0]!.turn = null;
    expect(validateBrief(draft)).toEqual([]);
  });

  test("rejects citations to sources outside the Evidence Bundle", () => {
    const draft = brief();
    draft.constraints[0]!.sources[0]!.source_id = "source-999";

    expect(
      validateBriefEvidence(
        draft,
        new Map([["source-001", { kind: "transcript", revision: "turns:1-20" }]]),
      ),
    ).toContain(
      "constraint 1 cites unknown evidence source source-999",
    );
  });

  test("rejects turn citations on files and outside a selected transcript range", () => {
    const fileCitation = brief();
    expect(
      validateBriefEvidence(
        fileCitation,
        new Map([["source-001", { kind: "file", revision: "10:100" }]]),
      ).join("\n"),
    ).toContain("turn 12 on non-transcript source source-001");

    const outOfRange = brief();
    expect(
      validateBriefEvidence(
        outOfRange,
        new Map([["source-001", { kind: "transcript", revision: "turns:20-30" }]]),
      ).join("\n"),
    ).toContain("turn 12 outside source-001 range 20-30");
  });

  test("rejects a fabricated quote and checks transcript quotes within the cited turn", () => {
    const draft = brief();
    const content = `<transcript-turn number="12" source-line="14" role="assistant">
keep design authority with Claude and approve the brief
</transcript-turn>`;
    const sources = new Map([
      ["source-001", { kind: "transcript" as const, revision: "turns:1-20", content }],
    ]);
    expect(validateBriefEvidence(draft, sources)).toEqual([]);

    draft.decisions[0]!.sources[0]!.quote = "a quote that was never present";
    expect(validateBriefEvidence(draft, sources)).toContain(
      "decision 1 quote does not occur in source-001 turn 12",
    );
  });
});
