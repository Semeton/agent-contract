"use strict";

// The run log: one JSON line per `agent-contract run` (role, task, model, tokens,
// which checks passed). It is telemetry about agent sessions, not a record of team
// decisions, so it lives in `.agent/memory/runs.jsonl`.
//
// Before 0.10.0 the same file was called `decisions.jsonl`, and agents were also told
// to log decisions in it. That gave decisions a write path with no review and no
// evidence, and it collided with repo-memory, which owns decisions in docs/decisions/.
// Durable decisions now go to docs/decisions/ (an ADR, or a repo-memory record).
//
// Migration is conservative: an old decisions.jsonl is renamed only when every line in
// it is a run entry. If a person or an agent wrote anything else there, the file is
// left exactly where it is and reported, because guessing which lines are decisions
// would be worse than leaving them.

const fs = require("fs");
const path = require("path");

const RUNS = "runs.jsonl";
const RUNS_ARCHIVE = "runs-archive.jsonl";
const LEGACY = "decisions.jsonl";
const LEGACY_ARCHIVE = "decisions-archive.jsonl";

function memoryDir(cwd) {
  return path.join(cwd, ".agent", "memory");
}

// A line `agent-contract run` wrote: ts, role and task, plus at least one field only a
// run carries. `tokens` was added in a later version, so older run entries have only
// provider, model or checks; requiring tokens misread them as hand-written lines.
const RUN_FIELDS = ["tokens", "provider", "model", "checks", "output_lines"];
function isRunEntry(obj) {
  return !!obj && typeof obj === "object" && !Array.isArray(obj) &&
    typeof obj.ts === "string" && "role" in obj && "task" in obj && RUN_FIELDS.some((k) => k in obj);
}

// A line an agent wrote when the old shim told it to "log non-trivial decisions".
function isDecisionEntry(obj) {
  return !!obj && typeof obj === "object" && !Array.isArray(obj) && typeof obj.decision === "string";
}

function readLines(file) {
  try {
    return fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim());
  } catch {
    return [];
  }
}

// Classify an old decisions.jsonl: { runs, other } line counts.
function classifyLegacy(file) {
  let runs = 0;
  let other = 0;
  let decisions = 0;
  for (const line of readLines(file)) {
    try {
      const obj = JSON.parse(line);
      if (isRunEntry(obj)) runs++;
      else {
        other++;
        if (isDecisionEntry(obj)) decisions++;
      }
    } catch {
      other++;
    }
  }
  return { runs, other, decisions };
}

const IMPORT_CMD = "npx @semeton/repo-memory import .agent/memory/decisions.jsonl";

// What to do with a decisions.jsonl that holds more than run entries. The exact command,
// not a description of one: the person reading this is mid-upgrade and wants a next step.
function keptAdvice({ other, decisions }) {
  const what = decisions
    ? `${decisions} decision${decisions === 1 ? "" : "s"} an agent logged${other > decisions ? ` (and ${other - decisions} other line${other - decisions === 1 ? "" : "s"})` : ""}`
    : `${other} line${other === 1 ? "" : "s"} that ${other === 1 ? "is" : "are"} not run entries`;
  return (
    `${LEGACY} holds ${what}, so it was left in place. ` +
    `To keep them as reviewable decisions, run: ${IMPORT_CMD} ` +
    `(each becomes a proposal in docs/decisions/; lines an existing record already cites are skipped). ` +
    `Then review the proposals and remove ${LEGACY}; git history keeps the original.`
  );
}

// Rename decisions.jsonl (and its archive) to runs.jsonl when that is safe.
// Returns { action, detail } where action is one of:
//   "none"      nothing to migrate
//   "migrated"  renamed; detail says how many run entries moved
//   "kept"      decisions.jsonl holds non-run lines and was left in place
//   "both"      runs.jsonl already exists next to a decisions.jsonl; nothing touched
function migrateRunLog(cwd, { dryRun = false } = {}) {
  const dir = memoryDir(cwd);
  const legacy = path.join(dir, LEGACY);
  const runs = path.join(dir, RUNS);
  if (!fs.existsSync(legacy)) return { action: "none" };
  if (fs.existsSync(runs)) {
    return { action: "both", detail: `${LEGACY} and ${RUNS} both exist; ${LEGACY} was left alone` };
  }
  const counts = classifyLegacy(legacy);
  const n = counts.runs;
  if (counts.other > 0) return { action: "kept", detail: keptAdvice(counts) };
  if (!dryRun) {
    fs.renameSync(legacy, runs);
    const legacyArchive = path.join(dir, LEGACY_ARCHIVE);
    const runsArchive = path.join(dir, RUNS_ARCHIVE);
    if (fs.existsSync(legacyArchive) && !fs.existsSync(runsArchive)) fs.renameSync(legacyArchive, runsArchive);
  }
  return { action: "migrated", detail: `${LEGACY} → ${RUNS} (${n} run entr${n === 1 ? "y" : "ies"})` };
}

// The file to read run history from: runs.jsonl, else a legacy decisions.jsonl.
function runLogForReading(cwd) {
  const dir = memoryDir(cwd);
  const runs = path.join(dir, RUNS);
  if (fs.existsSync(runs)) return runs;
  const legacy = path.join(dir, LEGACY);
  if (fs.existsSync(legacy)) return legacy;
  return runs;
}

// The file `run` appends to. Always runs.jsonl; a safe legacy file is migrated first so
// history stays in one place.
function runLogForWriting(cwd) {
  migrateRunLog(cwd);
  return path.join(memoryDir(cwd), RUNS);
}

function runArchivePath(cwd) {
  return path.join(memoryDir(cwd), RUNS_ARCHIVE);
}

// Last n run entries, oldest first. Lines that aren't run entries are skipped.
function recentRuns(file, n = 5) {
  const out = [];
  for (const line of readLines(file)) {
    try {
      const obj = JSON.parse(line);
      if (isRunEntry(obj)) out.push(obj);
    } catch {
      /* skip malformed lines */
    }
  }
  return out.slice(-n);
}

module.exports = {
  RUNS, RUNS_ARCHIVE, LEGACY, LEGACY_ARCHIVE,
  isRunEntry, isDecisionEntry, classifyLegacy, keptAdvice, IMPORT_CMD, migrateRunLog, runLogForReading, runLogForWriting, runArchivePath, recentRuns,
};
