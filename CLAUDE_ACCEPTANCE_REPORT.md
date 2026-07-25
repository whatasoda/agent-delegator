# Claude acceptance report: agent-delegator

> Historical report: this records Claude's acceptance pass before the post-review approval v3,
> result validation, worktree binding, retry/recovery, and permission hardening changes. Re-run the
> current `CLAUDE_ACCEPTANCE_HANDOFF.md` before treating the verdict as current.

Response to [`CLAUDE_ACCEPTANCE_HANDOFF.md`](./CLAUDE_ACCEPTANCE_HANDOFF.md). Three passes from an
active Claude Code session on 2026-07-25. Nothing was committed, pushed, deployed, or changed in the
application by this review; every write-capable run happened in an isolated temporary fixture
repository.

- **Pass 1 — ACCEPT WITH CONDITIONS.** Two Important findings in the `resume` stage.
- **Pass 2 — ACCEPT.** Both conditions fixed and independently verified.
- **Pass 3 — ACCEPT.** Re-review of commit `8c0475e` against parent `ad4276f`, focused on the new
  Stage 1 Context Request / Evidence Bundle layer.

**Verdict: ACCEPT**

## Environment

| Item | Value |
| --- | --- |
| Claude Code | 2.1.220, CLI surface, run from the session under acceptance |
| Host | macOS 26.4.1 (arm64), zsh, bun 1.3.13 |
| `CLAUDE_CONFIG_DIR` | `/Users/whatasoda/.claude-whatasoda` (non-default; honored correctly) |
| Codex | codex-cli 0.144.5, no `--model` passed, default `gpt-5.6-sol` |
| Codex config | `sandbox_mode = "workspace-write"`, `approval_policy = "on-request"` |

## Pass 3 — commit `8c0475e` vs `ad4276f`

`8c0475e` is the tool's first commit, so the diff is the whole tool (36 files, +4368). Passes 1 and 2
already covered the delegation pipeline; this pass treats those results as evidence and independently
verifies what is new: `src/evidence.ts`, the Context Request / Evidence Bundle / project-profile
schemas, `agent-delegator.project.json`, the `collect` command, `compile --run`, approval schema v2,
and Brief citation validation.

The pass-2 report was committed verbatim — `git show 8c0475e:…/CLAUDE_ACCEPTANCE_REPORT.md` is
byte-identical to the file it was written as, so the prior evidence was not edited to fit.

### Results

| Check | Verdict | Evidence |
| --- | --- | --- |
| Source trust-boundary review | PASS | see below; one characterization recorded as Minor 1 |
| Active transcript process-tree resolution | PASS | `method: "process-tree"`, session `be99e832-…`, 23 turns |
| Explicit multi-source collection | PASS | 3 labeled/hashed sources, 1 accurate exclusion, 12/12 fail-closed probes |
| Automated checks | PASS | 42 pass / 0 fail / 134 assertions across 7 files; 9 workspaces typecheck; build; `git diff --check` |
| Real Brief compilation | PASS | 6 MUSTs, 1 unresolved item, all citations `source-001` turns 1–3 |
| Default unresolved approval rejection | PASS | exit 1, `Brief has 1 unresolved item(s).` |
| Initial implement `needs-decision`, no edits | PASS | worktree clean, `greeting.txt` absent |
| Same-session resume | PASS | implement and resume both `019f9968-eb6c-7b11-8244-4a55f0b49d11` |
| Final scope and byte content | PASS | only `?? greeting.txt`; bytes `…652e 0a`; HEAD `bab4eb0` unmoved |

### Stage 1 collection — hands-on verification

Fixture: a throwaway git repo (`stage1/repo`, HEAD `355b419`) with a project profile, `AGENTS.md`,
`docs/spec.md` seeded with five credential shapes, a NUL-byte `blob.md`, and a symlink
`escape-link.md -> /etc/passwd`; plus a six-turn fixture transcript. Collection ran through
`collect --context=…`, never Codex.

Happy path — Context Request selecting transcript turns 3–4, profile topic `spec`, and one optional
glob:

- 3 sources, each its own snapshot under `evidence/`, each labeled with `kind` / `role` / `trust` /
  `locator` / `revision` / `selected_because` and its own SHA-256; `project_profile` hashed too.
- `revision: "turns:3-4"` for the transcript, `"<size>:<mtime>"` for files.
- Turn range honored exactly: `TURN3` and `TURN4` present, `TURN1` / `TURN2` / `TURN5` / `TURN6`
  present in **zero** files of the run.
- All five credential shapes in `docs/spec.md` redacted in the snapshot
  (`[REDACTED]`, `[REDACTED_TOKEN]`, `[REDACTED_GITHUB_TOKEN]`, `[REDACTED_API_KEY]`,
  `[REDACTED_PRIVATE_KEY]`).
- `excluded_sources` recorded the optional glob miss with its reason; the run stayed `prepared`.
- Hashes recomputed independently outside the tool: every snapshot, `evidence.md`, and
  `context-request.json` matched the bundle.

Fail-closed matrix — 12 probes, all behaved as required:

| Probe | Outcome |
| --- | --- |
| Unknown profile topic | `Project profile does not define topic: nope` |
| Required glob matching nothing | `Required source glob matched no files: docs/nonexistent/*.md` |
| `../…/etc/passwd` (reaching root) | `Repository source escapes the repository root` |
| Absolute `/etc/passwd` | `Repository source escapes the repository root` |
| Symlink to `/etc/passwd` | `Repository source escapes the repository root` |
| Glob `../*.jsonl` | `Repository source escapes the repository root: ../transcript.jsonl` |
| NUL-byte file | `Evidence source appears to be binary: blob.md` |
| `max_source_bytes: 32` | `Evidence source exceeds max_source_bytes` |
| `max_files: 1` | `Evidence selection exceeds max_files (1)` |

`/etc/passwd` was never read in any variant.

### Brief citation validation

Enforcement is machine-level, not prompt-level: `validateBriefEvidence` runs both at `compile`
(`src/cli.ts:423`) and at `approve` (`src/cli.ts:459`). Verified by hand-authoring `brief.json` into
copies of a collected run and invoking `approve`:

| Crafted citation | Result |
| --- | --- |
| `source-001` turn 3 + `source-003` turn `null` | approved |
| `source-999` | `constraint 1 cites unknown evidence source source-999` |
| `source-001` turn 9 (range 3–4) | `cites turn 9 outside source-001 range 3-4` |
| `source-003` (file) turn 2 | `cites turn 2 on non-transcript source source-003` |
| MUST with no sources | `MUST constraint 1 has no evidence source` |

So an uncollected repository file cannot be laundered into the Brief as decision evidence. The
compiler prompt still permits read-only repository inspection to verify file names and current
behavior — that is stated openly in `prompts/compile-brief.md` and is not a contradiction, because
the citation gate is what decides what may be *claimed as evidence*.

### Approval coverage and tamper detection

Approval is now schema v2 over `brief.json`, `brief.md`, `evidence-bundle.json`, and `evidence.md`,
and `verifyApproval` additionally re-runs `verifyEvidenceBundle`, which rehashes
`context-request.json`, `evidence.md`, and every individual snapshot, and re-checks that no snapshot
path escapes the run directory.

Verified on the real path: after a successful approval, appending one line to a snapshot made
`implement` exit 1 with `evidence/source-003-spec.md.md changed after evidence collection; recollect
and approve again`, and **no** `implementation-events.jsonl` was created — Codex never started. (Run
with a `PATH` lacking `codex`, so a missed guard would have surfaced as exit 127 instead.)

### Live-session dry run

From this conversation, `compile --dry-run` produced 3 sources: the process-tree transcript
(`turns:1-23`, 19 assistant + 4 user) plus `AGENTS.md` and `CLAUDE.md` pulled in automatically by
`agent-delegator.project.json` `default_sources`. Leakage scan over the whole run directory: zero
`tool_use` / `tool_result` occurrences, zero literal `<system-reminder>` blocks, and zero of the
credential strings I had written into fixture files earlier in this same session — those existed only
in tool parameters, confirming tool payloads are excluded. `transcript.md` is retained as a
compatibility view and is byte-identical to the transcript snapshot.

### Pass-2 follow-up closed

Pass-2 Minor 1 (unguarded `compile` flags) is fixed: `compile.guardedFlags` now covers
`--allow-latest-fallback`, `--no-redact`, and `--dry-run`, and `collect` carries its own guards. The
case that slipped through in pass 2 is now rejected —
`compile --objective Test --no-redact --dry-run` exits 1 with
`--no-redact must appear before --objective so it cannot be mistaken for text`. The guard also became
more precise: it only arms for the split form (`equals === -1`), so `--objective=…` is unaffected.

## Findings (pass 3)

### Critical

None.

### Important

None.

### Minor

1. **`verifyEvidenceBundle` is self-attesting before approval.** The bundle stores the hashes it is
   checked against, so tampering a snapshot *and* rewriting that source's `sha256` in
   `evidence-bundle.json` passes `compile --run … --dry-run`. Demonstrated both halves: snapshot-only
   tampering is caught; snapshot + rewritten bundle hash is accepted pre-approval. After approval the
   same tampering is caught, because `approval.json` anchors the bundle hash (verified above). The
   documentation only claims coverage *at approval*, so this is a precise characterization rather
   than a contradiction — but a run that sits between `collect` and `compile` has no external anchor.
2. **Glob expansion is not itself confined to the repository.** `Bun.Glob` happily matched
   `../transcript.jsonl`; containment came solely from `repositoryFile`. It fails closed for required
   globs, but an *optional* escaping glob is quietly downgraded to an `excluded_sources` entry rather
   than an error. Rejecting escaping patterns at expansion time would make the intent explicit.
3. **Transcript size accounting differs from files.** The file branch checks raw bytes *before*
   writing a snapshot; the transcript branch writes the snapshot first and only then compares the
   rendered size to `max_source_bytes`, so an over-limit run leaves the oversized snapshot on disk
   (observed in the `max_source_bytes: 32` probe). The run still fails closed.
4. **Legacy approval v1 still verifies against `transcript.md` and skips evidence verification.**
   Only reachable for runs approved before this commit; retiring the v1 branch once no old runs
   matter would remove a weaker path from the code.
5. `--context` is resolved but not confined to the repository root, by design — the Context Request
   is Claude-authored control input, not collected evidence. Worth keeping in mind when reviewing a
   Context Request someone else wrote.
6. Environmental noise unchanged and self-recovering: `Reading additional input from stdin...`,
   transient `503` websocket retries, a models-cache warning, and an unrelated MCP `HTTP 451`. None
   originate in this tool. Bundled CLI is now 0.31 MB (Ajv inlined).

## Permissions observed

No escalation, in any of the three passes. `collect`, `compile`, `implement`, and `resume` all ran
from ordinary bash execution — no `sudo`, no root, no `--dangerously-bypass-approvals-and-sandbox`,
no host-execution grant, no broad allow rule. The inner Codex was recorded as `read-only` for compile
and `workspace-write` for implement and resume, with `network_access: false`; the resume pin
(`--config 'sandbox_mode="workspace-write"'`) was proven effective in pass 2. The only permission
prompt across all passes was Claude Code's normal confirmation for a compound `rm -rf` + heredoc +
`git init/commit` script used to build the pass-1 fixture; it was declined and split into smaller
steps.

The earlier report that an outer sandbox blocked Codex startup never reproduced from Claude Code. It
is specific to nested Codex-launching-Codex execution.

## Follow-ups

All optional; none blocks trial use.

- Minor 1: consider an anchor for the pre-approval window (e.g. record the bundle hash in
  `state.json` at collection time, which `compile` already reads for other purposes).
- Minor 2: reject repository-escaping glob patterns at expansion time.
- Minor 3: check transcript snapshot size before writing it, and state which measure
  `max_source_bytes` applies to.
- Minor 4: drop the approval v1 branch when no legacy runs remain.

## Artifacts

- Live-session dry runs (this repository, gitignored): `.agent-delegator/runs/20260725T083658Z-c78d8ced/`,
  `.agent-delegator/runs/20260725T094613Z-f756c2d7/`, `.agent-delegator/runs/20260725T131506Z-98ecbdb2/`
- Pass 1 fixture: `<scratchpad>/acceptance-fixture/` — HEAD `d8c04aa`, unmoved
- Pass 2 fixture: `<scratchpad>/fixture2/` — HEAD `565ca11`, unmoved
- Pass 3 Stage 1 fixture + probe drivers: `<scratchpad>/stage1/` — HEAD `355b419`, 12 probe runs
- Pass 3 E2E fixture: `<scratchpad>/fixture4/` — HEAD `bab4eb0`, unmoved, run `claude-acceptance-3`
