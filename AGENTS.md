# Agent guidance

Read and follow `CLAUDE.md` before changing this repository. The behavioral and distribution
contracts live in `README.md` and `docs/`.

When working from an agent-delegator Implementation Brief:

- Treat the approved Brief as the task contract and do not redesign behavior silently.
- Preserve every MUST. Return `needs-decision` if a MUST conflicts with code or documentation.
- Do not commit, push, open a PR, publish, or mutate external state from a delegated implementation
  run. The Claude main agent owns integration and release actions.
- Run the Brief's verification and report failed or skipped commands accurately.
