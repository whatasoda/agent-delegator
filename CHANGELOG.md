# Changelog

## [Unreleased] - 2026-07-27

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

### Changed

- Stopped streaming Codex stderr by default while retaining complete output in `stderr.log`; set `AGENT_DELEGATOR_STREAM_CODEX_STDERR=1` to opt into live diagnostic streaming.
- Excluded unsuitable glob-expanded and optional evidence sources nonfatally, with exclusion reasons recorded, while keeping explicit required sources strict.
- Reported checkpoint-capture errors separately in events and CLI output while retaining a valid result and conservatively requiring `--allow-worktree-change` before the next execution.
- Resolved relative `--context` paths from the invoking shell's working directory, consistently with other path options.
