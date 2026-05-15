#!/usr/bin/env node
"use strict";

const path = require("path");
const { init } = require("../lib/commands/init");
const { detect } = require("../lib/commands/detect");

const COMMANDS = {
  init,
  detect,
};

function printHelp() {
  process.stdout.write(
    [
      "agent-contract — deterministic contract layer for coding agents",
      "",
      "Usage:",
      "  agent-contract <command> [options]",
      "",
      "Commands:",
      "  init      Install the .agent/ contract into the current repo (idempotent)",
      "  detect    Run stack detection only; print result to stdout (no writes)",
      "",
      "Flags:",
      "  --cwd <path>     Run against the given directory (default: process.cwd())",
      "  --yes, -y        Accept all defaults; do not prompt",
      "  --dry-run        Show what would change without writing",
      "  --force          Overwrite existing files (default: merge/skip)",
      "  --help, -h       Show this message",
      "",
    ].join("\n")
  );
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  const command = argv[0];
  const flags = parseFlags(argv.slice(1));

  if (!COMMANDS[command]) {
    process.stderr.write(`Unknown command: ${command}\n\n`);
    printHelp();
    process.exit(2);
  }

  const cwd = path.resolve(flags.cwd || process.cwd());

  try {
    const exitCode = await COMMANDS[command]({ cwd, flags });
    process.exit(exitCode || 0);
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    if (process.env.AGENT_CONTRACT_DEBUG) {
      process.stderr.write(err.stack + "\n");
    }
    process.exit(1);
  }
}

function parseFlags(args) {
  const flags = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--yes" || a === "-y") flags.yes = true;
    else if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--force") flags.force = true;
    else if (a === "--cwd") flags.cwd = args[++i];
    else if (a.startsWith("--")) flags[a.slice(2)] = true;
    else flags._.push(a);
  }
  return flags;
}

main();
