"use strict";

const fs = require("fs");
const path = require("path");

// Hook commands run with no guarantee about the working directory, so a relative path
// can resolve to nothing. Claude Code exports CLAUDE_PROJECT_DIR (the project root where
// the session started) for exactly this; quote it so paths with spaces survive. A hook
// whose script cannot be found exits 127, which PreToolUse treats as a NON-BLOCKING
// error -- the write proceeds. Silent, and indistinguishable from "no violation".
const SCOPE_CHECK_CMD = 'bash "$CLAUDE_PROJECT_DIR/.agent/checks/scope-check.sh"';
const BASH_GUARD_CMD = 'bash "$CLAUDE_PROJECT_DIR/.agent/checks/bash-write-guard.sh"';
const WRITE_HANDOFF_CMD = 'bash "$CLAUDE_PROJECT_DIR/.agent/checks/write-handoff.sh"';

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

  // Claude Code merges settings.local.json over settings.json. Team repos often keep the
  // hooks in the untracked local file so the shared one stays clean; a hook wired there is
  // installed, and adding it again to the tracked file would show up in the team's diffs.
  let local = {};
  try {
    local = JSON.parse(fs.readFileSync(path.join(claudeDir, "settings.local.json"), "utf8"));
  } catch {
    // absent or unreadable — nothing wired locally
  }
  const wiredLocally = (event, script) =>
    ((local.hooks && local.hooks[event]) || []).some(
      (entry) => entry.hooks && entry.hooks.some((h) => h.command && h.command.includes(script))
    );

  // PreToolUse — scope enforcement (idempotent check by command string)
  if (!existing.hooks.PreToolUse) existing.hooks.PreToolUse = [];
  const hasScopeHook = wiredLocally("PreToolUse", "scope-check.sh") || existing.hooks.PreToolUse.some(
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

  // PreToolUse — Bash write guard (blocks Bash tampering with contract-controlled files)
  const hasBashGuardHook = wiredLocally("PreToolUse", "bash-write-guard.sh") || existing.hooks.PreToolUse.some(
    (entry) =>
      entry.hooks &&
      entry.hooks.some((h) => h.command && h.command.includes("bash-write-guard.sh"))
  );
  if (!hasBashGuardHook) {
    existing.hooks.PreToolUse.push({
      matcher: "Bash",
      hooks: [{ type: "command", command: BASH_GUARD_CMD }],
    });
  }

  // Stop — auto handoff note
  if (!existing.hooks.Stop) existing.hooks.Stop = [];
  const hasHandoffHook = wiredLocally("Stop", "write-handoff.sh") || existing.hooks.Stop.some(
    (entry) =>
      entry.hooks &&
      entry.hooks.some((h) => h.command && h.command.includes("write-handoff.sh"))
  );
  if (!hasHandoffHook) {
    existing.hooks.Stop.push({
      hooks: [{ type: "command", command: WRITE_HANDOFF_CMD }],
    });
  }

  const allAlreadyPresent = hasScopeHook && hasBashGuardHook && hasHandoffHook;
  if (allAlreadyPresent) return { action: "skip", path: settingsPath };

  const content = JSON.stringify(existing, null, 2) + "\n";
  const action = fileExists ? "merge" : "create";

  if (!dryRun) {
    if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(settingsPath, content);
  }

  return { action, path: settingsPath };
}

module.exports = { installClaudeHooks };
