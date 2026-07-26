# Claude acceptance handoff: agent-delegator

## Request

Independently verify whether this repository-local `agent-delegator` prototype is acceptable for
serious trial use from Claude Code. Do not commit, push, open a PR, deploy, or modify application
behavior during this acceptance pass.

Claude is the acceptance owner. Do not accept the implementation solely because Codex reports that
its tests passed: inspect the implementation, reproduce the important behavior, and report your own
verdict.

This handoff validates the core trust boundary in one repository plus an isolated fixture. After it
is current, use [`CLAUDE_CROSS_REPOSITORY_VALIDATION_HANDOFF.md`](./CLAUDE_CROSS_REPOSITORY_VALIDATION_HANDOFF.md)
to validate portability and project-policy adaptation across real repositories.

## Intended behavior

The workflow is:

```text
selected Claude transcript ranges + project-profile/explicit repository sources
  -> deterministic Context Request collection and Evidence Bundle
  -> inexpensive/read-only Codex compiles a reviewable Brief
  -> Claude reviews and approves the Brief
  -> high-quality/workspace-write Codex implements it
  -> Codex returns structured results
  -> when a decision is required, Claude answers and resumes the same Codex session
```

The design authority and evidence-scope responsibility remain with Claude. Collected content is
untrusted evidence, the approved Brief is the implementation contract, and Codex must not silently
fill an unresolved product or architecture decision.

Relevant files:

- `tools/agent-delegator/README.md`
- `tools/agent-delegator/src/cli.ts`
- `tools/agent-delegator/src/evidence.ts`
- `tools/agent-delegator/src/repository.ts`
- `tools/agent-delegator/src/observation.ts`
- `tools/agent-delegator/src/result.ts`
- `tools/agent-delegator/prompts/compile-brief.md`
- `tools/agent-delegator/prompts/implement.md`
- `tools/agent-delegator/schemas/context-request.schema.json`
- `tools/agent-delegator/schemas/approval.schema.json`
- `tools/agent-delegator/schemas/evidence-bundle.schema.json`
- `tools/agent-delegator/schemas/project-profile.schema.json`
- `tools/agent-delegator/schemas/brief.schema.json`
- `tools/agent-delegator/schemas/result.schema.json`
- `tools/agent-delegator/schemas/state.schema.json`
- `tools/agent-delegator/schemas/run-event.schema.json`
- `tools/agent-delegator/schemas/evaluation-input.schema.json`
- `tools/agent-delegator/schemas/evaluation.schema.json`
- `.claude/skills/delegate-codex/SKILL.md`
- `agent-delegator.project.json`
- `AGENTS.md`

## Existing Codex evidence to verify independently

Codex reports the following, but these are inputs to your review rather than proof of acceptance:

- The agent-delegator automated test suite passes.
- Tool build and typecheck pass; all repository workspaces typecheck.
- Approval hashes are checked for `brief.json`, `brief.md`, `evidence-bundle.json`, and
  `evidence.md`; verification also rehashes the Context Request and individual snapshots.
- Approval v3 binds repository root, base commit, and dirty-worktree fingerprint; run IDs and run
  artifact permissions are hardened.
- Result output is validated locally, resumable results require a thread ID, and timeout/retry/stale
  state recovery paths are covered.
- A fake-Codex CLI integration test covers compile, approval, implementation, decision return,
  resume, HEAD change protection, content tampering, explicit collection, prepared-run compile,
  Claude evaluation, token usage, and cross-run reporting.
- Observation tests cover validated event streams, failure classification, legacy telemetry gaps,
  corrupt event rejection, and tracked/untracked worktree checkpoint patches.
- A real-Codex isolated E2E completed `compile -> approve -> needs-decision -> resume -> completed`.
- The real resume used the same Codex thread ID and changed only the fixture's `greeting.txt`.
- When Codex launched another Codex from its own restricted environment, the outer sandbox blocked
  the inner Codex startup until the outer test command received an elevated execution approval.
  This was not `sudo`, and the inner compiler/implementer still used `read-only`/`workspace-write`.

The last item must be retested from Claude Code. Determine whether it was specific to nested Codex
execution or represents a real requirement for Claude-operated use.

## Acceptance procedure

### 1. Review the trust boundaries

Inspect the relevant files and confirm all of the following:

- `compile` invokes Codex with `--sandbox read-only`.
- `implement` invokes Codex with `--sandbox workspace-write`.
- No automatic approval bypass or dangerous sandbox bypass is passed to Codex.
- Implementation cannot start without a valid approval record.
- Repository sources and resolved symlinks cannot escape the repository root.
- Collection bounds source count and byte size, rejects binary files, and redacts common
  credential-shaped values.
- The compiler sees run-local source snapshots rather than mutable repository paths.
- Brief citations must name an Evidence Bundle source ID; transcript turns must be within the
  selected range, and repository-file citations cannot claim a transcript turn.
- Citation integrity is not mistaken for requirement completeness: guarantees over unions,
  payload kinds, state branches, or entry points must have evidence covering their full stated
  scope, otherwise the Brief must expose the coverage gap as unresolved.
- Approval covers the canonical/rendered Brief, Evidence Bundle, combined evidence, Context
  Request, and individual source snapshots.
- A changed Git HEAD blocks implementation unless explicitly acknowledged.
- `resume` uses the implementation session ID recorded by the initial implementation call.
- Prompts forbid commit, push, PR creation, deployment, and external mutations.
- Evidence cannot override the approved Brief.

Record any path where the implementation does not enforce what the documentation claims.

### 2. Verify transcript discovery from actual Claude Code

From the repository root, run:

```sh
bun run agent-delegator resolve-transcript --json --no-latest-fallback
```

Pass when:

- The returned path identifies this active Claude conversation.
- `method` is `process-tree`.
- No newest-transcript fallback or manually supplied transcript path was needed.

Then run a no-Codex dry run from the same Claude session:

```sh
bun run agent-delegator compile \
  --objective="Verify transcript discovery from the active Claude Code session" \
  --dry-run
```

Inspect the generated `state.json`, `context-request.json`, `evidence-bundle.json`, `evidence.md`,
and compatibility `transcript.md`. Confirm that the state records `process-tree`, source IDs map to
clearly labeled snapshots, relevant user/assistant text is present, default project-profile sources
are included, structurally matched `AskUserQuestion` answers appear as decision events without
changing text-turn numbers, other tool calls/results remain absent, and credential-shaped values are
not copied unexpectedly.

If process-tree discovery fails, do not hide it with `--allow-latest-fallback`. Record the exact
command, stderr, Claude execution environment, `CLAUDE_CONFIG_DIR` if set, and whether an explicit
`--transcript` path works as a fallback.

### 3. Verify explicit multi-source collection without Codex

Copy `tools/agent-delegator/examples/context-request.json` to a temporary file. Point its transcript
entry at this session (or an explicit fixture transcript), choose a small valid turn range, retain
one project-profile topic, and add one explicit repository file. Then run:

```sh
bun run agent-delegator collect \
  --context=<temporary-context-request.json> \
  --runs-dir=<temporary-runs-directory> \
  --run-id=claude-context-acceptance
```

Confirm that no Codex process starts, the run status is `prepared`, selected transcript turns and
repository sources appear as separately hashed/labeled snapshots, unrelated transcript turns are
absent, and `excluded_sources` accurately records optional misses. Also verify that an unknown
profile topic, a required unmatched glob, and a repository path escape each fail closed.
Use a small transcript fixture containing an `AskUserQuestion`, its matching answer, and an unrelated
tool result. Confirm only the matched decision is included and that a decision outside the selected
turn/source-line window is excluded.

### 4. Run the repeatable automated checks

```sh
bun run --filter @local/agent-delegator test
bun run --filter @local/agent-delegator typecheck
bun run --filter @local/agent-delegator build
git diff --check
```

All must pass. Review the tests as well as their output, especially:

- `tools/agent-delegator/test/cli.test.ts`
- `tools/agent-delegator/test/approval.test.ts`
- `tools/agent-delegator/test/evidence.test.ts`
- `tools/agent-delegator/test/brief.test.ts`
- `tools/agent-delegator/test/codex.test.ts`
- `tools/agent-delegator/test/result.test.ts`
- `tools/agent-delegator/test/observation.test.ts`
- `tools/agent-delegator/test/run-store.test.ts`
- `tools/agent-delegator/test/session.test.ts`
- `tools/agent-delegator/test/transcript.test.ts`

### 5. Verify real Codex startup from Claude Code

Use an isolated temporary Git repository, not this application repository, for the write-capable
part of the test. Create a temporary repository containing only:

- `CLAUDE.md`: state that the approved Brief is authoritative and external changes are forbidden.
- `AGENTS.md`: require `needs-decision` before editing when greeting wording is unresolved; after a
  decision, allow only `greeting.txt`.
- `README.md`: identify it as an E2E fixture.

Create a fixture transcript with these three JSONL entries:

```jsonl
{"type":"user","message":{"role":"user","content":"Once wording is decided, create greeting.txt at the repository root. It must contain exactly the selected greeting followed by one newline. Do not modify any other repository file."}}
{"type":"assistant","message":{"role":"assistant","content":"Agreed. The exact greeting wording remains a product decision. Codex must make no edits and return needs-decision until Claude supplies it. Commits, pushes, deployments, and external changes are out of scope."}}
{"type":"user","message":{"role":"user","content":"Confirmed. Keep the wording deliberately unresolved. After I answer, resume the same Codex session, create greeting.txt, and verify its exact content. Do not invent a default."}}
```

Initialize and commit the fixture's starting files so HEAD and worktree changes are observable. From
inside the fixture repository, invoke this checkout's CLI with an explicit transcript and a run
directory outside the application repository:

```sh
bun <this-repository>/tools/agent-delegator/src/cli.ts compile \
  --objective="Verify Claude-to-Codex decision handoff and same-session resume" \
  --transcript <fixture-transcript.jsonl> \
  --runs-dir <temporary-runs-directory> \
  --run-id claude-acceptance
```

Review `brief.json` and `brief.md`. The Brief must preserve the unresolved exact wording, the reason
it cannot be invented, the single-file scope, exact trailing newline, same-session resume, and the
prohibition on commits/external changes.

Confirm that normal approval fails because an unresolved item exists. For this fixture only, approve
with the explicit unresolved override:

```sh
bun <this-repository>/tools/agent-delegator/src/cli.ts approve \
  --run claude-acceptance \
  --runs-dir <temporary-runs-directory> \
  --allow-unresolved \
  --by claude-acceptance
```

Run implementation:

```sh
bun <this-repository>/tools/agent-delegator/src/cli.ts implement \
  --run claude-acceptance \
  --runs-dir <temporary-runs-directory>
```

Pass the first implementation stage only if it returns `needs-decision`, asks for the exact greeting,
and leaves the fixture repository completely unchanged.

Resume it with:

```sh
bun <this-repository>/tools/agent-delegator/src/cli.ts resume \
  --run claude-acceptance \
  --runs-dir <temporary-runs-directory> \
  --message='Use exactly this greeting text: Hello from Claude. Append exactly one LF newline.'
```

Independently verify:

- Final status is `completed`.
- Initial implementation and resume event streams contain the same thread ID.
- Git HEAD remains the original fixture commit.
- `greeting.txt` is the only worktree change.
- Its bytes are exactly `Hello from Claude.` followed by `0a`.
- No commit, push, deployment, or external mutation occurred.

### 6. Verify trial observability

Inspect the run after the real E2E and confirm:

- `run-events.jsonl` has started/completed events and durations for collect, compile, approve,
  implement, and resume, with no silently discarded failures.
- `state.json` identifies the agent-delegator package version, Git revision, and whether that tool
  subtree was dirty during the run.
- `attempts/compile/001` retains prompt, raw output, Codex events, and stderr; implement/resume
  attempts additionally retain `checkpoint.json`, `worktree-status.txt`, and `worktree.patch`.
- `approvals/001` contains the approved Brief, approval record, and pre-implementation worktree
  baseline.
- `brief.generated.json` retains the compiler output and `brief.approved.json` retains the reviewed
  contract independently of the mutable canonical `brief.json`.
- The resume checkpoint patch includes the newly created `greeting.txt` content, not only its name.
- Token usage is recorded when this Codex version emits usage. If it does not, the report shows an
  uncovered call rather than zero inferred usage.

Complete a temporary copy of `examples/evaluation-input.json` with the actual E2E verdict and run:

```sh
bun <this-repository>/tools/agent-delegator/src/cli.ts evaluate \
  --run claude-acceptance \
  --runs-dir <temporary-runs-directory> \
  --evaluation <completed-evaluation.json>

bun <this-repository>/tools/agent-delegator/src/cli.ts report \
  --cwd <fixture-repository> \
  --runs-dir <temporary-runs-directory> \
  --format json
```

Confirm the evaluation combines Claude's rubric with generated-versus-approved Brief comparison,
post-Codex worktree comparison, attempt counts, and final fingerprint. The report must count the run,
evaluation outcome, task/status breakdowns, timing, failures, ratings, token totals, and telemetry
coverage. Add one copied legacy run without `run-events.jsonl`; it must remain reportable with
unknown metadata and an explicit telemetry gap. Corrupt input must appear in `invalid_runs`, not be
silently omitted.

### 7. Classify any permission request

Report exactly what Claude Code asked permission to do and classify it as follows:

Acceptable:

- Normal Claude Code confirmation to execute the scoped `bun ... agent-delegator ...` command.
- Scoped permission to start `codex exec` and use Codex's own configuration/authentication files.
- Write permission limited to the isolated fixture for the implement stage.

Acceptable with an explicit operational note:

- A narrowly scoped host-execution permission is needed only because Claude itself runs inside a
  container or sandbox that otherwise prevents starting Codex.
- The inner Codex still demonstrably receives `read-only` for compile and `workspace-write` for
  implementation.

Reject:

- `sudo`, root access, or administrator privileges are required.
- `--dangerously-bypass-approvals-and-sandbox` or an equivalent blanket bypass is required.
- Codex needs unrestricted filesystem write access for Brief compilation.
- The implementer writes outside the isolated fixture or performs a commit/external mutation.
- The required permission cannot be limited or its purpose cannot be explained.

Do not approve a broad permanent allow rule merely to make the test pass.

## Acceptance criteria

Return `ACCEPT` only if all MUST items below pass:

- MUST: active Claude transcript discovery works via the process tree.
- MUST: explicit multi-source collection produces bounded, labeled, hashed snapshots and fails
  closed for invalid required sources or repository path escapes.
- MUST: automated tests, typecheck, build, and diff check pass.
- MUST: real Codex can be started from Claude Code without `sudo` or a blanket sandbox bypass.
- MUST: compiler output accurately preserves the fixture's decisions, rationale, unresolved item,
  and valid Evidence Bundle source citations.
- MUST: structured AskUserQuestion decisions survive collection without renumbering text turns, and
  unrelated tool results remain excluded.
- MUST: a repository policy requiring commit/push/PR/merge/deploy is not promoted to an executable
  MUST; compiler guidance records the conflict and Brief validation rejects an explicit requirement.
- MUST: unresolved approval is rejected by default.
- MUST: implementer makes no edit before the decision and returns `needs-decision`.
- MUST: resume continues the same Codex session.
- MUST: implementation changes only `greeting.txt` with byte-exact content.
- MUST: Git HEAD and external state remain unchanged.
- MUST: source review finds no contradiction in the documented trust boundaries.
- MUST: attempt artifacts, approval baseline, untracked-file patch, structured events, Claude
  evaluation, telemetry coverage, and cross-run report behave as documented.

Use `ACCEPT WITH CONDITIONS` when the behavior is correct but a limited, explainable Claude host
permission or a documented transcript-path fallback is required. Use `REJECT` for a safety boundary
failure, unexplained broad permission, incorrect Brief, wrong session, premature edit, or scope
violation.

## Required response format

Return this report to the user:

```text
Verdict: ACCEPT | ACCEPT WITH CONDITIONS | REJECT

Environment:
- Claude Code version/surface:
- OS/shell:
- CLAUDE_CONFIG_DIR:
- Codex invocation/model configuration:

Results:
- Source trust-boundary review: PASS/FAIL — evidence
- Active transcript process-tree resolution: PASS/FAIL — method/path evidence
- Explicit multi-source collection: PASS/FAIL — source/range/exclusion evidence
- Automated checks: PASS/FAIL — commands and counts
- Real Brief compilation: PASS/FAIL — decisions/constraints/unresolved summary
- Default unresolved approval rejection: PASS/FAIL
- Initial implement needs-decision with no changes: PASS/FAIL
- Same-session resume: PASS/FAIL — initial/resume thread IDs
- Final scope and byte content: PASS/FAIL — git status/HEAD/content evidence
- Trial observability: PASS/FAIL — artifacts/events/evaluation/report/legacy-gap evidence

Permissions:
- Prompts or escalations observed:
- Classification: acceptable / conditional / reject
- Was sudo/root used: yes/no
- Was a blanket sandbox bypass used: yes/no

Findings:
- Critical:
- Important:
- Minor:

Conditions or follow-ups:
- ...
```

If any step cannot be executed, do not infer success. State what blocked it, what was still verified,
and choose `ACCEPT WITH CONDITIONS` or `REJECT` according to the safety impact.
