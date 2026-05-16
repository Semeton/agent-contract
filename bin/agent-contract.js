#!/usr/bin/env node
"use strict";

const path = require("path");
const https = require("https");
const { init } = require("../lib/commands/init");
const { detect } = require("../lib/commands/detect");
const { run } = require("../lib/commands/run");
const { update } = require("../lib/commands/update");

const PKG = require("../package.json");

const COMMANDS = {
  init,
  detect,
  run,
  update,
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
      "  update    Refresh roles, checks, templates, and stack — leave conventions/manifest untouched",
      "  detect    Run stack detection only; print result to stdout (no writes)",
      "  run       Run a role against a task via the configured provider",
      "",
      "Flags (all commands):",
      "  --cwd <path>     Run against the given directory (default: process.cwd())",
      "  --dry-run        Show what would happen without writing or calling a provider",
      "  --help, -h       Show this message",
      "  --version, -v    Print installed version and check for updates",
      "",
      "Flags (init):",
      "  --yes, -y        Accept all defaults; skip the preset prompt",
      "  --force          Overwrite existing files (default: merge/skip)",
      "  --preset <name>  Apply a conventions preset without prompting:",
      "                     oop-strict | functional-pragmatic |",
      "                     nestjs-clean-architecture | laravel-service-pattern | none",
      "  --persona <name> Set the agent persona (default: pragmatist):",
      "                     pragmatist | architect | vibecoder | lead",
      "  --learn          After init, sample existing source files and write a draft",
      "                   conventions.yaml to .agent/conventions.draft.yaml for review.",
      "                   Nothing is auto-applied — the draft is yours to edit and merge.",
      "",
      "Flags (update):",
      "  --persona <name> Re-apply a persona to role YAMLs (default: reads from manifest.yaml)",
      "                     pragmatist | architect | vibecoder | lead",
      "",
      "Flags (run):",
      "  --role <name>    Role to activate: generator | integrator | tester | debugger | documenter",
      "  --task <text>    Task description (used when --spec is not provided)",
      "  --spec <file>    Path to a JSON task spec (required fields per role)",
      "  --provider <p>   Override provider (see below)",
      "",
      "Providers (auto-detected in order if --provider is not set):",
      "  anthropic    Calls api.anthropic.com — requires ANTHROPIC_API_KEY",
      "  openai       Calls api.openai.com   — requires OPENAI_API_KEY",
      "  claude-code  Uses your Claude Pro/Max subscription via the installed `claude` CLI.",
      "               No API key needed. Install Claude Code at claude.ai/code.",
      "  echo         Dry-run: prints the assembled prompt, calls nothing.",
      "",
      "Environment variables (run):",
      "  ANTHROPIC_API_KEY   Required for the anthropic provider",
      "  OPENAI_API_KEY      Required for the openai provider",
      "  AGENT_PROVIDER      Override provider (same as --provider)",
      "  AGENT_MODEL         Override model ID (anthropic/openai only)",
      "",
    ].join("\n")
  );
}

async function checkVersion() {
  const current = PKG.version;
  process.stdout.write(`agent-contract ${current}\n`);

  try {
    const latest = await fetchLatestVersion(PKG.name);
    if (latest === current) {
      process.stdout.write(`✓ up to date (latest: ${latest})\n`);
    } else if (isNewer(latest, current)) {
      process.stdout.write(`! update available: ${current} → ${latest}\n`);
      process.stdout.write(`  run: npm i -g ${PKG.name}\n`);
    } else {
      process.stdout.write(`  registry: ${latest}\n`);
    }
  } catch {
    process.stdout.write("  (could not reach registry to check for updates)\n");
  }
}

function fetchLatestVersion(pkgName) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://registry.npmjs.org/${encodeURIComponent(pkgName)}/latest`,
      { headers: { Accept: "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (c) => { data += c; });
        res.on("end", () => {
          try { resolve(JSON.parse(data).version); }
          catch { reject(new Error("bad registry response")); }
        });
      }
    );
    req.setTimeout(5000, () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
  });
}

// Simple semver comparison — returns true if `a` is newer than `b`.
function isNewer(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  if (argv.includes("--version") || argv.includes("-v")) {
    await checkVersion();
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
    if (a === "--version" || a === "-v") flags.version = true;
    else if (a === "--yes" || a === "-y") flags.yes = true;
    else if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--force") flags.force = true;
    else if (a === "--cwd") flags.cwd = args[++i];
    else if (a === "--role") flags.role = args[++i];
    else if (a === "--task") flags.task = args[++i];
    else if (a === "--spec") flags.spec = args[++i];
    else if (a === "--provider") flags.provider = args[++i];
    else if (a === "--preset") flags.preset = args[++i];
    else if (a === "--persona") flags.persona = args[++i];
    else if (a.startsWith("--")) flags[a.slice(2)] = true;
    else flags._.push(a);
  }
  return flags;
}

main();
