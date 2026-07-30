# agent-delegator Claude Code plugin

This thin operator plugin teaches Claude Code how to use the separately installed
`@whatasoda/agent-delegator` CLI while preserving Claude's ownership of design, approval,
integration, and release actions.

## Compatibility

Plugin `0.2.0` is verified with core CLI `0.1.0-alpha.3`, Bun 1.3.0 or newer, and a Codex CLI that
supports schema-constrained `codex exec` output. The `delegate-codex` skill runs the CLI's `doctor`
preflight before delegation.

Install the compatible CLI:

```sh
bun add --global @whatasoda/agent-delegator@0.1.0-alpha.3
```

## Install

In Claude Code:

```text
/plugin marketplace add whatasoda/agent-delegator
/plugin install agent-delegator@whatasoda-agent-delegator
/reload-plugins
```

Invoke `/agent-delegator:delegate-codex`, or describe a bounded implementation, repository-policy
verification, autonomous improvement, or read-only repository investigation and let Claude select the skill.

## Update

```text
/plugin marketplace update whatasoda-agent-delegator
/plugin update agent-delegator@whatasoda-agent-delegator
/reload-plugins
```

The CLI and plugin have independent versions. Update both when the plugin compatibility section
names a newer core CLI.
