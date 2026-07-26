# Claude cross-repository validation handoff: agent-delegator

For a reusable invocation prompt that derives the target from the current Claude session, see
[`examples/claude-validation-prompt.md`](./examples/claude-validation-prompt.md).

## Request

Independently validate whether the repository-local `agent-delegator` can be operated from Claude
Code across multiple real repositories without depending on daifuku application code or silently
weakening a target repository's own guidance.

This is a validation pass, not authorization to redesign the protocol, commit to a target
repository, push, open a PR, deploy, or modify external state. Keep findings separate from fixes.
If a finding should change the tool, report it first and wait for an explicit implementation task.

The single-repository safety and lifecycle acceptance procedure remains in
[`CLAUDE_ACCEPTANCE_HANDOFF.md`](./CLAUDE_ACCEPTANCE_HANDOFF.md). Run or review that procedure before
using this handoff. This document adds portability, project-policy adaptation, and cross-run
comparison checks; it does not replace the original trust-boundary review.

## Goal

Establish evidence for all of the following:

- The same agent-delegator checkout can collect and compile context while invoked from unrelated
  repositories.
- Claude can preserve each target repository's own instructions, terminology, validation commands,
  and architecture boundaries in the approved Brief.
- Transcript discovery behaves correctly when Claude Code is launched inside each target
  repository, with explicit-path fallback documented rather than hidden.
- A write-capable Codex run is safe and useful in a dedicated target worktree.
- Run artifacts from different repositories can be evaluated with the same rubric and aggregated
  without treating missing telemetry as zero.
- The trial reveals which interfaces are genuinely stable enough to extract into a standalone
  package and which still require repository-local iteration.

This pass does **not** need to prove semantic search, automatic source discovery, cost accounting,
package installation, or organization-wide policy inheritance. Those remain roadmap work.

## Roles and authority

### Claude validation owner

- Selects the target repositories with the user.
- Reads and obeys each target repository's `AGENTS.md`, `CLAUDE.md`, and equivalent durable policy.
- Chooses evidence scope and reviews Evidence Bundle coverage.
- Reviews and, when appropriate, corrects the generated Brief before approval.
- Independently reviews every target diff and records the final evaluation.
- Owns permission classification and the final cross-repository report.

### Codex

- Compiles selected evidence in `read-only` mode.
- Implements only an approved Brief in a dedicated validation worktree using `workspace-write`.
- Returns `needs-decision` rather than inventing missing product or architecture decisions.
- Does not commit, push, open a PR, deploy, or mutate external systems.

## Required inputs

Obtain these before beginning:

1. The canonical agent-delegator checkout path. Use the `codex-delegator` worktree unless the user
   names another revision.
2. Two or three user-approved target repository paths and stable short IDs.
3. For every write-capable target, a dedicated disposable worktree or temporary clone selected
   **before collection**. Approval binds the run to an exact repository root, HEAD, and worktree;
   an approved run collected from a primary checkout cannot later be redirected to another
   worktree.
4. One external private runs directory shared by this validation pass.
5. A retention decision for the run artifacts, which may contain transcripts, prompts, evaluation
   notes, diagnostics, and full tracked/untracked worktree patches.

Do not discover and write to arbitrary repositories merely because they are present on disk. If
target paths are not supplied, present candidate categories and ask the user to choose the exact
repositories before running target-specific commands.

## Minimum target matrix

Use at least two real repositories. Prefer three when available.

| Target | Required characteristics | Purpose |
| --- | --- | --- |
| A: adjacent | Similar TypeScript/Bun or monorepo workflow, but different project guidance | Separate generic behavior from daifuku-specific assumptions |
| B: contrasting | Different language, package manager, build system, or repository layout | Test runtime and prompt portability outside the tool's native stack |
| C: context-heavy (optional) | Decisions distributed across sessions/docs or multiple policy layers | Test explicit Context Request authoring and source-selection pressure |

Do not select only empty fixtures. A synthetic fixture remains useful for destructive boundary
probes, but at least two targets must have real project guidance and real verification commands.

## Validation levels

Run the levels in order. A repository may stop at an earlier level when the user has not authorized
write-capable validation.

| Level | Target mutation | Codex mode | Purpose |
| --- | --- | --- | --- |
| 0. Tool baseline | None | fake/real as existing tests require | Prove the canonical checkout itself is healthy |
| 1. Resolve and collect | None; artifacts stay outside target | No Codex | Test session discovery, source routing, bounds, and provenance |
| 2. Compile and review | None | `read-only` | Test Brief extraction and project-policy preservation |
| 3. Isolated implement/resume | Dedicated target worktree only | `workspace-write` | Test useful implementation and focused communication |
| 4. Evaluate and aggregate | Run directory only | No new Codex call | Compare quality and operability across repositories |

## Shared setup

Use task-specific variables; do not repurpose `HOME` or `CODEX_HOME`.

```sh
export AGENT_DELEGATOR_CHECKOUT=/absolute/path/to/daifuku-tw/codex-delegator
export AGENT_DELEGATOR_CLI="$AGENT_DELEGATOR_CHECKOUT/tools/agent-delegator/src/cli.ts"
export AGENT_DELEGATOR_RUNS_ROOT=/absolute/private/path/cross-repository-runs
mkdir -p "$AGENT_DELEGATOR_RUNS_ROOT"
chmod 700 "$AGENT_DELEGATOR_RUNS_ROOT"
```

Record once:

```sh
git -C "$AGENT_DELEGATOR_CHECKOUT" rev-parse HEAD
git -C "$AGENT_DELEGATOR_CHECKOUT" status --short
bun --version
codex --version
claude --version
```

The tool records its package version, Git revision, and dirty state in each new run. A dirty tool
checkout is not an automatic failure, but results from different dirty states are not reproducible
enough for model or quality comparison and must be called out.

Use globally unique run IDs beginning with the target ID, for example
`repo-a-portability-20260726`. Add the tags `repo:<target-id>` and `validation:cross-repo` to the
Context Request metadata. Tags are retained in JSON run summaries, although the current Markdown
report does not provide repository-aware grouping.

## Level 0 — canonical tool baseline

From the canonical checkout:

```sh
bun run --filter @local/agent-delegator typecheck
bun run --filter @local/agent-delegator test
bun run --filter @local/agent-delegator build
git diff --check
```

Confirm the working tree was clean before and after the checks. Review the latest
`CLAUDE_ACCEPTANCE_REPORT.md`; if it is marked historical, do not treat it as current acceptance.
Either complete the current single-repository handoff or state exactly which parts are being reused
as prior evidence.

## Level 1 — resolve and collect in each target

### 1. Establish the target baseline

Run from the target repository root:

```sh
git rev-parse --show-toplevel
git rev-parse HEAD
git status --short
```

Read the target's agent guidance before running the delegator. Record:

- language/runtime and package manager;
- authoritative design/specification locations;
- normal typecheck/test/build commands;
- commit/PR/deploy ownership rules;
- any paths that must never be written;
- whether `agent-delegator.project.json` already exists.

Do not clean, reset, stash, or otherwise alter a dirty target. Read-only collection can continue
only when the existing state is understood and recorded. For any target intended to reach Level 3,
perform Levels 1 and 2 from its clean dedicated validation worktree from the beginning. A run is
repository-root-bound and cannot be moved safely after approval.

### 2. Verify active-session resolution

The process-tree test must be run from a Claude Code session launched inside the target repository.
Running it from the `codex-delegator` Claude session while merely passing another cwd does not prove
target-session discovery.

```sh
bun "$AGENT_DELEGATOR_CLI" resolve-transcript \
  --cwd "$PWD" \
  --json \
  --no-latest-fallback
```

Pass when `method` is `process-tree` and the returned session is the active target-repository
conversation. If it fails, preserve the error and test a specific session ID or explicit transcript
path. Do not enable latest-transcript fallback merely to turn the result green.

### 3. Author a bounded Context Request

Prefer an existing target `agent-delegator.project.json` when one has been deliberately authored.
Do not add durable policy to a target repository during acceptance just to make the tool pass.

When no profile exists, create the Context Request outside the target repository, set
`project_profile` to `null`, and select the target's durable guidance and relevant specification
files explicitly. This absence is useful portability evidence and should be recorded as authoring
friction rather than hidden.

The request must include:

- a narrow task objective already discussed with the user;
- `metadata.task_type`, `metadata.complexity`, `repo:<target-id>`, and
  `validation:cross-repo` tags;
- the exact relevant transcript/session and, for mixed-topic sessions, a turn range;
- target policy/specification sources with roles and `selected_because` rationale;
- conservative file and byte limits.

### 4. Collect without Codex

```sh
bun "$AGENT_DELEGATOR_CLI" collect \
  --context=/absolute/path/to/<target-id>-context-request.json \
  --runs-dir="$AGENT_DELEGATOR_RUNS_ROOT" \
  --run-id=<target-id>-portability-<date>
```

Inspect `context-request.json`, `evidence-bundle.json`, every snapshot, `evidence.md`, exclusions,
and `run-events.jsonl`. Confirm:

- the bundle's repository root is the target, not the tool checkout;
- unrelated transcript topics and files are absent;
- target instructions and the rationale behind task constraints are present;
- matched `AskUserQuestion` decisions are present, unrelated tool calls/results remain absent, and no
  obvious credential-shaped value leaked unexpectedly;
- source roles, revisions, hashes, byte counts, and exclusions are accurate;
- collection made no target worktree change and started no Codex process.

## Level 2 — compile and review

Compile the reviewed collection:

```sh
bun "$AGENT_DELEGATOR_CLI" compile \
  --run=<target-id>-portability-<date> \
  --runs-dir="$AGENT_DELEGATOR_RUNS_ROOT"
```

If compilation fails, inspect the failed attempt's `output.json`, `stderr.log`, validation message,
and any `citation-turn-corrections.json`. Keep the same reviewed Evidence Bundle and retry explicitly:

```sh
bun "$AGENT_DELEGATOR_CLI" compile \
  --run=<target-id>-portability-<date> \
  --runs-dir="$AGENT_DELEGATOR_RUNS_ROOT" \
  --retry
```

Do not start a new run merely to bypass the failed state. Start over only when the selected evidence,
repository anchor, or objective must change; record that replacement rather than comparing it as the
same run.

Review `brief.generated.json`, `brief.json`, and `brief.md` against the target transcript, Evidence
Bundle, and target guidance. If present, also review
`attempts/compile/NNN/citation-turn-corrections.json` against the preserved raw `output.json`.
Record every Claude correction rather than silently treating the compiler draft as correct.

Check especially:

- target-specific commands are not replaced with daifuku/Bun commands;
- architecture and ownership boundaries come from the target, not this tool repository;
- rationale and rejected/superseded alternatives survive extraction;
- every MUST has meaningful evidence, rationale, and failure mode;
- quotes exist and semantically support the associated claim;
- missing design decisions remain unresolved;
- compile left the target repository byte-for-byte unchanged.

Approve only if the Brief is an accurate contract. Do not use `--allow-unresolved` for a normal real
task merely to progress the validation.

```sh
bun "$AGENT_DELEGATOR_CLI" approve \
  --run=<target-id>-portability-<date> \
  --runs-dir="$AGENT_DELEGATOR_RUNS_ROOT" \
  --by=claude-cross-repo-validation
```

Repositories without a suitable implementation-ready task may stop after documenting the compile
and approval result.

## Level 3 — isolated implement and resume

Run this level only with explicit user approval for the exact target and task. Never run
write-capable validation in the target's primary checkout, `main`, or another person's active
worktree. The run being implemented must already have been collected, compiled, and approved from
the same dedicated clean worktree. If a read-only run was created from a primary checkout, start a
new run from the validation worktree; do not edit `state.json` or use worktree/base-change overrides
to retarget it.

The selected task should be small but real:

- one clearly bounded behavior or tooling change;
- project-specific verification commands;
- at least one constraint whose rationale matters;
- no production credential, migration, deployment, or irreversible external effect;
- optionally, one deliberately unresolved wording or local product choice to exercise
  `needs-decision` and same-session resume.

Immediately before implementation, record HEAD, worktree status, and the approval baseline. Then:

```sh
bun "$AGENT_DELEGATOR_CLI" implement \
  --run=<target-id>-portability-<date> \
  --runs-dir="$AGENT_DELEGATOR_RUNS_ROOT"
```

Claude's foreground shell timeout is independent of the CLI's Codex timeout. If the shell cannot
wait for the configured duration, use its supported background execution mechanism, preserve the
controller output, and poll `status --observation` and the attempt logs. Do not let a short outer
timeout kill the controller and then treat the interruption as a clean implementation failure.
Inspect the target diff and any surviving child processes before deciding whether a retry is safe.

If the result is `needs-decision`, verify that the question is focused and that Codex did not edit
past the missing decision. Answer only that question and resume the same session:

```sh
bun "$AGENT_DELEGATOR_CLI" resume \
  --run=<target-id>-portability-<date> \
  --runs-dir="$AGENT_DELEGATOR_RUNS_ROOT" \
  --message="<bounded decision and rationale>"
```

Do not use `--allow-base-change` or `--allow-worktree-change` merely to bypass a guard. Inspect and
explain the drift first. Do not automatically retry a failed workspace-write call without reviewing
partial edits and attempt artifacts.

Claude must independently run the target's relevant verification and review:

- changed and untracked files;
- exact diff and generated artifacts;
- target-specific MUST constraints;
- Codex's structured result versus actual repository state;
- Git HEAD, commits, remotes, and external systems for unintended mutation.

Do not commit the target implementation during this validation unless the user separately asks to
integrate it after reviewing the report.

## Level 4 — evaluate and aggregate

Complete one evaluation input per run using
[`examples/evaluation-input.json`](./examples/evaluation-input.json). Ratings must reflect Claude's
independent review, not Codex's `completed` status.

```sh
bun "$AGENT_DELEGATOR_CLI" evaluate \
  --run=<target-id>-portability-<date> \
  --runs-dir="$AGENT_DELEGATOR_RUNS_ROOT" \
  --evaluation=/absolute/path/to/<target-id>-evaluation.json

bun "$AGENT_DELEGATOR_CLI" report \
  --runs-dir="$AGENT_DELEGATOR_RUNS_ROOT" \
  --format=json

bun "$AGENT_DELEGATOR_CLI" report \
  --runs-dir="$AGENT_DELEGATOR_RUNS_ROOT" \
  --format=markdown
```

Compare at least:

- Context Request authoring effort and source count/bytes;
- process-tree success versus explicit transcript fallback;
- generated-to-approved Brief difference count and why Claude edited it;
- unresolved, `needs-decision`, blocked, retry, and failure counts;
- implementation acceptance and post-Codex Claude correction effort;
- verification outcome and requirements/implementation/communication ratings;
- compile/implement/resume duration and attempt counts;
- compiler/implementer model and token telemetry coverage;
- tool revision/dirty state and target language/build-system category.

The current report can aggregate a shared runs directory, but it has no first-class `project_id`,
repository breakdown, multi-runs-directory input, or automatic Codex-versus-Claude implementation
delta. Record these as protocol/product gaps when they materially complicate analysis; do not invent
clean metrics from tags or fingerprints.

## Failure severity and stop conditions

### Stop immediately and report Critical

- The compiler changes a target repository in read-only mode.
- The implementer writes outside the dedicated validation worktree.
- A commit, push, PR, deployment, credential mutation, or other external effect occurs without
  explicit authorization.
- Evidence from one repository is attributed to another repository.
- A broad sandbox bypass, root, or administrator access is required.
- A secret is copied into a shareable report or otherwise exposed beyond the private run artifact.

### Important

- Active target transcript resolution selects the wrong session or requires undocumented fallback.
- Target policy is omitted or replaced by daifuku-specific assumptions.
- A missing product/architecture decision is silently invented.
- Approval/worktree drift guards fail to stop a changed input.
- A completed result materially disagrees with the actual diff or verification.
- Cross-repository artifacts cannot be distinguished reliably enough to review.

### Minor

- Manual Context Request authoring is cumbersome but accurate.
- A failure is preserved but classified as `unknown`.
- Markdown reporting requires JSON inspection for target-specific comparison.
- Usage telemetry is absent but correctly reported as missing.

Do not continue to later validation levels after a Critical finding. Continue after an Important
finding only when the remaining activity is read-only and helps characterize the failure without
concealing it.

## Permission classification

Acceptable:

- Scoped permission to start Codex and read its normal configuration/authentication files.
- Writes restricted to the private runs directory and an explicitly selected validation worktree.
- A narrowly scoped host-execution permission needed because Claude's outer sandbox otherwise
  prevents starting Codex, while inner compile/implement modes remain `read-only`/`workspace-write`.

Reject:

- `sudo`, root, administrator access, or a blanket sandbox bypass.
- Write access to unrelated repositories or broad owner/worktree trees.
- Permission to deploy, push, merge, alter credentials, or mutate external services as part of
  acceptance.

Record every permission prompt, its exact purpose, whether it was persisted, and the filesystem or
command scope granted.

## Overall acceptance criteria

Return cross-repository `ACCEPT` only when:

- Level 0 passes for the canonical checkout.
- At least two real, user-approved repositories complete Levels 1 and 2.
- At least one contrasting repository uses a different language, package manager, build system, or
  repository layout from daifuku.
- At least one dedicated target worktree completes Level 3, unless the user explicitly scoped the
  pass to read-only portability; in that case return `ACCEPT WITH CONDITIONS` for implementation
  portability.
- Target-specific policy and verification survive into the Brief without daifuku-specific leakage.
- No Critical finding exists and all Important findings have a concrete disposition.
- Every completed run has a Claude evaluation and the aggregate report shows telemetry gaps
  explicitly.
- No unauthorized commit, push, PR, deployment, or external mutation occurred.

Use `ACCEPT WITH CONDITIONS` when read-only portability is established but a target-session
fallback, limited host permission, missing write-capable sample, or documented reporting gap remains.
Use `REJECT` for a trust-boundary violation, wrong repository/session, policy leakage, unbounded
write, invented product decision, or unexplained broad permission.

## Required report

Create `tools/agent-delegator/CROSS_REPOSITORY_VALIDATION_REPORT.md` in the canonical tool checkout,
or return the same structure to the user when the pass must not modify the repository:

```text
Verdict: ACCEPT | ACCEPT WITH CONDITIONS | REJECT

Tool under test:
- Checkout/revision/dirty state:
- Bun / Codex / Claude versions:
- Shared runs directory and retention decision:

Target matrix:
| ID | Repository category | Revision | Levels completed | Transcript method | Outcome |

Per-target results:
### <target-id>
- Guidance and build system:
- Context authoring/profile behavior:
- Evidence coverage and exclusions:
- Brief extraction and Claude edits:
- Implementation/resume result:
- Independent verification:
- Observation/evaluation completeness:
- Permissions:
- Findings:

Cross-repository comparison:
- Source-selection friction:
- Policy portability:
- Brief quality:
- Implementation quality:
- Communication efficiency:
- Timing/token telemetry:
- Reporting limitations:

Findings:
- Critical:
- Important:
- Minor:

Recommended protocol/tool changes:
- Now:
- After more trial data:
- Defer until standalone extraction:

Artifacts and retention:
- Private run locations:
- Target validation worktrees:
- Cleanup owner/date:
```

Do not average ratings across incomparable task types without showing the target and complexity mix.
Do not count missing usage as zero. Do not turn a small number of accepted runs into a general model
quality claim.
