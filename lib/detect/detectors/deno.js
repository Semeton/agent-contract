"use strict";

// Deno uses TypeScript natively. Identified by deno.json / deno.jsonc.
// Scores higher than the Node detector to win when both package.json and deno.json exist.

const FRAMEWORK_HINTS = [
  { key: "fresh",  label: "fresh" },
  { key: "oak",    label: "oak" },
  { key: "hono",   label: "hono" },
];

async function detect(ctx) {
  const hasDenoJson = ctx.exists("deno.json") || ctx.exists("deno.jsonc");
  if (!hasDenoJson) return null;

  const denoJson =
    ctx.readJSON("deno.json") || ctx.readJSON("deno.jsonc") || {};
  const evidence = [{ source: "manifest", key: "deno.json", value: "found" }];

  // ---- framework: check imports map or tasks ----
  let framework = null;
  const importsStr = JSON.stringify(denoJson.imports || {});
  for (const { key, label } of FRAMEWORK_HINTS) {
    if (importsStr.includes(key)) {
      framework = label;
      evidence.push({ source: "imports", key: "framework", value: label });
      break;
    }
  }

  // ---- entry points ----
  const entry_points = [];
  for (const candidate of ["main.ts", "mod.ts", "src/main.ts", "src/mod.ts"]) {
    if (ctx.exists(candidate)) entry_points.push(candidate);
  }

  // ---- score: beat Node (60) when deno.json present ----
  let score = 80;
  if (framework) score += 15;

  return {
    language: "typescript",
    runtime: "deno",
    framework,
    package_manager: "deno",
    test_runner: "deno-test",
    build: denoJson.tasks && denoJson.tasks.build ? "deno task build" : null,
    lint: "deno-lint",
    formatter: "deno-fmt",
    db: null,
    orm: null,
    entry_points,
    evidence,
    score,
  };
}

module.exports = { detect };
