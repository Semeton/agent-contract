"use strict";

const readline = require("readline");

const PRESETS = [
  { key: "oop-strict",                label: "oop-strict" },
  { key: "functional-pragmatic",      label: "functional-pragmatic" },
  { key: "nestjs-clean-architecture", label: "nestjs-clean-architecture" },
  { key: "laravel-service-pattern",   label: "laravel-service-pattern" },
  { key: "none",                      label: "none (blank file)" },
];

// Returns a preset key string. Never throws.
// Resolution order: --preset flag → non-TTY default → interactive prompt.
async function resolvePreset(flags) {
  // Explicit flag wins unconditionally
  if (flags.preset) {
    const valid = PRESETS.find((p) => p.key === flags.preset);
    return valid ? valid.key : "none";
  }

  // Non-interactive environments (CI, pipes, --yes) → no prompt
  if (!process.stdin.isTTY || !process.stdout.isTTY || flags.yes) {
    return "none";
  }

  return promptInteractive();
}

function promptInteractive() {
  process.stdout.write("\n? Which conventions preset would you like to start with?\n");
  PRESETS.forEach((p, i) => {
    process.stdout.write(`  ${i + 1}) ${p.label}\n`);
  });
  process.stdout.write(`\nEnter number [1-${PRESETS.length}] or press Enter to skip: `);

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    rl.once("line", (line) => {
      rl.close();
      const n = parseInt(line.trim(), 10);
      resolve(n >= 1 && n <= PRESETS.length ? PRESETS[n - 1].key : "none");
    });
    rl.once("close", () => resolve("none"));
  });
}

module.exports = { resolvePreset, PRESETS };
