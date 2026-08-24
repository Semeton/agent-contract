"use strict";

// Role scope parsing, in JS. This mirrors scope_role_patterns() in the emitted
// checks/scope-lib.sh: same fields, same "empty list means read-only" reading. The
// shell copy is what the PreToolUse hook enforces; this copy is what `update` reads
// to decide whether a regenerated role would hand an agent more reach than it had.
// If you change one, change the other — a divergence here is a silently wrong guard.

const SCOPE_FIELDS = ["may_create", "may_modify", "may_delete"];

function unquote(s) {
  return s.trim().replace(/^["']|["']$/g, "");
}

// Parse the writable globs out of a role YAML.
//
// This deliberately mirrors scope_role_patterns() in scope-lib.sh line for line,
// including its looseness: it matches may_create/may_modify at ANY indent (not only
// inside a `scope:` block) and accepts list items at any indent. The shell copy is what
// the PreToolUse hook actually enforces, so this one must never see FEWER globs than it
// does — under-reporting here means `update` misses a widening and the guard fails open.
// Two extras are safe because they only ever widen what we see: inline flow lists
// (`[a, b]`) and single-quote stripping. The conformance test in test/smoke.js asserts
// the two stay in agreement over a corpus of adversarial shapes.
function parseRoleScope(text) {
  const out = { may_create: [], may_modify: [], may_delete: [] };
  let current = null;

  for (const line of String(text || "").split("\n")) {
    const key = line.match(/^\s*(may_create|may_modify|may_delete)\s*:(.*)$/);
    if (key) {
      const rest = key[2];
      // `key: []` closes immediately — an explicit empty list, i.e. read-only.
      if (/\[\s*\]/.test(rest)) {
        current = null;
        continue;
      }
      current = key[1];
      const flow = rest.trim().match(/^\[(.*)\]$/);
      if (flow) {
        out[current] = flow[1].split(",").map(unquote).filter(Boolean);
        current = null;
      }
      continue;
    }

    if (current) {
      const item = line.match(/^\s*-\s+(.+)$/);
      if (item) out[current].push(unquote(item[1]));
      else current = null; // any non-item line closes the block, as in the shell
    }
  }

  return out;
}

// The globs that actually let an agent put bytes on disk. may_delete is tracked
// separately because gaining delete reach is its own kind of widening.
function writableGlobs(scope) {
  const s = scope || {};
  return [...new Set([...(s.may_create || []), ...(s.may_modify || [])])].sort();
}

// Compare two role YAMLs. `added` is what the new one would gain — that is the
// direction that needs human intent. `removed` is a narrowing and always safe.
function diffRoleScope(oldText, newText) {
  const before = parseRoleScope(oldText);
  const after = parseRoleScope(newText);

  const beforeWrite = new Set(writableGlobs(before));
  const afterWrite = new Set(writableGlobs(after));
  const beforeDelete = new Set(before.may_delete || []);
  const afterDelete = new Set(after.may_delete || []);

  const added = [...afterWrite].filter((g) => !beforeWrite.has(g)).sort();
  const removed = [...beforeWrite].filter((g) => !afterWrite.has(g)).sort();
  const addedDelete = [...afterDelete].filter((g) => !beforeDelete.has(g)).sort();

  return {
    added,
    removed,
    addedDelete,
    widens: added.length > 0 || addedDelete.length > 0,
  };
}

module.exports = { parseRoleScope, writableGlobs, diffRoleScope, SCOPE_FIELDS };
