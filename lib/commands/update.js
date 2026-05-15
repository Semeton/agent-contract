"use strict";

const path = require("path");
const fs = require("fs");
const { detectStack } = require("../detect");
const { writeFile } = require("../util/fs");
const T = require("../util/templates");

// Read the persona field from an existing manifest.yaml without a full YAML parser.
function readPersonaFromManifest(cwd) {
  try {
    const content = fs.readFileSync(path.join(cwd, ".agent/manifest.yaml"), "utf8");
    const m = content.match(/^persona:\s*(\S+)/m);
    return m ? m[1] : "pragmatist";
  } catch {
    return "pragmatist";
  }
}

async function update({ cwd, flags }) {
  const dryRun = !!flags.dryRun;

  process.stdout.write("agent-contract update\n");
  process.stdout.write(`  target: ${cwd}\n`);
  if (dryRun) process.stdout.write("  mode:   dry-run (no files will be written)\n");
  process.stdout.write("\n");

  // ---- guard: must already be initialized ----
  if (!fs.existsSync(path.join(cwd, ".agent/manifest.yaml"))) {
    process.stderr.write(
      "error: no .agent/manifest.yaml found. Run `agent-contract init` first.\n"
    );
    return 1;
  }

  // ---- 1. detect stack ----
  process.stdout.write("[1/3] detecting stack…\n");
  const detection = await detectStack(cwd);
  process.stdout.write(
    `      language=${detection.language} framework=${detection.framework ?? "—"} confidence=${detection.confidence}\n\n`
  );

  // ---- 2. resolve persona ----
  // --persona flag wins; otherwise read from existing manifest.yaml
  const persona = flags.persona
    ? flags.persona
    : readPersonaFromManifest(cwd);
  process.stdout.write(`[2/3] persona: ${persona}\n\n`);

  // ---- 3. execute refresh plan ----
  process.stdout.write("[3/3] refreshing files…\n");

  const plan = [
    // Always refresh — user does not edit these
    { rel: ".agent/stack.yaml",              content: T.stackYaml(detection),    force: true },
    { rel: ".agent/checks/pre-generate.sh",  content: T.preGenerateCheck(),      force: true, executable: true },
    { rel: ".agent/checks/post-generate.sh", content: T.postGenerateCheck(detection), force: true, executable: true },
    { rel: ".agent/checks/debug-scope.sh",   content: T.debugScopeCheck(),       force: true, executable: true },
    { rel: ".agent/templates/commit.txt",    content: T.commitTemplate(),        force: true },
    { rel: ".agent/templates/pr.md",         content: T.prTemplate(),            force: true },
    { rel: ".agent/templates/debug-report.md", content: T.debugReportTemplate(), force: true },
  ];

  for (const r of ["generator", "integrator", "tester", "debugger", "documenter"]) {
    plan.push({ rel: `.agent/roles/${r}.yaml`, content: T.roleYaml(r, persona), force: true });
  }

  // Discoverability shims — merge only (never overwrite user content)
  const shim = T.shimContent();
  for (const rel of ["CLAUDE.md", "AGENTS.md", ".cursorrules", ".github/copilot-instructions.md"]) {
    plan.push({ rel, content: shim, mode: "merge-shim", force: false });
  }

  const results = [];
  for (const item of plan) {
    const abs = path.join(cwd, item.rel);
    const mode = item.mode || "create-only";
    const res = writeFile(abs, item.content, { mode, dryRun, force: item.force });

    if (item.executable && res.action !== "skip" && !dryRun) {
      try { fs.chmodSync(abs, 0o755); } catch {}
    }
    results.push({ ...res, rel: item.rel });
  }

  for (const r of results) {
    const symbol = { create: "+", overwrite: "~", merge: "↻", skip: "·" }[r.action] || "?";
    process.stdout.write(`      ${symbol} ${r.rel}\n`);
  }

  const overwritten = results.filter((r) => r.action === "overwrite").length;
  const merged = results.filter((r) => r.action === "merge").length;
  const skipped = results.filter((r) => r.action === "skip").length;
  process.stdout.write(
    `\n      done. overwritten=${overwritten} merged=${merged} skipped=${skipped}\n`
  );
  process.stdout.write(
    "\n      conventions.yaml and manifest.yaml were not touched — edit them directly.\n"
  );

  return 0;
}

module.exports = { update };
