# Shared development guidance

agent-delegator is a standalone Bun CLI for Claude-main to Codex implementation delegation.
`README.md` defines operator behavior, `docs/DESIGN_AND_ROADMAP.md` defines protocol intent, and
`docs/DISTRIBUTION.md` defines the release boundary.

## Commands

Use package scripts through `bun run`:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun run package:smoke
```

`bun test` and `bun build` are Bun built-ins; use `bun run test` and `bun run build` for this
repository's scripts.

## Boundaries

- Preserve the Evidence Bundle → Brief → approval trust boundary.
- Compilation stays read-only; implementation/resume stay workspace-write.
- Do not weaken citation, path-containment, integrity, retry, or approval guards to make a trial pass.
- Runtime package contents are allowlisted and verified by `scripts/package-smoke.ts`.
- Keep `private: true` and `UNLICENSED` until the owner explicitly authorizes registry/public release.
- Commit, push, PR, GitHub release, registry publish, and deployment require explicit main-agent or
  user ownership; delegated Codex runs never perform them.

Use Conventional Commits and run all release gates before publishing a branch.
