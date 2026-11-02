"use strict";

// Where this repository keeps decisions, for the text agent-contract emits and for the
// merge gate. repo-memory is detected by its config file at the root; there is no
// package dependency between the two tools, only this file convention.

const fs = require("fs");
const path = require("path");
const { loadConfig } = require("./config");

const DEFAULT_DIR = "docs/decisions";

function clean(dir) {
  return String(dir).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

// { repoMemory, decisionsDir, dirs }: dirs lists every folder a recorded decision may
// live in (agent-contract's decisions_dir and repo-memory's dir, when they differ).
function decisionContext(cwd) {
  let acDir = DEFAULT_DIR;
  try {
    const config = loadConfig(cwd);
    if (config.decisions_dir) acDir = clean(config.decisions_dir);
  } catch {
    /* no or unreadable config: default */
  }
  const rmFile = path.join(cwd, "repo-memory.json");
  const repoMemory = fs.existsSync(rmFile);
  let rmDir = null;
  if (repoMemory) {
    rmDir = DEFAULT_DIR;
    try {
      const rm = JSON.parse(fs.readFileSync(rmFile, "utf8"));
      if (rm && typeof rm.dir === "string" && rm.dir.trim()) rmDir = clean(rm.dir);
    } catch {
      /* repo-memory reports its own config errors */
    }
  }
  const decisionsDir = rmDir || acDir;
  const dirs = [...new Set([acDir, rmDir].filter(Boolean))];
  return { repoMemory, decisionsDir, dirs };
}

module.exports = { decisionContext, DEFAULT_DIR };
