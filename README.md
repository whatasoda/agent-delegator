# agent-delegator

A repository-local prototype for delegating implementation from Claude Code to Codex. It is kept
under `tools/` and has no dependency on the daifuku application packages so it can later move into
an independent package.

For independent verification from Claude Code, follow
[`CLAUDE_ACCEPTANCE_HANDOFF.md`](./CLAUDE_ACCEPTANCE_HANDOFF.md).
For portability trials across multiple real repositories, follow
[`CLAUDE_CROSS_REPOSITORY_VALIDATION_HANDOFF.md`](./CLAUDE_CROSS_REPOSITORY_VALIDATION_HANDOFF.md)
after the single-repository trust-boundary acceptance is current.
For a zero-edit prompt that derives each target from the current Claude session, use
[`examples/claude-validation-prompt.md`](./examples/claude-validation-prompt.md).

The rationale behind the architecture, settled trade-offs, gap to the intended end state, and
roadmap are maintained in [`docs/DESIGN_AND_ROADMAP.md`](./docs/DESIGN_AND_ROADMAP.md).

## Pipeline

```text
Claude design work + project context
  -> Context Request (scope selected by Claude)
  -> collect (deterministic snapshots and Evidence Bundle)
  -> compile (Codex, read-only, separately configurable model slot)
  -> brief.json + brief.md
  -> approve (Claude quality gate + content hashes)
  -> implement (Codex, workspace-write, separately configurable model slot)
  -> result.json
  -> resume when a design decision is required
  -> Claude evaluation + cross-run observation report
```

The Context Request says which conversations and repository sources belong to the task. Collection
copies that bounded source set into hash-checked run-local snapshots. The Evidence Bundle records why
each source was selected, its role, and its hash. `brief.json` is the canonical draft, and the
approved `brief.md` is the implementation contract.

The transcript is therefore one evidence type, not the entire context model. Raw evidence is shown
to the read-only compiler, then removed from the implementer prompt. The implementer receives the
approved Brief and durable repository guidance; missing context must become `needs-decision` rather
than an attempt to reinterpret the transcript.

## Two ways to start

For a small task whose decisions are all in the current Claude conversation, use the compatible
one-command path:

```sh
bun run agent-delegator compile \
  --objective="Implement the already-designed change" \
  --task-type=feature \
  --complexity=medium \
  --tags=api,trial
```

This creates an implicit Context Request containing the current transcript. If
`agent-delegator.project.json` exists, its default sources are included automatically.

For a task with multiple discussion threads, a selected turn range, or additional design sources,
create a Context Request and separate collection from compilation:

```sh
bun run agent-delegator collect \
  --context=tools/agent-delegator/examples/context-request.json

# Review context-request.json, evidence-bundle.json, evidence.md, and exclusions first.
bun run agent-delegator compile --run <run-id>
```

Splitting the steps lets Claude correct source coverage without spending a compiler-model call.

## Context Request

[`examples/context-request.json`](./examples/context-request.json) shows the full format. It can
select:

- Multiple Claude transcripts by explicit path, session ID, or the current process-tree session.
- A bounded inclusive `from_turn` / `to_turn` range for each transcript.
- Repository files and globs with a declared role and selection rationale.
- Named project-profile topics such as `backend`, `twitch`, or `realtime`.
- Per-source, aggregate-size, and file-count limits.
- A raw transcript input cap (`max_transcript_input_bytes`, default 20 MiB) applied before parsing.
- Observation metadata (`task_type`, `complexity`, and project-specific `tags`) used only for
  comparison and reporting, not as implementation instructions.

Source roles are `policy`, `specification`, `decision`, `context`, `implementation`, `diagnostic`,
and `external`. They help the Brief compiler distinguish durable rules from discussion or incidental
implementation state; content inside every snapshot is still treated as untrusted evidence.

An omitted `project_profile` automatically uses `<repo>/agent-delegator.project.json` when present.
Set it to `null` to disable the profile for a particular request. A named topic must exist in the
profile, and required files/globs must resolve or collection fails.

## Project profile

[`../../agent-delegator.project.json`](../../agent-delegator.project.json) is this repository's
routing table. Its default sources include `AGENTS.md` and `CLAUDE.md`; topic routes add only the
relevant design documents. Profiles are versioned project policy, while a Context Request is the
task-specific selection made by Claude.

Profiles deliberately do not perform semantic search. At this stage, Claude chooses the topic and
explicit sources. Discovery adapters, searchable indexes, and automatic relevance expansion can be
added later without changing the Evidence Bundle or approval boundary.

## Remaining commands

From the repository root:

```sh
bun run agent-delegator resolve-transcript --json
bun run agent-delegator approve --run <run-id>
bun run agent-delegator implement --run <run-id>
bun run agent-delegator resume \
  --run <run-id> \
  --message="Claude's decision and rationale"
bun run agent-delegator status --run <run-id>
bun run agent-delegator status --run <run-id> --observation
bun run agent-delegator evaluate \
  --run <run-id> \
  --evaluation=tools/agent-delegator/examples/evaluation-input.json
bun run agent-delegator report --format=markdown
bun run agent-delegator report --format=json
```

Model flags are optional. If omitted, Codex uses its configured default. Environment variables let
the Claude skill select different default models without hard-coding model names in the tool:

- `AGENT_DELEGATOR_BRIEF_MODEL`
- `AGENT_DELEGATOR_IMPLEMENT_MODEL`

These are independent model-selection slots, not automatic cheap/high-quality routing. If neither
slot is configured, both stages may use the same Codex default model. Cost/quality-based routing is
a later roadmap item.

For free-text values, prefer the single-argument `--option="value"` form, such as
`--message="Claude's decision"`. The CLI rejects unknown positional arguments, duplicate options,
and guarded flags placed after a separately-valued free-text option so imperfect shell quoting
cannot silently turn transcript-derived text into an override or disable redaction.

## Transcript resolution

Resolution follows this order:

1. Explicit `path` / `--transcript`.
2. Explicit `session_id` / `--session-id` lookup.
3. For `current: true`, walk parent PIDs and read `<CLAUDE_CONFIG_DIR>/sessions/<pid>.json`.
4. Resolve the session under `<CLAUDE_CONFIG_DIR>/projects` by direct path or session index.
5. The newest same-repository transcript is used only with explicit `--allow-latest-fallback`.

The process-tree and index strategy is adapted from the existing `agent-extensions` session
resolver. `CLAUDE_CONFIG_DIR` is supported; the default is `~/.claude`.

Textual user and assistant turn numbering remains stable. Tool calls/results are omitted except for
structurally matched `AskUserQuestion` prompts and user answers, which are appended as decision
events without consuming turn numbers. Common credential-shaped strings are redacted.
`transcript.md` remains as a compatibility view containing the selected transcript snapshots;
`evidence.md` is the canonical complete compiler input.

## Run files

Runs are stored under `.agent-delegator/runs/<run-id>/` and ignored by Git.

Important files:

- `state.json` — lifecycle state and Codex session IDs.
- `context-request.json` — normalized task-specific source selection.
- `evidence/source-*.md` — redacted source snapshots protected by collection/approval hashes.
- `evidence-bundle.json` — source IDs, roles, locators, revisions, reasons, hashes, and exclusions.
- `evidence.md` — complete indexed evidence presented to the compiler.
- `transcript.md` — compatibility view of transcript evidence only.
- `brief.json` — current canonical Brief, including Claude review edits.
- `brief.generated.json` — the unedited, successfully validated compiler output.
- `brief.md` — rendered implementation contract.
- `brief.approved.json` / `brief.approved.md` — the exact Claude-approved Brief.
- `approval.json` — Claude approval and content hashes.
- `approvals/<attempt>/` — approval history plus its worktree baseline checkpoint.
- `attempts/<stage>/<attempt>/` — per-attempt prompts, raw structured output, Codex events, stderr,
  and post-attempt worktree checkpoints for compile, implement, and resume. Every Codex attempt also
  records `attempt-metadata.json` with the tool package version, Git revision, dirty state, and a
  checkout worktree fingerprint captured before invocation.
- `run-events.jsonl` — validated, append-only lifecycle events with timing, failure category,
  artifacts, metrics, model, and token usage when Codex emits it.
- `result.json` — latest canonical implementer result.
- `decision-ledger.jsonl` — focused questions and Claude's resume responses.
- `evaluations/<attempt>/evaluation.json` — Claude's manual acceptance assessment joined with
  automatic Brief/worktree comparison; `evaluation.json` is the latest copy.

Use `--runs-dir` to move runtime state elsewhere.

Run directories are created with mode `0700` and tool-written files with `0600`. Generated output
is re-permissioned after Codex exits. This protects against accidental disclosure to other local OS
users, but the artifacts still contain potentially sensitive design context. Delete completed runs
according to the repository's retention policy; this prototype does not prune them automatically.
Worktree patches, evaluation notes, raw Codex events, and prompts can all be sensitive; publishing a
report does not make its underlying run directory safe to share.

Codex may print `Reading additional input from stdin...` on stderr even though the CLI supplies no
stdin content; this is a harmless Codex diagnostic. Event streams may also contain intermediate
agent messages. The schema-constrained object in `--output-last-message` is the canonical result,
and the complete event stream remains diagnostic evidence.

Some Codex CLI releases may also repeatedly log a `codex_models_manager` cache error mentioning a
missing `supports_reasoning_summaries` field. It was observed with Codex CLI 0.144.5 without an
execution failure. Treat it as known version-specific noise only when the Codex process still emits
normal events and a valid result; otherwise retain and investigate it with the rest of `stderr.log`.
The delegator deliberately does not filter this line, because a similar future error may accompany a
real model-discovery failure.

## Observation workflow

Observation is designed for trial operation, not only incident debugging. A run records its input
mix, initial tool identity plus each Codex attempt's tool revision/dirty fingerprint, stage
durations, retries, model slots, Codex token usage, failure taxonomy, generated-versus-
approved Brief changes, approval baseline, and each implementation checkpoint. Checkpoint patches
include tracked and untracked files; fingerprints also cover untracked file contents.

After Claude has reviewed the diff and verification, copy and edit
[`examples/evaluation-input.json`](./examples/evaluation-input.json), then run `evaluate`. The manual
assessment records outcome, Brief/implementation/communication quality, verification status,
1–5 ratings, issue categories, notes, and tags. The tool adds:

- Whether Claude changed the generated Brief before approval and a structural JSON difference count.
- Whether the worktree changed after Codex's latest checkpoint.
- Compiler, implementation, and resume attempt counts and the final worktree fingerprint.

`report` scans all run directories and emits a versioned JSON dataset or a Markdown summary. It
includes acceptance, accepted-as-is, failures, needs-decision/blocked counts, Brief edit rate,
task/complexity/model/tool-revision/outcome breakdowns, average ratings and stage durations, source volume, token
totals, and token-telemetry coverage. Old runs without observation events remain reportable with
unknown metadata and explicit telemetry gaps. Invalid/corrupt runs are listed instead of silently
discarded.

Token numbers are observations from Codex JSONL, not inferred billing data. A Codex version that
does not emit usage remains visible as an uncovered call. The report does not calculate currency
cost because model pricing and billing semantics are external and time-dependent.

## Safety properties

- Brief compilation runs in a read-only Codex sandbox.
- Repository evidence paths and resolved symlinks must stay inside the repository root.
- Collection bounds file count and source/aggregate byte sizes, rejects binary sources, redacts
  credential-shaped strings, and records optional omissions.
- `max_source_bytes` bounds each rendered snapshot (and rejects an oversized raw repository file
  before reading it); `max_total_bytes` bounds the sum of rendered snapshots. Limits are checked
  before a snapshot is written.
- Repository containment violations always fail collection, even when the requested source is
  optional. Optionality covers absence, not permission to escape the repository.
- Generated and Claude-edited Briefs are validated against the complete JSON Schema. Brief
  citations must refer to a source ID in the collected Evidence Bundle, and each citation quote must
  occur in that snapshot. During compilation, a quote attributed to the wrong transcript turn is
  corrected only when the same quote identifies exactly one turn in that snapshot. The raw compiler
  output remains in `attempts/compile/NNN/output.json`, and corrections are recorded separately in
  `citation-turn-corrections.json`; ambiguous or absent quotes still fail validation. Approval stays
  strict about the canonical turn. This is referential integrity, not proof that the quote
  semantically supports the claim; Claude owns that review.
- Every MUST requires rationale, failure mode, and collected evidence.
- Approval v3 covers `brief.json`, `brief.md`, `evidence-bundle.json`, and `evidence.md`; verification
  also rehashes `context-request.json` and every individual source snapshot.
- Approval v3 binds the canonical repository root, base commit, and dirty-worktree fingerprint.
- `state.json` records the collected Bundle hash to detect accidental pre-approval drift. Because it
  lives in the same local run directory, this is a consistency check, not a signature against a
  hostile local writer; approval remains the durable workflow boundary.
- Implementation refuses to start when repository HEAD or dirty-worktree contents changed after
  approval unless the caller explicitly acknowledges the reviewed change with
  `--allow-base-change` or `--allow-worktree-change`.
- Implementation and resume run in `workspace-write`; neither receives an automatic bypass flag.
- Resume re-verifies approval, the Evidence Bundle, and Git HEAD before sending a decision.
- Prompts forbid commits, pushes, PR creation, deploys, and external mutations.
- Unresolved Brief items block approval by default.
- The Claude main agent reviews the source coverage, Brief, diff, and integration.

The local hashes and `approvedBy` metadata are workflow consistency controls, not authentication or
a defense against a hostile writer who can replace every file in the run directory. Redaction is
best-effort credential-shape filtering, not DLP. `workspace-write` constrains filesystem writes but
does not turn prompt instructions into an absolute external-mutation security boundary.

## Failure and resume operations

Codex calls time out after 1800 seconds by default. Override this with `--timeout-seconds` or
`AGENT_DELEGATOR_TIMEOUT_SECONDS`. Stderr and event streams are retained per attempt.

The caller's foreground-command timeout is separate from the agent-delegator timeout. When Claude's
shell tool cannot wait for the configured Codex duration, keep the controller alive with the shell
tool's supported background mechanism, retain its output, and poll `status --observation` plus the
attempt logs. A caller timeout that terminates the controller is an interruption, not evidence that
Codex made no edits. Inspect the worktree and surviving child processes before retrying.

`status` detects an active state whose controller process disappeared and converts it to `failed`.
A failed read-only compiler call can be retried with `compile --run <id> --retry`. A failed
workspace-write call requires `implement --retry` or `resume --retry`; inspect the repository first,
and add `--allow-worktree-change` only when the partial diff is understood. Retries are never
automatic because a prior implementer may already have changed files.

`needs-decision` means Claude can answer one focused design/contract question. `blocked` means an
operational obstacle rather than a missing design choice. A Resume Addendum may answer the previous
focused question only. If the answer changes a MUST, scope, acceptance criterion, or product
behavior, edit/recompile/reapprove the Brief or start a new run instead. Responses are recorded in
`decision-ledger.jsonl` and resume the same Codex thread.

## Collection-only smoke test

Evidence collection can be tested without invoking Codex:

```sh
bun run agent-delegator compile \
  --objective="Test current-context extraction" \
  --dry-run
```

For explicit requests, `collect --context=...` is already a no-Codex operation.
