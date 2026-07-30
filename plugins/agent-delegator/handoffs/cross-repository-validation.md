# Cross-repository validation handoff

Use this handoff only when the user explicitly asks to validate agent-delegator across repositories.
It is a validation workflow, not authority to write to arbitrary repositories or perform integration
actions.

## Goal

Establish whether the same released CLI and plugin preserve target-repository policy, evidence
provenance, approval boundaries, and useful observation data across materially different projects.

## Authority

- Claude selects exact targets with the user, reads each repository's durable instructions, reviews
  every Brief and diff, and owns evaluation and integration.
- Codex may compile evidence read-only or implement an approved Brief in a user-approved isolated
  worktree. It does not commit, push, open a PR, deploy, or mutate external systems.
- Run artifacts may contain transcripts and patches. Agree on an external private runs directory and
  retention before starting.

## Minimum matrix

Use at least two real repositories:

1. An adjacent TypeScript/Bun or monorepo project with different local policy.
2. A contrasting language, build system, or repository layout.

Do not select repositories merely because they are present on disk. Obtain approval for every exact
path and use a dedicated worktree before any workspace-write trial.

## Ordered levels

1. Run `agent-delegator doctor --json` and the core release gate in its own checkout.
2. Resolve and collect evidence without Codex; inspect source coverage and exclusions.
3. Compile read-only; verify target terminology, constraints, commands, and citations in the Brief.
4. Only in an approved disposable worktree, approve and implement one bounded change.
5. Review the diff independently and record an evaluation for every run.
6. Aggregate with `agent-delegator report --all --format=markdown`, keeping unknown telemetry distinct
   from zero.

Stop at the highest level the user authorized. A successful command is not acceptance: report policy
preservation, evidence quality, diff quality, recovery behavior, operator overhead, and every skipped
or failed verification separately.
