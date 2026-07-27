#!/usr/bin/env node
// The CLI runtime is a Bun-target bundle; without this launcher, npm/npx users without Bun fail
// with an unactionable "env: bun: No such file or directory".
"use strict";
const { spawnSync } = require("node:child_process");
const { join } = require("node:path");

const result = spawnSync(
  "bun",
  [join(__dirname, "..", "dist", "agent-delegator"), ...process.argv.slice(2)],
  { stdio: "inherit" },
);
if (result.error && result.error.code === "ENOENT") {
  process.stderr.write(
    "agent-delegator requires Bun >= 1.3.0 and could not find `bun` on PATH.\n" +
      "Install it from https://bun.sh, then re-run this command.\n",
  );
  process.exit(127);
}
if (result.error) throw result.error;
if (result.signal) {
  process.kill(process.pid, result.signal);
}
process.exit(result.status ?? 1);
