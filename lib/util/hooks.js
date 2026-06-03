"use strict";

const fs = require("fs");
const path = require("path");

const SCOPE_CHECK_CMD = "bash .agent/checks/scope-check.sh";
const WRITE_HANDOFF_CMD = "bash .agent/checks/write-handoff.sh";

/**
 * Merge agent-contract hooks into .claude/settings.json (idempotent).
 * Creates the file and directory if absent; merges if it already exists.
 * Returns { action: "create"|"merge"|"skip", path }.
 */
function installClaudeHooks(cwd, dryRun) {
  const claudeDir = path.join(cwd, ".claude");
  const settingsPath = path.join(claudeDir, "settings.json");

  let existing = {};
  const fileExists = fs.existsSync(settingsPath);
  if (fileExists) {
    try {
      existing = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch {
      // Corrupt or non-JSON — preserve the path but start fresh hooks section.
    }
  }

  if (!existing.hooks) existing.hooks = {};

  // PreToolUse — scope enforcement (idempotent check by command string)
  if (!existing.hooks.PreToolUse) existing.hooks.PreToolUse = [];
  const hasScopeHook = existing.hooks.PreToolUse.some(
    (entry) =>
      entry.hooks &&
      entry.hooks.some((h) => h.command && h.command.includes("scope-check.sh"))
  );
  if (!hasScopeHook) {
    existing.hooks.PreToolUse.push({
      matcher: "Write|Edit|MultiEdit",
      hooks: [{ type: "command", command: SCOPE_CHECK_CMD }],
    });
  }

  // Stop — auto handoff note
  if (!existing.hooks.Stop) existing.hooks.Stop = [];
  const hasHandoffHook = existing.hooks.Stop.some(
    (entry) =>
      entry.hooks &&
      entry.hooks.some((h) => h.command && h.command.includes("write-handoff.sh"))
  );
  if (!hasHandoffHook) {
    existing.hooks.Stop.push({
      hooks: [{ type: "command", command: WRITE_HANDOFF_CMD }],
    });
  }

  const bothAlreadyPresent = hasScopeHook && hasHandoffHook;
  if (bothAlreadyPresent) return { action: "skip", path: settingsPath };

  const content = JSON.stringify(existing, null, 2) + "\n";
  const action = fileExists ? "merge" : "create";

  if (!dryRun) {
    if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(settingsPath, content);
  }

  return { action, path: settingsPath };
}

module.exports = { installClaudeHooks };
