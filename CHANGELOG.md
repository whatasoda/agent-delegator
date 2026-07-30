# Changelog

## Unreleased

## [0.1.0-alpha.4] - 2026-07-30

### Fixed

- Record the detached launcher PID and classify a job as `lost` when the launcher exits before a
  controller is recorded, including the pre-command Herdr launch window. A worker now proceeds
  only after the launcher records `running`, preventing a late worker from executing after loss.

## [0.1.0-alpha.3] - 2026-07-30

### Added

- Added the public `whatasoda-agent-delegator` Claude Code marketplace and independently versioned
  `agent-delegator` plugin, including the `delegate-codex` operator skill, exact core CLI preflight,
  update guidance, and a cross-repository validation handoff.
- Added CI validation that keeps the marketplace/plugin versions, verified core CLI version, and
  personal/plugin operator-skill copies in sync.
- Added repository-policy `verify` delegation with structured command rationale, independent
  verification state, worktree-drift detection, and reportable attempt artifacts.
- Added opt-in detached controllers with private job records and logs, `jobs` discovery, a
  terminal-independent process backend, and a non-focused Herdr-tab backend.
- Added shared, per-run isolated, and caller-managed Codex homes with selectable auto, keyring,
  file, or explicit shared-file credential storage and stable same-run session routing.

### Changed

- Extended run observation and the Claude operator skill with verification model/status/call data,
  detached execution selection guidance, and Codex-state isolation guidance.

## [0.1.0-alpha.2] - 2026-07-30

### Added

- Added bounded `loop` execution for approved or completed implementation runs, with same-thread
  review/improvement turns, per-turn approval and worktree guards, convergence/escalation outcomes,
  iteration artifacts, append-only stop summaries, and autonomous-pattern observation.
- Added read-only `research` delegation and same-thread `follow-up` dialogue with structured results,
  per-turn artifacts, retry support, and observation events.
- Added delegation-pattern and experiment-variant dimensions to run reports.
- Added a private machine-level state history, cross-directory run-ID resolution, and the `history`
  command so minimal trial records survive disposable worktrees without copying raw evidence.
- Added research-aware evaluation values and an optional research-quality rating.
- Added `doctor` runtime preflight, transcript-turn previews, configurable Codex executable
  discovery, and repository-relative run lookup through `--cwd`.
- Added per-run and per-repository operation locks, stale-controller recovery, atomic artifact
  writes, and torn event-log tail preservation.
- Added failed-run checkpoint salvage and partial Codex thread/token capture so timed-out or
  interrupted work remains reviewable and retryable.

### Changed

- Restricted compiler and implementer verification guidance to local, non-mutating checks while
  leaving integration-owner actions explicitly not run.
- Bounded untracked-file fingerprint work and streamed file hashing to keep large worktrees within
  predictable memory and process limits.
- Expanded packaged smoke coverage to machine-level history and added Linux/macOS CI coverage.
- Reported failed runs with accepted evaluations as salvaged rather than unrecovered failures, and
  recorded executable hashes for packaged revisions without Git metadata.

### Fixed

- Rejected ambiguous transcript selectors, malformed or unsafe numeric values, oversized task
  metadata, and rendered Brief edits that would otherwise be silently discarded.
- Prevented duplicate decision and research-dialogue entries across retries and retained the latest
  resumable Codex thread when later result validation fails.
- Prevented concurrent implementation runs from mutating the same checkout and rejected Git HEAD
  changes made during delegated workspace-write execution.
- Preserved valid JSONL records when recovering torn appends and archived the invalid tail before
  repairing the active event log.
- Updated the owner release workflow to an OIDC-capable Node/npm toolchain and made the public
  `alpha` dist-tag explicit at publish time.

## [0.1.0-alpha.1] - 2026-07-27

First published version (npm `alpha` dist-tag).

### Fixed

- Kept run artifacts out of Git status, worktree fingerprints, and checkpoint patches by creating an ignore rule for the runs directory, preventing runs from invalidating themselves.
- Matched null-turn citations against the unescaped decision-event text, including quotes containing `&`, `<`, or `>`, while reporting when a quote belongs to a numbered turn instead.
- Bounded process shutdown on timeouts and terminal signals, escalated unresponsive process groups to `SIGKILL`, and prevented orphaned Codex processes or blocked stdio from hanging the controller.
- Expanded secret redaction to cover fine-grained personal access tokens, Slack credentials, JWTs, AWS access key IDs, URL credentials, Basic authentication, and complete quoted values without corrupting bare type annotations such as `password: string`.
- Matched Claude Code's project-directory encoding by replacing every non-alphanumeric character with `-`.
- Preserved valid implementation and resume results when post-run checkpoint capture failed instead of converting successful work into a failed attempt.
- Returned clearer missing-run and path diagnostics, including an explicit `Run not found` error.

### Added

- Added `approve --allow-base-change` to rebind a reviewed approval to a changed base commit without weakening Brief, integrity, or worktree validation.
- Added `revalidate --run` to fully revalidate and deterministically repair a hand-edited Brief without another compiler call.
- Added `implement --retry` to restart implementation from the approved Brief after a failed implementation or lost resume session.
- Added `status --force-fail` to recover a verified stuck active run and reopen its retry path.
- Added per-run and summary `controller_cost` proxy metrics for tracked invocations, gate rejections, Codex failures, and review-surface bytes; these are delegation-overhead indicators, not direct Claude-token measurements.
- Added `wait --run` to block until a run settles, including stale-controller recovery, as an alternative to repeated status polling.
- Added the quick-path evidence limits `--max-source-bytes` and `--max-transcript-input-bytes`, with actionable guidance when a limit is exceeded.
- Added global and command-level `--help` output and global `--version` output.
- Added a Node-compatible npm launcher that reports the Bun >= 1.3.0 requirement with installation
  guidance when Bun is missing.

### Changed

- Stopped streaming Codex stderr by default while retaining complete output in `stderr.log`; set `AGENT_DELEGATOR_STREAM_CODEX_STDERR=1` to opt into live diagnostic streaming.
- Excluded unsuitable glob-expanded and optional evidence sources nonfatally, with exclusion reasons recorded, while keeping explicit required sources strict.
- Reported checkpoint-capture errors separately in events and CLI output while retaining a valid result and conservatively requiring `--allow-worktree-change` before the next execution.
- Resolved relative `--context` paths from the invoking shell's working directory, consistently with other path options.
- Changed the license from `UNLICENSED` to MIT and adopted a public npm `alpha` release channel with
  an owner-triggered provenance-publishing workflow.
