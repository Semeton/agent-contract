"use strict";

const readline = require("readline");

const PRESETS = [
  { key: "oop-strict",                label: "oop-strict" },
  { key: "functional-pragmatic",      label: "functional-pragmatic" },
  { key: "nestjs-clean-architecture", label: "nestjs-clean-architecture" },
  { key: "laravel-service-pattern",   label: "laravel-service-pattern" },
  { key: "none",                      label: "none (blank file)" },
];

const PERSONAS = [
  { key: "pragmatist", label: "pragmatist  — balanced default; quality without ceremony" },
  { key: "architect",  label: "architect   — deliberate, systems-first, documents every decision" },
  { key: "vibecoder",  label: "vibecoder   — ship fast, minimal ceremony, prototype over spec" },
  { key: "lead",       label: "lead        — mentorship mode; explain the why, write for the junior" },
];

// Returns a preset key string. Never throws.
// Resolution order: --preset flag → non-TTY default → interactive prompt.
async function resolvePreset(flags) {
  if (flags.preset) {
    const valid = PRESETS.find((p) => p.key === flags.preset);
    return valid ? valid.key : "none";
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY || flags.yes) {
    return "none";
  }
  return promptOne("Which conventions preset would you like to start with?", PRESETS, "none");
}

// Returns a persona key string. Never throws.
// Resolution order: --persona flag → non-TTY default → interactive prompt.
async function resolvePersona(flags) {
  if (flags.persona) {
    const valid = PERSONAS.find((p) => p.key === flags.persona);
    return valid ? valid.key : "pragmatist";
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY || flags.yes) {
    return "pragmatist";
  }
  return promptOne("Which agent persona should govern this repo?", PERSONAS, "pragmatist");
}

function promptOne(question, options, fallback) {
  process.stdout.write(`\n? ${question}\n`);
  options.forEach((p, i) => {
    process.stdout.write(`  ${i + 1}) ${p.label}\n`);
  });
  process.stdout.write(`\nEnter number [1-${options.length}] or press Enter for default: `);

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    rl.once("line", (line) => {
      rl.close();
      const n = parseInt(line.trim(), 10);
      resolve(n >= 1 && n <= options.length ? options[n - 1].key : fallback);
    });
    rl.once("close", () => resolve(fallback));
  });
}

module.exports = { resolvePreset, resolvePersona, PRESETS, PERSONAS };
