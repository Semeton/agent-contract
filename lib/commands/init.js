"use strict";

const path = require("path");
const fs = require("fs");
const { detectStack } = require("../detect");
const { writeFile } = require("../util/fs");
const T = require("../util/templates");

async function init({ cwd, flags }) {
  const dryRun = !!flags.dryRun;
  const force = !!flags.force;

  process.stdout.write("agent-contract init\n");
  process.stdout.write(`  target: ${cwd}\n`);
  if (dryRun) process.stdout.write("  mode:   dry-run (no files will be written)\n");
  if (force) process.stdout.write("  mode:   force (existing files will be overwritten)\n");
  process.stdout.write("\n");

  // ---- 1. detect stack ----
  process.stdout.write("[1/4] detecting stack…\n");
  const detection = await detectStack(cwd);
  process.stdout.write(
    `      language=${detection.language} framework=${detection.framework ?? "—"} confidence=${detection.confidence}\n`
  );
  if (detection.unresolved.length) {
    process.stdout.write(`      unresolved: ${detection.unresolved.join(", ")}\n`);
  }
  process.stdout.write("\n");

  // ---- 2. build write plan ----
  process.stdout.write("[2/4] building write plan…\n");
  const agentDir = path.join(cwd, ".agent");
  const plan = [];

  // Core contract files (create-only by default; --force overwrites)
  plan.push({ rel: ".agent/manifest.yaml", content: T.manifestYaml(), mode: "create-only" });
  plan.push({ rel: ".agent/stack.yaml", content: T.stackYaml(detection), mode: "overwrite-on-detect" });
  plan.push({ rel: ".agent/conventions.yaml", content: T.conventionsYaml(), mode: "create-only" });
  plan.push({ rel: ".agent/README.md", content: T.readmeForAgentDir(), mode: "create-only" });

  // Roles
  for (const r of ["generator", "integrator", "tester", "debugger", "documenter"]) {
    plan.push({ rel: `.agent/roles/${r}.yaml`, content: T.roleYaml(r), mode: "create-only" });
  }

  // Checks (executable)
  plan.push({ rel: ".agent/checks/pre-generate.sh", content: T.preGenerateCheck(), mode: "create-only", executable: true });
  plan.push({ rel: ".agent/checks/post-generate.sh", content: T.postGenerateCheck(), mode: "create-only", executable: true });
  plan.push({ rel: ".agent/checks/debug-scope.sh", content: T.debugScopeCheck(), mode: "create-only", executable: true });

  // Templates
  plan.push({ rel: ".agent/templates/commit.txt", content: T.commitTemplate(), mode: "create-only" });
  plan.push({ rel: ".agent/templates/pr.md", content: T.prTemplate(), mode: "create-only" });
  plan.push({ rel: ".agent/templates/debug-report.md", content: T.debugReportTemplate(), mode: "create-only" });

  // Memory
  plan.push({ rel: ".agent/memory/decisions.jsonl", content: T.decisionsHeader(), mode: "create-only" });

  // Discoverability shims at repo root
  const shim = T.shimContent();
  plan.push({ rel: "CLAUDE.md", content: shim, mode: "merge-shim" });
  plan.push({ rel: "AGENTS.md", content: shim, mode: "merge-shim" });
  plan.push({ rel: ".cursorrules", content: shim, mode: "merge-shim" });
  plan.push({ rel: ".github/copilot-instructions.md", content: shim, mode: "merge-shim" });

  process.stdout.write(`      ${plan.length} files planned\n\n`);

  // ---- 3. execute plan ----
  process.stdout.write("[3/4] writing files…\n");
  const results = [];
  for (const item of plan) {
    const abs = path.join(cwd, item.rel);
    // stack.yaml has special semantics: always refresh on detect unless --no-refresh-stack flag set
    const itemMode =
      item.mode === "overwrite-on-detect"
        ? "create-only"
        : item.mode;
    const itemForce = item.mode === "overwrite-on-detect" ? true : force;

    const res = writeFile(abs, item.content, {
      mode: itemMode,
      dryRun,
      force: itemForce,
    });

    if (item.executable && res.action !== "skip" && !dryRun) {
      try {
        fs.chmodSync(abs, 0o755);
      } catch {
        // best-effort on platforms that don't support it
      }
    }
    results.push({ ...res, rel: item.rel });
  }

  for (const r of results) {
    const symbol = { create: "+", overwrite: "~", merge: "↻", skip: "·" }[r.action] || "?";
    process.stdout.write(`      ${symbol} ${r.rel}\n`);
  }
  process.stdout.write("\n");

  // ---- 4. summary ----
  process.stdout.write("[4/4] done.\n");
  const created = results.filter((r) => r.action === "create").length;
  const skipped = results.filter((r) => r.action === "skip").length;
  const merged = results.filter((r) => r.action === "merge").length;
  const overwritten = results.filter((r) => r.action === "overwrite").length;
  process.stdout.write(
    `      created=${created} merged=${merged} overwritten=${overwritten} skipped=${skipped}\n`
  );

  if (detection.unresolved.length) {
    process.stdout.write("\n");
    process.stdout.write(
      "      ⚠  some stack fields were unresolved. Open .agent/stack.yaml and fill them in.\n"
    );
  }

  process.stdout.write("\n      next: review .agent/conventions.yaml and edit to taste.\n");

  return 0;
}

module.exports = { init };
