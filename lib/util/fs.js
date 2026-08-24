"use strict";

const fs = require("fs");
const path = require("path");

const SHIM_MARKERS = {
  open: "<!-- agent-contract:shim -->",
  close: "<!-- /agent-contract:shim -->",
};

// Must stay in sync with CONFIG_DOCS_OPEN/CLOSE in lib/util/templates.js.
const CONFIG_MARKERS = {
  open: "# agent-contract:config-docs",
  close: "# /agent-contract:config-docs",
};

// Replace the text between a marker pair, preserving everything outside it byte-for-byte.
// Returns null when NEITHER marker is present — that case is policy, so the caller decides.
function refreshMarkedBlock(existing, content, markers) {
  const start = existing.indexOf(markers.open);
  const end = existing.indexOf(markers.close);
  if (start === -1 && end === -1) return null;
  // Half a pair — the block's boundaries are unknowable, so don't guess.
  if (start === -1 || end === -1 || end < start) return { action: "skip" };

  // Splice in only the MARKED portion of the incoming content. A generated file may
  // carry material outside its markers — config.yaml's example settings sit below the
  // closing marker — and copying that in would duplicate it on every refresh.
  const cStart = content.indexOf(markers.open);
  const cEnd = content.indexOf(markers.close);
  if (cStart === -1 || cEnd === -1 || cEnd < cStart) return { action: "skip" };
  const block = content.slice(cStart, cEnd + markers.close.length);

  const merged = existing.slice(0, start) + block + existing.slice(end + markers.close.length);
  return merged === existing ? { action: "skip" } : { action: "merge", content: merged };
}

// True when a config file holds nothing but comments and blank lines, i.e. the user has
// not set anything yet. Only such a file is safe to regenerate wholesale.
function hasNoActiveSettings(text) {
  return !text.split("\n").some((line) => {
    const t = line.trim();
    return t.length > 0 && !t.startsWith("#");
  });
}

/**
 * Write a file with idempotency awareness.
 *
 * Modes:
 *   - "create-only" (default): write only if file doesn't exist
 *   - "merge-shim":   for shim files; append a marker block if missing, or refresh
 *                     the existing block in place, leaving surrounding content intact
 *   - "merge-config": for .agent/config.yaml; refresh the marked documentation block
 *                     and never touch the settings below it. A pre-markers file is
 *                     regenerated only when it holds no active settings at all
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
    // Refresh in place. Skipping here would freeze a repo's shim at whatever version
    // first wrote it, so `agent-contract update` could never ship a shim change.
    const existing = fs.readFileSync(absPath, "utf8");
    const res = refreshMarkedBlock(existing, content, SHIM_MARKERS);
    if (res) {
      action = res.action;
      if (res.content !== undefined) content = res.content;
    } else {
      // No shim yet — append one after the user's own content.
      action = "merge";
      content = existing.trimEnd() + "\n\n" + content;
    }
  } else if (mode === "merge-config") {
    const existing = fs.readFileSync(absPath, "utf8");
    const res = refreshMarkedBlock(existing, content, CONFIG_MARKERS);
    if (res) {
      action = res.action;
      if (res.content !== undefined) content = res.content;
    } else if (hasNoActiveSettings(existing)) {
      // Written before the markers existed and still untouched — safe to regenerate,
      // which is what carries stale defaults (old model ids, missing keys) forward.
      action = existing === content ? "skip" : "overwrite";
    } else {
      // Pre-markers file with real settings in it. Refreshing would mean guessing
      // which lines are ours, so leave it alone entirely.
      action = "skip";
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

module.exports = { writeFile, refreshMarkedBlock, hasNoActiveSettings, SHIM_MARKERS, CONFIG_MARKERS };
