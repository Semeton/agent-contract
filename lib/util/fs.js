"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Write a file with idempotency awareness.
 *
 * Modes:
 *   - "create-only" (default): write only if file doesn't exist
 *   - "merge-shim":   for shim files; append a marker block if missing,
 *                     leave existing content otherwise
 *   - "overwrite":    used with --force
 */
function writeFile(absPath, content, options = {}) {
  const { mode = "create-only", dryRun = false, force = false } = options;

  const exists = fs.existsSync(absPath);
  let action; // "create" | "skip" | "overwrite" | "merge"

  if (!exists) {
    action = "create";
  } else if (force) {
    action = "overwrite";
  } else if (mode === "merge-shim") {
    const existing = fs.readFileSync(absPath, "utf8");
    if (existing.includes("agent-contract:shim")) {
      action = "skip";
    } else {
      action = "merge";
      content = existing.trimEnd() + "\n\n" + content;
    }
  } else {
    action = "skip";
  }

  if (action !== "skip" && !dryRun) {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content);
  }

  return { path: absPath, action };
}

module.exports = { writeFile };
