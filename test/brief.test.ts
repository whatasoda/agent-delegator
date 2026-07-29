import { describe, expect, test } from "bun:test";
import {
  repairBriefCitationSources,
  repairBriefCitationTurns,
  renderBrief,
  type BriefDraft,
  validateBrief,
  validateBriefEvidence,
} from "../src/brief.js";
import { renderTranscriptEvidence } from "../src/transcript.js";

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

  test("rejects delegated integration actions while allowing explicit prohibitions", () => {
    const requiredCommit = brief();
    requiredCommit.constraints[0]!.rule = "変更後は英語のConventional Commits形式でコミットする";
    expect(validateBrief(requiredCommit)).toContain(
      "MUST constraint 1 requires forbidden delegated action: commit",
    );

    const command = brief();
    command.verification = ["git push origin feature/task"];
    expect(validateBrief(command)).toContain(
      "Verification item 1 requires forbidden delegated action: push",
    );

    for (const [rule, action] of [
      ["Open a pull request after verification", "open a pull request"],
      ["git merge feature/task", "merge"],
      ["bun run deploy", "deploy"],
    ] as const) {
      const integration = brief();
      integration.constraints[0]!.rule = rule;
      expect(validateBrief(integration)).toContain(
        `MUST constraint 1 requires forbidden delegated action: ${action}`,
      );
    }

    const prohibited = brief();
    prohibited.constraints[0]!.rule = "Do not git commit or git push from the delegated run";
    prohibited.verification = ["コミットしないことを確認する"];
    expect(validateBrief(prohibited)).toEqual([]);

    const dryRun = brief();
    dryRun.verification = ["cd apps/backend && bunx wrangler deploy --dry-run"];
    expect(validateBrief(dryRun)).toEqual([]);

    const scriptNames = brief();
    scriptNames.verification = ["bun run deploy:check", "npm run deploy-preview"];
    expect(validateBrief(scriptNames)).toEqual([]);

    const descriptive = brief();
    descriptive.constraints[0]!.rule = "Record the base commit hash in diagnostics";
    expect(validateBrief(descriptive)).toEqual([]);
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

  test("repairs a source id only when the verbatim quote identifies one different source", () => {
    const draft = brief();
    const sources = new Map([
      ["source-001", {
        kind: "transcript" as const,
        revision: "turns:1-20",
        content: `<transcript-turn number="12" source-line="14" role="assistant">
The operator must approve the brief.
</transcript-turn>`,
      }],
      ["source-002", {
        kind: "file" as const,
        revision: "fixture:2",
        content: "The workflow must keep design authority with Claude.",
      }],
    ]);

    const repaired = repairBriefCitationSources(draft, sources);
    expect(repaired.brief.decisions[0]!.sources[0]!.source_id).toBe("source-002");
    expect(draft.decisions[0]!.sources[0]!.source_id).toBe("source-001");
    expect(repaired.corrections).toEqual([{
      claim: "decision 1",
      quote: "keep design authority with Claude",
      cited_source_id: "source-001",
      corrected_source_id: "source-002",
      cited_turn: 12,
      corrected_turn: null,
    }]);
    expect(validateBriefEvidence(repaired.brief, sources)).toEqual([]);
  });

  test("does not repair a quote that occurs in multiple evidence sources", () => {
    const draft = brief();
    draft.decisions[0]!.sources[0]!.turn = null;
    const sources = new Map([
      ["source-001", { kind: "file" as const, revision: "fixture:1", content: "unrelated" }],
      ["source-002", {
        kind: "file" as const,
        revision: "fixture:2",
        content: "keep design authority with Claude",
      }],
      ["source-003", {
        kind: "file" as const,
        revision: "fixture:3",
        content: "keep design authority with Claude",
      }],
    ]);

    const repaired = repairBriefCitationSources(draft, sources);
    expect(repaired.corrections).toEqual([]);
    expect(repaired.brief.decisions[0]!.sources[0]!.source_id).toBe("source-001");
    expect(validateBriefEvidence(repaired.brief, sources)).toContain(
      "decision 1 quote does not occur in source-001",
    );
  });

  test("does not repair a non-verbatim quote that occurs in no evidence source", () => {
    const draft = brief();
    draft.decisions[0]!.sources[0] = {
      source_id: "source-001",
      turn: null,
      quote: "Claude retains product authority",
    };
    const sources = new Map([
      ["source-001", {
        kind: "file" as const,
        revision: "fixture:1",
        content: "keep design authority with Claude",
      }],
    ]);

    const repaired = repairBriefCitationSources(draft, sources);
    expect(repaired.corrections).toEqual([]);
    expect(validateBriefEvidence(repaired.brief, sources)).toContain(
      "decision 1 quote does not occur in source-001",
    );
  });

  test("validates a null-turn decision citation containing XML special characters", () => {
    const draft = brief();
    draft.decisions[0]!.sources[0] = {
      source_id: "source-001",
      turn: null,
      quote: "guard the branch with a && b over Array<string>",
    };
    draft.constraints[0]!.sources[0] = {
      source_id: "source-001",
      turn: null,
      quote: "Which guard shape should the parser use?",
    };
    const content = renderTranscriptEvidence(
      [{ turn: 1, sourceLine: 2, role: "user", text: "Please decide the guard shape" }],
      [{
        questionSourceLine: 5,
        answerSourceLine: 6,
        questions: [{
          question: "Which guard shape should the parser use?",
          selectedAnswer: "guard the branch with a && b over Array<string>",
          selectedRationale: null,
          presentedOptions: [],
        }],
      }],
    );
    const sources = new Map([
      ["source-001", { kind: "transcript" as const, revision: "turns:1-1", content }],
    ]);

    expect(validateBriefEvidence(draft, sources)).toEqual([]);
  });

  test("rejects a null-turn citation whose quote only matches snapshot markup or turn text", () => {
    const draft = brief();
    draft.decisions[0]!.sources[0] = {
      source_id: "source-001",
      turn: null,
      quote: "the guard belongs in turn text",
    };
    draft.constraints[0]!.sources[0] = {
      source_id: "source-001",
      turn: null,
      quote: "Untrusted Claude transcript evidence",
    };
    const content = renderTranscriptEvidence(
      [{ turn: 4, sourceLine: 8, role: "assistant", text: "the guard belongs in turn text" }],
      [],
    );
    const sources = new Map([
      ["source-001", { kind: "transcript" as const, revision: "turns:1-9", content }],
    ]);

    const errors = validateBriefEvidence(draft, sources);
    expect(errors).toContain(
      "decision 1 quote occurs in source-001 transcript turn 4, not the null-turn decision events",
    );
    expect(errors).toContain("constraint 1 quote does not occur in source-001");
  });

  test("repairs a transcript citation only when the quote identifies one different turn", () => {
    const draft = brief();
    draft.decisions[0]!.sources[0]!.turn = 10;
    draft.decisions[0]!.sources[0]!.quote = "開くまで中身は配信画面にもワイヤにも出ない";
    const content = `<transcript-turn number="8" source-line="80" role="assistant">
開くまで中身は配信画面にもワイヤにも出ない
</transcript-turn>
<transcript-turn number="10" source-line="100" role="assistant">
別の説明
</transcript-turn>
<transcript-turn number="12" source-line="120" role="assistant">
approve the brief
</transcript-turn>`;
    const sources = new Map([
      ["source-001", { kind: "transcript" as const, revision: "turns:1-20", content }],
    ]);

    const repaired = repairBriefCitationTurns(draft, sources);
    expect(repaired.brief.decisions[0]!.sources[0]!.turn).toBe(8);
    expect(draft.decisions[0]!.sources[0]!.turn).toBe(10);
    expect(repaired.corrections).toEqual([{
      claim: "decision 1",
      source_id: "source-001",
      quote: "開くまで中身は配信画面にもワイヤにも出ない",
      cited_turn: 10,
      corrected_turn: 8,
    }]);
    expect(validateBriefEvidence(repaired.brief, sources)).toEqual([]);
  });

  test("does not repair an ambiguous transcript quote and reports candidate turns", () => {
    const draft = brief();
    draft.decisions[0]!.sources[0]!.turn = 10;
    draft.decisions[0]!.sources[0]!.quote = "既定 on";
    const content = `<transcript-turn number="22" source-line="220" role="assistant">
別の説明
</transcript-turn>
<transcript-turn number="23" source-line="230" role="assistant">
既定 on
</transcript-turn>
<transcript-turn number="25" source-line="250" role="assistant">
既定 on
</transcript-turn>
<transcript-turn number="12" source-line="120" role="assistant">
approve the brief
</transcript-turn>`;
    const sources = new Map([
      ["source-001", { kind: "transcript" as const, revision: "turns:1-30", content }],
    ]);

    const repaired = repairBriefCitationTurns(draft, sources);
    expect(repaired.corrections).toEqual([]);
    expect(repaired.brief.decisions[0]!.sources[0]!.turn).toBe(10);
    expect(validateBriefEvidence(repaired.brief, sources)).toContain(
      "decision 1 quote occurs in source-001 transcript turns 23, 25, not cited turn 10",
    );
  });

  test("suggests nearest transcript turns without accepting a non-verbatim quote", () => {
    const draft = brief();
    draft.decisions[0]!.sources[0]!.turn = 10;
    draft.decisions[0]!.sources[0]!.quote = "keep design authority with Claude and review the brief";
    const content = `<transcript-turn number="10" source-line="100" role="assistant">
unrelated implementation detail
</transcript-turn>
<transcript-turn number="12" source-line="120" role="assistant">
keep design authority with Claude and approve the brief
</transcript-turn>`;
    const sources = new Map([
      ["source-001", { kind: "transcript" as const, revision: "turns:1-20", content }],
    ]);

    const repaired = repairBriefCitationTurns(draft, sources);
    expect(repaired.corrections).toEqual([]);
    const errors = validateBriefEvidence(repaired.brief, sources);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("quote does not occur in source-001 turn 10");
    expect(errors[0]).toContain("nearest transcript turn by contiguous overlap: 12");
  });

  test("accepts a null-turn citation to a structured transcript decision", () => {
    const draft = brief();
    draft.decisions[0]!.sources[0] = {
      source_id: "source-001",
      turn: null,
      quote: "Intrinsic layout",
    };
    const content = `<transcript-turn number="12" source-line="14" role="assistant">
approve the brief
</transcript-turn>
<transcript-decision question-source-line="10" answer-source-line="11">
<selected-answer>Intrinsic layout</selected-answer>
</transcript-decision>`;
    expect(validateBriefEvidence(draft, new Map([
      ["source-001", { kind: "transcript", revision: "turns:1-20", content }],
    ]))).toEqual([]);
  });

  test("matches a verbatim quote that spans a source line-comment continuation", () => {
    const draft = brief();
    // A file source whose comment PROSE wraps across a `//`-prefixed continuation line — the shape
    // that heavily-commented TS sources produce. The quote is the clean prose, exactly as a compiler
    // (following the "exact substring" instruction) would cite it.
    const fileContent = "// Keep parse helpers\n// here (not raw schemas) exported so callers depend on a typed function.";
    draft.decisions[0]!.sources[0] = {
      source_id: "source-002",
      turn: null,
      quote: "Keep parse helpers here (not raw schemas) exported so callers depend on a typed function.",
    };
    const transcript = `<transcript-turn number="12" source-line="14" role="assistant">\napprove the brief\n</transcript-turn>`;
    const sources = new Map([
      // the surviving constraint still cites this transcript turn
      ["source-001", { kind: "transcript" as const, revision: "turns:1-20", content: transcript }],
      ["source-002", { kind: "file" as const, revision: "100:1", content: fileContent }],
    ]);
    // Comment markers are insignificant, so the wrapped prose quote matches — no false rejection.
    expect(validateBriefEvidence(draft, sources)).toEqual([]);

    // Inline markdown emphasis and code delimiters are presentation too.
    sources.set("source-002", { kind: "file" as const, revision: "100:1", content: "applies the **SERVER-SIDE** disclosure `filter`" });
    draft.decisions[0]!.sources[0]!.quote = "SERVER-SIDE disclosure filter";
    expect(validateBriefEvidence(draft, sources)).toEqual([]);

    // Case remains significant because it can distinguish identifiers and protocol values.
    draft.decisions[0]!.sources[0]!.quote = "server-side disclosure filter";
    expect(validateBriefEvidence(draft, sources)).toContain("decision 1 quote does not occur in source-002");

    // Removing presentation delimiters must not turn a punctuation-only quote into an empty match.
    draft.decisions[0]!.sources[0]!.quote = "```";
    expect(validateBriefEvidence(draft, sources)).toContain("decision 1 quote does not occur in source-002");

    // Line wrapping between CJK characters is presentation, not a word boundary.
    sources.set("source-002", { kind: "file" as const, revision: "100:1", content: "FilterField の\n導入を決定する" });
    draft.decisions[0]!.sources[0]!.quote = "FilterField の導入を決定する";
    expect(validateBriefEvidence(draft, sources)).toEqual([]);

    // The guard is not thereby loosened: a genuine paraphrase (different WORDS) still fails.
    draft.decisions[0]!.sources[0]!.quote = "applies the client-side disclosure filter";
    expect(validateBriefEvidence(draft, sources)).toContain("decision 1 quote does not occur in source-002");
  });
});
