# Shared development guidance

agent-delegator is a standalone Bun CLI for Claude-main to Codex implementation delegation.
`README.md` defines operator behavior, `docs/DESIGN_AND_ROADMAP.md` defines protocol intent, and
`docs/DISTRIBUTION.md` defines the release boundary.

## Commands

Use package scripts through `bun run`:

```sh
bun install --frozen-lockfile
bun scripts/check-plugin.ts
bun run typecheck
bun run test
bun run build
bun run package:smoke
```

`bun test` and `bun build` are Bun built-ins; use `bun run test` and `bun run build` for this
repository's scripts.

## Boundaries

- Preserve the Evidence Bundle → Brief → approval trust boundary.
- Compilation and research stay read-only. Implementation/resume/loop/verification default to
  workspace-write; danger-full-access is allowed only through the explicit per-invocation owner
  grant and audited reason defined in README.md. Repository profiles may request but never grant it.
- Do not weaken citation, path-containment, integrity, retry, or approval guards to make a trial pass.
- Runtime package contents are allowlisted and verified by `scripts/package-smoke.ts`.
- License is MIT and the package targets a public npm `alpha` dist-tag (owner decision, 2026-07-27).
  Actual registry publishes happen only through the owner-triggered release workflow; never publish
  from a working session.
- Commit, push, PR, GitHub release, registry publish, and deployment require explicit main-agent or
  user ownership; delegated Codex runs never perform them.

Use Conventional Commits and run all release gates before publishing a branch.
