# Distribution plan

## Layer boundaries

Distribute agent-delegator as three independently versioned layers:

1. **Core CLI package** — evidence collection, Brief compilation and validation, approval,
   implementation/resume, and observation. It owns prompts and schemas required at runtime.
2. **Claude Code plugin** — the `delegate-codex` skill, validation handoff, CLI discovery, and
   operator guidance. It invokes the core CLI but does not contain project policy.
3. **Target repository configuration** — `agent-delegator.project.json`, `AGENTS.md`, `CLAUDE.md`,
   and task-specific Context Requests. These remain with the target repository.

This keeps the protocol usable from other main agents and automation without making Claude Code a
runtime dependency of the core CLI.

## Current package boundary

The package remains private and intentionally uses the provisional identity
`@local/agent-delegator@0.0.0`. Its packed artifact contains only:

- the Bun bundle exposed as the `agent-delegator` executable;
- runtime compiler/implementer prompts and JSON Schemas;
- examples, operator handoffs, README, and design documentation.

Source, tests, build scripts, historical acceptance reports, and repository-local runtime artifacts
are excluded. `bun run package:smoke` builds a tarball, checks its allowlist, installs it into a
temporary consumer without registry access, and completes a packaged compile with a fake Codex. The
smoke also proves that installed attempts retain an executable SHA-256 when Git metadata is absent.

Do not remove `private: true` or publish this provisional package name.

## Phase 1: extract and publish the core package

Before creating the independent repository, decide:

- canonical repository owner and name;
- npm scope and final package name;
- public versus private registry visibility;
- license and copyright owner;
- initially supported Bun, macOS, and Linux versions.

Then:

1. Extract `tools/agent-delegator/` with history into the new repository root.
2. Rewrite repository-local `tools/agent-delegator/...` links and acceptance commands for the new
   root while retaining installed-PATH examples.
3. Set real package `name`, prerelease `version`, `license`, `repository`, and release metadata.
4. Keep the CLI bundle plus prompt/schema sidecars as the first distribution format.
5. Run the complete release gate:

   ```sh
   bun install --frozen-lockfile
   bun run typecheck
   bun run test
   bun run build
   bun run package:smoke
   bun pm pack --dry-run
   ```

6. Inspect the tarball manifest and publish only from a clean, tagged revision with an explicit
   registry and access level.

During private trials, a reviewed tarball can be installed without publishing:

```sh
bun add --global /absolute/path/to/agent-delegator-<version>.tgz
command -v agent-delegator
agent-delegator --help
```

## Phase 2: Claude Code plugin

Create a separately versioned plugin containing:

```text
.claude-plugin/plugin.json
skills/delegate-codex/SKILL.md
handoffs/cross-repository-validation.md
```

The first plugin version should be thin: resolve `agent-delegator` from `PATH`, verify a compatible
CLI version, and give one precise installation instruction when it is absent. Do not reach outside
the installed plugin cache for a development checkout. Keep target-specific profiles in target
repositories.

After local `--plugin-dir` testing, publish the plugin through a private marketplace. Move to a
public marketplace only after the core package identity, compatibility policy, and upgrade behavior
have stabilized.

## Phase 3: standalone executable

A true single-file executable is deferred. The current bundle still requires Bun and passes runtime
schema paths to Codex. Standalone work therefore requires:

- embedding prompts and schemas in the build;
- materializing schemas into a private, versioned runtime directory for Codex's `--output-schema`;
- injecting release version/revision and retaining executable SHA-256 observation;
- cross-platform release builds, checksums, signing/notarization where applicable, and upgrade tests.

Once those exist, GitHub Releases can become the canonical binary source and Homebrew can be an
installation channel rather than a separate product boundary.

## Compatibility policy to define before public release

- CLI SemVer and supported run/state schema versions;
- plugin-to-CLI version compatibility and failure message;
- migration policy for retained private runs;
- minimum supported Claude Code, Codex CLI, Bun, Git, and operating-system versions;
- deprecation window for flags, environment variables, prompts, and project-profile schema.
