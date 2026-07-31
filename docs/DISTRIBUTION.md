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

The package is MIT-licensed and uses the prerelease identity
`@whatasoda/agent-delegator` (0.1.0-alpha series), targeting the public npm `alpha` dist-tag
(owner decision, 2026-07-27). Its packed artifact contains only:

- the Node-compatible launcher and the Bun bundle exposed as the `agent-delegator` executable;
- runtime compiler/implementer prompts and JSON Schemas;
- examples, operator handoffs, README, LICENSE, and design documentation.

Source, tests, build scripts, historical acceptance reports, and repository-local runtime artifacts
are excluded. `bun run package:smoke` builds a tarball, checks its allowlist, installs it into a
temporary consumer without registry access, and completes a packaged compile with a fake Codex. The
smoke also proves that installed attempts retain an executable SHA-256 when Git metadata is absent.

Registry publishes are owner-triggered only. npm cannot attach a trusted publisher to a package
that does not exist on the registry yet, so the bootstrap sequence is: (1) the owner performs the
first publish manually from a clean tagged checkout after the full release gate; (2) the owner
configures the trusted publisher for the now-existing package on npmjs.com; (3) every subsequent
publish goes through the `Release (npm alpha)` workflow (`.github/workflows/release.yml`), which
runs the full release gate and publishes with Trusted Publishing provenance — no npm token is
stored. Working sessions never publish.

## Phase 1: extracted core package and the alpha channel

The initial decisions are:

- repository: `whatasoda/agent-delegator`;
- package: `@whatasoda/agent-delegator` (0.1.0-alpha series);
- distribution: reviewed tarballs during trials, then the public npm `alpha` dist-tag — never
  `latest` until the stability conditions in `DESIGN_AND_ROADMAP.md` §8 hold. Note that npm
  publishes are permanent (no unpublish after 72 hours), so alpha versions are cheap to add but
  impossible to retract;
- license: MIT (owner decision 2026-07-27; supersedes the earlier `UNLICENSED`-while-private plan
  and the Apache-2.0 proposal);
- validated platform: macOS arm64 with Bun 1.3.13; other platforms remain unverified. The npm bin is
  a Node-compatible launcher that reports the Bun requirement when Bun is absent.

The history-preserving repository extraction is complete. Before each registry publication:

1. Keep the CLI bundle plus prompt/schema sidecars as the distribution format.
2. Run the complete release gate:

   ```sh
   bun install --frozen-lockfile
   bun scripts/check-plugin.ts
   bun run typecheck
   bun run test
   bun run build
   bun run package:smoke
   bun pm pack --dry-run
   ```

3. Inspect the tarball manifest and trigger the release workflow only from a clean, tagged
   revision on `main`.

During private trials, a reviewed tarball can be installed without publishing:

```sh
bun add --global /absolute/path/to/agent-delegator-<version>.tgz
command -v agent-delegator
agent-delegator --help
```

## Phase 2: Claude Code plugin

The separately versioned plugin is distributed from this repository's public Claude Code marketplace:

```text
.claude-plugin/marketplace.json
plugins/agent-delegator/
  .claude-plugin/plugin.json
  skills/delegate-codex/SKILL.md
  handoffs/cross-repository-validation.md
```

Plugin `0.2.3` is thin: it resolves `agent-delegator` from `PATH`, requires core CLI
`0.1.0-alpha.6`, runs `doctor`, and gives one exact installation instruction when versions differ.
It does not reach outside the installed plugin cache for a development checkout. Target-specific
profiles remain in target repositories.

Add the GitHub marketplace and install the plugin with:

```sh
claude plugin marketplace add whatasoda/agent-delegator
claude plugin install agent-delegator@whatasoda-agent-delegator --scope user
```

The plugin and marketplace entry use the same explicit SemVer. Every operator-skill change must bump
both values; pushing without a bump intentionally does not update installed caches. The core CLI and
plugin release independently, and `bun scripts/check-plugin.ts` fails when their verified
compatibility or duplicated personal/plugin skill content drifts.

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
