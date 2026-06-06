"use strict";

const path = require("path");
const fs = require("fs");
const { detectStack } = require("../detect");
const { writeFile } = require("../util/fs");
const T = require("../util/templates");
const { learnConventions } = require("../learn");
const { resolvePreset, resolvePersona } = require("../util/prompt");
const { buildCodebaseMap } = require("../util/map");
const { installClaudeHooks } = require("../util/hooks");

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
  const preset = await resolvePreset(flags);
  const persona = await resolvePersona(flags);
  if (preset && preset !== "none") {
    process.stdout.write(`      conventions preset: ${preset}\n`);
  }
  process.stdout.write(`      persona: ${persona}\n`);
  const agentDir = path.join(cwd, ".agent");
  const plan = [];

  // Core contract files (create-only by default; --force overwrites)
  plan.push({ rel: ".agent/manifest.yaml", content: T.manifestYaml(persona), mode: "create-only" });
  plan.push({ rel: ".agent/stack.yaml", content: T.stackYaml(detection), mode: "overwrite-on-detect" });
  plan.push({ rel: ".agent/conventions.yaml", content: T.conventionsYaml(preset, persona), mode: "create-only" });
  plan.push({ rel: ".agent/config.yaml", content: T.configYaml(), mode: "create-only" });
  plan.push({ rel: ".agent/README.md", content: T.readmeForAgentDir(), mode: "create-only" });

  // Roles — always refreshed from detected stack (same as stack.yaml)
  for (const r of T.ROLES) {
    plan.push({ rel: `.agent/roles/${r}.yaml`, content: T.roleYaml(r, persona, detection), mode: "overwrite-on-detect" });
  }

  // Checks (executable)
  plan.push({ rel: ".agent/checks/pre-generate.sh", content: T.preGenerateCheck(), mode: "create-only", executable: true });
  plan.push({ rel: ".agent/checks/post-generate.sh", content: T.postGenerateCheck(detection), mode: "create-only", executable: true });
  plan.push({ rel: ".agent/checks/debug-scope.sh", content: T.debugScopeCheck(), mode: "create-only", executable: true });
  plan.push({ rel: ".agent/checks/security-audit.sh", content: T.securityAuditCheck(), mode: "create-only", executable: true });
  plan.push({ rel: ".agent/checks/review-check.sh", content: T.reviewCheck(), mode: "create-only", executable: true });
  plan.push({ rel: ".agent/checks/write-handoff.sh", content: T.writeHandoffScript(), mode: "create-only", executable: true });
  plan.push({ rel: ".agent/checks/scope-check.sh", content: T.scopeCheckScript(), mode: "create-only", executable: true });

  // Session dir — gitignore keeps active-role.txt and other runtime state out of git
  plan.push({ rel: ".agent/session/.gitignore", content: "*\n", mode: "create-only" });

  // Templates
  plan.push({ rel: ".agent/templates/commit.txt", content: T.commitTemplate(), mode: "create-only" });
  plan.push({ rel: ".agent/templates/pr.md", content: T.prTemplate(), mode: "create-only" });
  plan.push({ rel: ".agent/templates/debug-report.md", content: T.debugReportTemplate(), mode: "create-only" });
  plan.push({ rel: ".agent/templates/handoff.md", content: T.handoffTemplate(), mode: "create-only" });

  // Memory
  plan.push({ rel: ".agent/memory/decisions.jsonl", content: T.decisionsHeader(), mode: "create-only" });
  // Codebase map — always overwritten so it reflects the current state of the repo
  plan.push({ rel: ".agent/memory/codebase-map.md", content: buildCodebaseMap(cwd, detection), mode: "overwrite-on-detect" });

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

  process.stdout.write(
    "\n      next steps:\n" +
    "        1. Edit .agent/conventions.yaml to match your project's standards.\n" +
    "        2. Before editing any source file in this session, declare your role:\n" +
    "             echo \"generator\" > .agent/session/active-role.txt\n" +
    "           Valid roles: generator | integrator | tester | reviewer | debugger | documenter | security\n" +
    "           The scope-check hook will block writes outside your role's declared scope until this is set.\n" +
    "        3. Run `agent-contract status` at any time to inspect the contract state.\n"
  );

  // ---- hooks installation (.claude/settings.json) ----
  const hooksResult = installClaudeHooks(cwd, dryRun);
  const hooksSymbol = { create: "+", merge: "↻", skip: "·" }[hooksResult.action] || "?";
  process.stdout.write(`      ${hooksSymbol} .claude/settings.json (Claude Code hooks)\n`);

  // ---- learn phase (optional, --learn flag) ----
  if (flags.learn) {
    process.stdout.write("\n[learn] analysing conventions in existing code…\n");
    const inferences = await learnConventions(cwd, detection);
    process.stdout.write(`      sampled ${inferences.sample_size} source file(s)\n`);
    if (inferences.style)  process.stdout.write(`      paradigm:     ${inferences.style.paradigm} (${inferences.style.confidence})\n`);
    if (inferences.naming) process.stdout.write(`      file naming:  ${inferences.naming.convention} (${inferences.naming.confidence})\n`);
    if (inferences.tests)  process.stdout.write(`      test pattern: ${inferences.tests.pattern} (${inferences.tests.confidence})\n`);

    const draftContent = T.conventionsDraftYaml(inferences);
    const draftPath = path.join(cwd, ".agent/conventions.draft.yaml");
    fs.writeFileSync(draftPath, draftContent);
    process.stdout.write(`\n      draft saved → .agent/conventions.draft.yaml\n`);

    if (flags.merge) {
      // --merge: apply the draft as the live conventions file.
      const conventionsPath = path.join(cwd, ".agent/conventions.yaml");
      fs.writeFileSync(conventionsPath, draftContent.replace("conventions.draft.yaml", "conventions.yaml"));
      fs.unlinkSync(draftPath);
      process.stdout.write(`      --merge: applied draft → .agent/conventions.yaml (draft removed)\n`);
    } else {
      process.stdout.write(`      review it, then re-run with --learn --merge to apply, or copy manually.\n`);
    }
  }

  return 0;
}

module.exports = { init };
