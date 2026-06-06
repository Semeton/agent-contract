"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { loadConfig } = require("../util/config");
const { detectProvider } = require("../providers");

async function status({ cwd }) {
  const agentDir = path.join(cwd, ".agent");

  if (!fs.existsSync(path.join(agentDir, "manifest.yaml"))) {
    process.stderr.write("error: no .agent/manifest.yaml — run `agent-contract init` first\n");
    return 1;
  }

  process.stdout.write("agent-contract status\n");
  process.stdout.write(`  target: ${cwd}\n\n`);

  // Active role
  const roleFile = path.join(agentDir, "session/active-role.txt");
  const activeRole = fs.existsSync(roleFile)
    ? fs.readFileSync(roleFile, "utf8").trim() || "(empty)"
    : "(none — write a role name to .agent/session/active-role.txt before editing source files)";
  process.stdout.write(`role:         ${activeRole}\n`);

  // Contract version
  const manifestContent = fs.readFileSync(path.join(agentDir, "manifest.yaml"), "utf8");
  const versionMatch = manifestContent.match(/^version:\s*(\S+)/m);
  const personaMatch = manifestContent.match(/^persona:\s*(\S+)/m);
  process.stdout.write(`contract:     ${versionMatch ? versionMatch[1] : "unknown"}\n`);
  process.stdout.write(`persona:      ${personaMatch ? personaMatch[1] : "unknown"}\n`);

  // Provider
  const config = loadConfig(cwd);
  const provider = config.provider || detectProvider();
  process.stdout.write(`provider:     ${provider}${config.provider ? "" : " (auto-detected)"}\n`);
  if (config.model) process.stdout.write(`model:        ${config.model}\n`);

  // Codebase map freshness
  const mapFile = path.join(agentDir, "memory/codebase-map.md");
  let mapStatus = "(not found — run `agent-contract update`)";
  if (fs.existsSync(mapFile)) {
    const gitDir = path.join(cwd, ".git");
    if (fs.existsSync(gitDir)) {
      try {
        const lastCommit = parseInt(
          execSync(`git -C "${cwd}" log -1 --format="%ct"`, { stdio: "pipe" }).toString().trim(),
          10,
        );
        const mapMtime = Math.floor(fs.statSync(mapFile).mtimeMs / 1000);
        mapStatus = lastCommit > mapMtime
          ? "STALE (commits after last update — run `agent-contract update`)"
          : "up to date";
      } catch {
        mapStatus = "present (git check failed)";
      }
    } else {
      mapStatus = "present (no git repo)";
    }
  }
  process.stdout.write(`codebase map: ${mapStatus}\n`);

  // Decisions summary
  const decisionsFile = path.join(agentDir, "memory/decisions.jsonl");
  process.stdout.write("\nlast decisions:\n");
  if (fs.existsSync(decisionsFile)) {
    const lines = fs.readFileSync(decisionsFile, "utf8").trim().split("\n").filter(Boolean);
    if (lines.length === 0) {
      process.stdout.write("  (none logged yet)\n");
    } else {
      for (const line of lines.slice(-5)) {
        try {
          const d = JSON.parse(line);
          const pct = d.tokens && d.tokens.pct != null ? `${d.tokens.pct}% ctx` : "—";
          process.stdout.write(`  [${d.ts}] ${d.role}: ${d.task} (${pct})\n`);
        } catch { /* skip malformed lines */ }
      }
      process.stdout.write(`  (${lines.length} total — archive: decisions-archive.jsonl)\n`);
    }
  } else {
    process.stdout.write("  (decisions.jsonl not found)\n");
  }

  // Registered checks
  const checksDir = path.join(agentDir, "checks");
  process.stdout.write("\nchecks:\n");
  if (fs.existsSync(checksDir)) {
    const checks = fs.readdirSync(checksDir)
      .filter((f) => f.endsWith(".sh"))
      .sort();
    for (const c of checks) {
      process.stdout.write(`  ${c}\n`);
    }
  } else {
    process.stdout.write("  (no checks installed)\n");
  }

  // Handoff notes
  const memoryDir = path.join(agentDir, "memory");
  if (fs.existsSync(memoryDir)) {
    const handoffs = fs.readdirSync(memoryDir)
      .filter((f) => f.startsWith("handoff-") && f.endsWith(".md"))
      .sort()
      .slice(-3);
    if (handoffs.length > 0) {
      process.stdout.write("\nrecent handoffs:\n");
      for (const h of handoffs) {
        process.stdout.write(`  .agent/memory/${h}\n`);
      }
    }
  }

  process.stdout.write("\n");
  return 0;
}

module.exports = { status };
