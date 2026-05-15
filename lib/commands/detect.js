"use strict";

const { detectStack } = require("../detect");

async function detect({ cwd, flags }) {
  const result = await detectStack(cwd);
  if (flags.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(formatHuman(result) + "\n");
  }
  return 0;
}

function formatHuman(r) {
  const lines = [];
  lines.push(`detected stack (confidence: ${r.confidence})`);
  lines.push("─".repeat(40));
  const fields = [
    "language",
    "runtime",
    "framework",
    "package_manager",
    "test_runner",
    "build",
    "lint",
    "formatter",
    "db",
    "orm",
  ];
  for (const f of fields) {
    lines.push(`  ${f.padEnd(18)} ${r[f] ?? "—"}`);
  }
  if (r.entry_points && r.entry_points.length) {
    lines.push(`  entry_points       ${r.entry_points.join(", ")}`);
  }
  if (r.unresolved && r.unresolved.length) {
    lines.push("");
    lines.push("unresolved fields (please fill in stack.yaml manually):");
    for (const f of r.unresolved) lines.push(`  - ${f}`);
  }
  if (r.evidence && r.evidence.length) {
    lines.push("");
    lines.push("evidence:");
    for (const e of r.evidence) lines.push(`  ${e.source}: ${e.key}=${e.value}`);
  }
  return lines.join("\n");
}

module.exports = { detect };
