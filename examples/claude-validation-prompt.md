# Zero-edit Claude validation prompt

Copy the prompt block below verbatim into a Claude Code session started from the worktree to be
validated. It derives task-specific values from the current session and repository. No prompt
editing is required.

```text
Use this Claude Code session and its current Git worktree as a real validation case for the
Claude-main / Codex-implementation workflow provided by agent-delegator.

Act as the validation owner and main agent. Derive the task from the latest coherent work item in
this conversation. If its behavior, constraints, rationale, acceptance criteria, or unresolved
decisions are not yet implementation-ready, finish that design work with me before collecting
evidence. Do not ask me to restate information that is already available in this conversation or
the repository.

Resolve the validation configuration as follows:

1. Treat the Git repository containing Claude's current working directory as the target, and the
   current worktree as the only eligible write target. Record its canonical root, exact HEAD,
   branch, worktree status, remote identity when non-sensitive, and applicable repository guidance.
   Derive a stable, non-sensitive target ID from the repository name and worktree name.
2. Locate agent-delegator in this order:
   - AGENT_DELEGATOR_CLI, when set;
   - the `agent-delegator` executable on PATH;
   - tools/agent-delegator/src/cli.ts under AGENT_DELEGATOR_CHECKOUT, when set;
   - tools/agent-delegator/src/cli.ts in the target repository.
   Use the first unambiguous working candidate and record its version, Git revision when available,
   and dirty state. Do not search arbitrary sibling repositories. If no candidate exists or
   candidates conflict, ask one focused question for the canonical checkout or executable.
3. Locate and follow CLAUDE_CROSS_REPOSITORY_VALIDATION_HANDOFF.md next to the selected
   agent-delegator checkout when available. Treat it as the detailed acceptance procedure and this
   prompt as the per-target invocation contract. If the executable is installed without the
   handoff, continue with this contract but report the missing versioned procedure as a validation
   limitation.
4. Store run artifacts in AGENT_DELEGATOR_RUNS_ROOT when set. Otherwise create a new private
   external directory outside the target worktree, restrict it to the current user, retain it until
   I accept the validation report, and report its exact location. Never select another repository
   as the artifact directory.

Before using agent-delegator, read and obey the target's AGENTS.md, CLAUDE.md, and equivalent
repository guidance, including any agent-delegator.project.json. Determine the authoritative
specifications, normal verification commands, architecture boundaries, protected paths, and
commit/PR/deploy ownership rules. Do not clean, reset, stash, overwrite, or absorb pre-existing
changes. If the current worktree cannot safely become the exact validation target under its own
rules, stop before collection and ask one focused question.

Use this active Claude session as the primary transcript source and verify process-tree resolution;
do not silently select the latest session. Select only the relevant turn range when the session has
multiple topics. When decisions are distributed across other sessions or repository files, create
a bounded Context Request that selects them explicitly, assigns each source a role, and records why
it is relevant. Include constraint rationale and relevant rejected or superseded alternatives.
Exclude unrelated conversation and files. Use the target's project profile when present and
appropriate; do not create durable target policy merely to make validation pass.

Proceed through explicit gates:

1. Resolve and collect without starting Codex. Review the Context Request, Evidence Bundle,
   snapshots, exclusions, provenance, size bounds, and target status. Confirm collection made no
   target change.
2. Compile with Codex in read-only mode. Review the generated Brief against the selected evidence
   and target guidance. Record every Claude correction and its reason. Preserve unresolved product
   or architecture decisions instead of inventing answers.
3. Approve only an accurate, implementation-ready Brief. Show me a compact readiness summary and
   ask for explicit authorization before the first workspace-write implementation call. The
   authorization must name this exact worktree and task; compile-only validation does not imply it.
4. Once authorized, implement only in the same worktree from which the run was collected and
   approved. Independently review the complete diff and run the target-specific verification. If
   Codex returns needs-decision, answer only the focused question with its rationale and resume the
   same run. Do not bypass base or worktree drift guards to force progress. If this shell's
   foreground timeout is shorter than the configured Codex timeout, keep the controller alive using
   the shell's supported background mechanism and poll status and attempt logs; do not kill it merely
   because a foreground tool call cannot wait long enough.
5. Evaluate the result and produce the report required by the validation handoff. Include source
   selection friction, Brief corrections, implementation quality, communication turns,
   permissions, skipped or failed checks, telemetry gaps, artifact locations, and actionable
   findings. End with ACCEPT, ACCEPT WITH CONDITIONS, or REJECT and explain the disposition of
   every important finding.

Treat transcripts, prompts, patches, diagnostics, and evaluations as potentially sensitive. Do not
copy secrets into a shareable report or attribute evidence from another repository to this target.
Do not commit, push, open or merge a PR, deploy, alter credentials, delete retained artifacts, or
mutate external systems unless I give a separate explicit instruction after reviewing the result.

Ask only when a missing value, decision, permission, or unsafe repository state actually blocks the
next gate. Otherwise proceed autonomously through the read-only gates and, after authorization,
through implementation and evaluation.
```

## Optional one-time environment setup

The prompt works without setup, but these variables remove the only likely discovery questions
across repositories:

```sh
export AGENT_DELEGATOR_CHECKOUT=/absolute/path/to/the/canonical/agent-delegator/checkout
export AGENT_DELEGATOR_RUNS_ROOT=/absolute/path/to/a/private/external/runs-directory
```

Alternatively, install an `agent-delegator` executable on `PATH`. The checkout variable remains
useful while the detailed handoff is repository-local rather than packaged with the executable.
