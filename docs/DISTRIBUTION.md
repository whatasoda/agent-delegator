# Distribution plan

## Layer boundaries

Distribute agent-delegator through one versioned npm package with three surfaces:

1. **CLI** — evidence collection, Brief compilation and validation, approval, implementation,
   resume, observation, setup, synchronization, and updates.
2. **Programmatic library** — side-effect-free ESM exports for Claude transcript discovery,
   normalization, structured decisions, secret redaction, and evidence rendering.
3. **Embedded Claude skill** — operator guidance compiled into the CLI bundle and materialized by
   `agent-delegator setup` or `agent-delegator sync`.

Target-repository configuration remains separate: `agent-delegator.project.json`, `AGENTS.md`,
`CLAUDE.md`, and task-specific Context Requests belong to the target repository.

There is no independently versioned Claude Code plugin or marketplace. The package version is the
only compatibility identity for executable behavior, library exports, and managed skill content.

## Package boundary

The package is MIT-licensed and uses the prerelease identity `@whatasoda/agent-delegator`
(0.1.0-alpha series), targeting the public npm `alpha` dist-tag. Its packed artifact contains only:

- the Node-compatible launcher and Bun-target CLI bundle;
- the ESM library bundle and TypeScript declarations;
- prompts and schemas required at runtime;
- examples, operator handoffs, README, LICENSE, and design documentation.

Source, tests, build scripts, the raw skill source, historical acceptance reports, and repository
runtime artifacts are excluded. The skill is present only inside the CLI bundle.

`bun run package:smoke` builds a tarball, checks its allowlist, installs it into a temporary consumer
without registry access, imports the public library, and completes a packaged compile with a fake
Codex. The smoke also proves that installed attempts retain an executable SHA-256 when Git metadata
is absent.

## Installation and skill synchronization

Install the alpha CLI and materialize the personal Claude skill:

```sh
bun add --global @whatasoda/agent-delegator@alpha
agent-delegator setup
```

The destination is
`${CLAUDE_CONFIG_DIR:-~/.claude}/skills/agent-delegator/SKILL.md`. `sync` is idempotent and refuses to
replace a file that lacks the agent-delegator managed marker unless the operator supplies `--force`.
This preserves personal edits and prevents package upgrades from silently taking over an unrelated
skill with the same name.

```sh
agent-delegator sync
agent-delegator sync --claude-config-dir=/managed/claude/config
agent-delegator sync --all --claude-config-dir=/managed/claude/config
```

Every successful single-config `setup` or `sync` records the resolved directory and synchronized
skill version in `~/.agent-delegator/claude-configs.json` (override with
`AGENT_DELEGATOR_CLAUDE_CONFIG_REGISTRY_PATH`). `claude-configs` lists the registered targets and
`claude-configs --remove <dir>` forgets a retired target without deleting it. `--all` includes the
current resolved config and every registered config while preserving the unmanaged-file guard.

## Update model

`agent-delegator update` resolves the package's configured npm dist-tag, installs an available newer
version with Bun, locates Bun's global bin directory, and invokes the newly installed CLI's
`sync --all` command. A global package upgrade therefore refreshes every registered config even when
only one profile initiated it. When the installed version is already current, `update` synchronizes
the current config and `update --all` synchronizes every registered config.

The managed skill runs `agent-delegator update-check` through Claude's dynamic context injection.
The foreground process reads the previous cache and returns immediately, then starts
`update-check --refresh` as a detached child. The child writes
`<CLAUDE_CONFIG_DIR>/agent-delegator/update-state.json`; a discovered update is therefore reported on
the next skill invocation rather than delaying the current invocation.

Automatic update is opt-in:

```sh
agent-delegator setup --auto-update
agent-delegator setup --no-auto-update
```

Refreshes use a config-local lock. Before an automatic update begins, the target version is recorded
in the persistent attempt map. Success and failure are both terminal for automatic processing of
that version in that config, which prevents concurrent skill loads or repeated checks from retrying
the same version. The package installation is global, and its successful update synchronizes all
registered configs. Manual `agent-delegator update --all` is always the recovery path.

## Programmatic library

The package root is an ESM export with TypeScript declarations:

```ts
import {
  normalizeTranscriptDocumentFile,
  resolveClaudeTranscript,
} from "@whatasoda/agent-delegator";
```

The public boundary intentionally starts with Claude-to-agent handoff primitives. Internal run-store,
approval, Codex invocation, and repository mutation helpers are not exported while their contracts
remain alpha and CLI-specific.

## Release process

Registry publishes are owner-triggered only. Subsequent publishes use the `Release (npm alpha)`
workflow with Trusted Publishing provenance. Working sessions never publish unless the owner
explicitly requests the release operation.

Before each registry publication:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun run package:smoke
bun pm pack --dry-run
```

During private trials, a reviewed tarball can be installed without publishing:

```sh
bun add --global /absolute/path/to/agent-delegator-<version>.tgz
agent-delegator setup
```

The validated platform remains macOS arm64 with Bun 1.3.13. CI also exercises Ubuntu, but other
runtime platforms remain unverified. The npm bin is a Node-compatible launcher that reports the Bun
requirement when Bun is absent.

## Standalone executable

A true single-file executable remains deferred. The current bundle still requires Bun and passes
runtime schema paths to Codex. Standalone work therefore requires embedding prompts and schemas,
materializing schemas for Codex's `--output-schema`, injecting release identity, and defining
cross-platform checksums and signing.

## Compatibility policy to define before stable release

- CLI SemVer and supported run/state schema versions;
- library export stability and deprecation windows;
- migration policy for retained private runs and managed update state;
- minimum supported Claude Code, Codex CLI, Bun, Git, and operating-system versions;
- deprecation windows for flags, environment variables, prompts, and project-profile schema.
