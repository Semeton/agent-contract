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

  // Enforcement integrity. Prevention is handled by the guards; this is the detection
  // half — a way for a human or a CI step to see that the enforcement layer is still
  // the one this version of agent-contract would install. Drift is not necessarily an
  // attack (a stale repo drifts too), but it should never be invisible.
  process.stdout.write("\nenforcement:\n");

  const settingsPath = path.join(cwd, ".claude/settings.json");
  if (fs.existsSync(settingsPath)) {
    const raw = fs.readFileSync(settingsPath, "utf8");
    const wired = ["scope-check.sh", "bash-write-guard.sh", "write-handoff.sh"]
      .filter((h) => !raw.includes(h));
    process.stdout.write(
      wired.length === 0
        ? "  hooks:      wired (scope-check, bash-write-guard, write-handoff)\n"
        : `  hooks:      INCOMPLETE — not referenced: ${wired.join(", ")}\n`
    );
  } else {
    process.stdout.write("  hooks:      not wired (no .claude/settings.json)\n");
  }

  const T = require("../util/templates");
  const { detectStack } = require("../detect");
  let detection;
  try {
    detection = await detectStack(cwd);
  } catch {
    detection = { language: "", framework: "" };
  }
  const expected = {
    "pre-generate.sh": T.preGenerateCheck(),
    "post-generate.sh": T.postGenerateCheck(detection),
    "debug-scope.sh": T.debugScopeCheck(),
    "security-audit.sh": T.securityAuditCheck(),
    "review-check.sh": T.reviewCheck(),
    "write-handoff.sh": T.writeHandoffScript(),
    "scope-lib.sh": T.scopeLibScript(),
    "scope-check.sh": T.scopeCheckScript(),
    "bash-write-guard.sh": T.bashWriteGuardScript(),
  };
  const drifted = [];
  const absent = [];
  for (const [name, content] of Object.entries(expected)) {
    const abs = path.join(agentDir, "checks", name);
    if (!fs.existsSync(abs)) { absent.push(name); continue; }
    try {
      if (fs.readFileSync(abs, "utf8") !== content) drifted.push(name);
    } catch { drifted.push(name); }
  }
  if (absent.length === 0 && drifted.length === 0) {
    process.stdout.write("  checks:     match the installed templates\n");
  } else {
    if (absent.length) process.stdout.write(`  checks:     MISSING — ${absent.join(", ")}\n`);
    if (drifted.length) process.stdout.write(`  checks:     DRIFTED — ${drifted.join(", ")}\n`);
    process.stdout.write("              run `agent-contract update` to reconcile (out-of-band)\n");
  }

  // Role drift, reported in BOTH directions. An earlier version only flagged scopes
  // wider on disk than the template — the out-of-band-grant case — and so read "clean"
  // while the deployed roles were silently NARROWER, i.e. an update that never landed.
  // That blind spot is how a stale contract passes for a current one.
  const wider = [];
  const narrower = [];
  const missing = [];
  const { diffRoleScope } = require("../util/scope");
  for (const r of T.ROLES) {
    const abs = path.join(agentDir, "roles", `${r}.yaml`);
    if (!fs.existsSync(abs)) { missing.push(r); continue; }
    // diffRoleScope(before, after): `added` is what `after` gains over `before`.
    // With disk as `before` and template as `after`: added = missing from disk
    // (undeployed), removed = present on disk but not in the template (granted).
    const d = diffRoleScope(fs.readFileSync(abs, "utf8"), T.roleYaml(r, personaMatch ? personaMatch[1] : "pragmatist", detection));
    if (d.removed.length > 0) wider.push(`${r} (+${d.removed.join(" +")})`);
    if (d.added.length > 0) narrower.push(`${r} (-${d.added.join(" -")})`);
  }
  if (missing.length === 0 && wider.length === 0 && narrower.length === 0) {
    process.stdout.write("  roles:      match the installed templates\n");
  } else {
    if (missing.length) process.stdout.write(`  roles:      MISSING — ${missing.join(", ")}\n`);
    if (wider.length) process.stdout.write(`  roles:      WIDER than template (granted out-of-band) — ${wider.join(", ")}\n`);
    if (narrower.length) process.stdout.write(`  roles:      NARROWER than template (update never landed) — ${narrower.join(", ")}\n`);
    process.stdout.write("              run `agent-contract update` to reconcile (out-of-band)\n");
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
