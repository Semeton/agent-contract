"use strict";

const path = require("path");
const fs = require("fs");
const { detectStack } = require("../detect");
const { writeFile } = require("../util/fs");
const T = require("../util/templates");
const { buildCodebaseMap } = require("../util/map");
const { diffRoleScope } = require("../util/scope");
const { installClaudeHooks } = require("../util/hooks");

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
  const force  = !!flags.force;

  process.stdout.write("agent-contract update\n");
  process.stdout.write(`  target: ${cwd}\n`);
  if (dryRun) process.stdout.write("  mode:   dry-run (no files will be written)\n");
  if (force)  process.stdout.write("  mode:   force (roles and templates will be overwritten)\n");
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
    // Always refresh — purely auto-generated, users don't edit these
    { rel: ".agent/stack.yaml",                content: T.stackYaml(detection),           force: true },
    { rel: ".agent/memory/codebase-map.md",    content: buildCodebaseMap(cwd, detection), force: true },
    { rel: ".agent/checks/pre-generate.sh",    content: T.preGenerateCheck(),             force: true, executable: true },
    { rel: ".agent/checks/post-generate.sh",   content: T.postGenerateCheck(detection),   force: true, executable: true },
    { rel: ".agent/checks/debug-scope.sh",     content: T.debugScopeCheck(),              force: true, executable: true },
    { rel: ".agent/checks/security-audit.sh",  content: T.securityAuditCheck(),           force: true, executable: true },
    // Was absent from this plan while present in init's, so `update` silently never
    // refreshed it — a repo initialized once kept its original copy forever, despite
    // the summary line below claiming checks/ is always refreshed.
    { rel: ".agent/checks/review-check.sh",    content: T.reviewCheck(),                  force: true, executable: true },
    { rel: ".agent/checks/write-handoff.sh",   content: T.writeHandoffScript(),           force: true, executable: true },
    { rel: ".agent/checks/scope-lib.sh",       content: T.scopeLibScript(),               force: true, executable: true },
    { rel: ".agent/checks/scope-check.sh",     content: T.scopeCheckScript(),             force: true, executable: true },
    { rel: ".agent/checks/bash-write-guard.sh", content: T.bashWriteGuardScript(),        force: true, executable: true },
    { rel: ".agent/session/.gitignore",        content: "*\n",                            force: false },
    // Docs-only refresh: the marked block is rewritten, the settings below it never are.
    // Never force-overwritten — losing a user's provider/model choice is worse than
    // carrying a stale comment.
    { rel: ".agent/config.yaml",               content: T.configYaml(),  mode: "merge-config", force: false },
    // Preserve by default — overwrite only with --force
    { rel: ".agent/templates/commit.txt",      content: T.commitTemplate(),        force },
    { rel: ".agent/templates/pr.md",           content: T.prTemplate(),            force },
    { rel: ".agent/templates/debug-report.md", content: T.debugReportTemplate(),   force },
    { rel: ".agent/templates/handoff.md",      content: T.handoffTemplate(),       force },
  ];

  // Roles always refresh — they are derived from stack detection, not user-edited
  for (const r of T.ROLES) {
    plan.push({ rel: `.agent/roles/${r}.yaml`, content: T.roleYaml(r, persona, detection), force: true });
  }

  // Discoverability shims — merge only (never overwrite user content)
  const shim = T.shimContent();
  for (const rel of ["CLAUDE.md", "AGENTS.md", ".cursorrules", ".github/copilot-instructions.md"]) {
    plan.push({ rel, content: shim, mode: "merge-shim", force: false });
  }

  // ---- scope-widening guard ----
  // Role YAMLs are generated from lib/util/templates.js, which sits inside the very
  // src/lib globs an integrator-scoped agent may modify. Without this check the
  // sequence "edit the role generator, then run update" quietly hands an agent any
  // scope it cares to write for itself — and the hooks would then enforce the widened
  // contract, faithfully and uselessly. Gaining reach needs explicit human intent;
  // giving it up never does.
  // --force already means "overwrite the contract wholesale", and the Bash guard blocks
  // it in-session for exactly that reason, so it carries the same consent as the
  // narrower flag. Without this, --force could no longer restore a corrupted role file:
  // an unparseable scope reads as empty, so the rewrite looks like a widening.
  const consentRequested = !!(flags.allowScopeChange || flags["allow-scope-change"] || force);

  // Consent has to come from a human, and pattern-matching the command string can never
  // establish that: `F=--force; agent-contract update $F` defeats any regex the Bash
  // guard can carry. So the decision is made here, by the program receiving the flag,
  // rather than by inspecting how it was typed. An agent's Bash tool runs with no
  // controlling terminal; a human shell has one.
  //
  // CI also has no TTY, hence the escape hatch — anyone able to set an env var in a CI
  // config is a human with write access to the repo. The Bash guard matches the literal
  // form of that variable too, so the obvious in-session spelling is still refused.
  const interactive = !!process.stdin.isTTY;
  const ciConsent = process.env.AGENT_CONTRACT_NONINTERACTIVE_CONSENT === "1";
  if (consentRequested && !interactive && !ciConsent) {
    process.stderr.write(
      "\n      refusing consent flags in a non-interactive session.\n" +
      "      --allow-scope-change and --force rewrite the contract, so they need a human.\n" +
      "      Run this from your own terminal, or set AGENT_CONTRACT_NONINTERACTIVE_CONSENT=1\n" +
      "      in a CI config you control.\n\n"
    );
    return 1;
  }

  const allowScopeChange = consentRequested;
  const widenings = [];
  for (const item of plan) {
    if (!/^\.agent\/roles\/.+\.yaml$/.test(item.rel)) continue;
    const abs = path.join(cwd, item.rel);
    if (!fs.existsSync(abs)) continue; // a brand-new role has nothing to widen against
    let existing;
    try {
      existing = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const d = diffRoleScope(existing, item.content);
    if (d.widens) widenings.push({ rel: item.rel, ...d });
  }

  if (widenings.length > 0) {
    process.stderr.write(`\n      ${dryRun ? "would widen" : "WIDENS"} role scope:\n`);
    for (const w of widenings) {
      for (const g of w.added) process.stderr.write(`        + ${w.rel}  writable: ${g}\n`);
      for (const g of w.addedDelete) process.stderr.write(`        + ${w.rel}  deletable: ${g}\n`);
    }
    if (!allowScopeChange) {
      process.stderr.write(
        "\n      refusing to widen a role's scope without explicit consent.\n" +
        "      Review the paths above. If they are what you want, re-run with:\n" +
        "        agent-contract update --allow-scope-change\n" +
        (dryRun ? "      (dry run — nothing would be written either way)\n" : "")
      );
      if (!dryRun) return 1;
    } else {
      process.stderr.write("      --allow-scope-change given; applying.\n");
    }
    process.stderr.write("\n");
  }

  // ---- enforcement-surface guard (self-hosted / vendored only) ----
  // Every check script is regenerated from lib/util/templates.js. When that file lives
  // OUTSIDE the repo (the normal case: agent-contract installed globally, no role scope
  // reaches it) the templates are upstream and trusted, and shipping improved checks via
  // a plain `update` is exactly the self-update flow working.
  //
  // When the tool is self-hosted or vendored, the templates are inside the repo and an
  // agent with src/lib scope can rewrite the guards, then deploy them with a plain
  // `update` — which the Bash guard permits, because plain `update` is routine. That
  // makes the enforcement layer editable in two allowed steps. Here it needs the same
  // consent a scope widening needs.
  const pkgRoot = path.resolve(__dirname, "..", "..");
  const cwdAbs = path.resolve(cwd);
  const selfHosted = pkgRoot === cwdAbs || pkgRoot.startsWith(cwdAbs + path.sep);

  if (selfHosted) {
    const changedChecks = [];
    for (const item of plan) {
      if (!/^\.agent\/checks\/.+\.sh$/.test(item.rel)) continue;
      const abs = path.join(cwd, item.rel);
      if (!fs.existsSync(abs)) continue;
      try {
        if (fs.readFileSync(abs, "utf8") !== item.content) changedChecks.push(item.rel);
      } catch { /* unreadable — the write below will surface it */ }
    }

    if (changedChecks.length > 0) {
      process.stderr.write(
        `\n      ${dryRun ? "would change" : "CHANGES"} enforcement code (tool is self-hosted here):\n`
      );
      for (const rel of changedChecks) process.stderr.write(`        ~ ${rel}\n`);
      if (!allowScopeChange) {
        process.stderr.write(
          "\n      refusing to regenerate guards from templates inside this repo without consent.\n" +
          "      An agent that can edit lib/ could otherwise rewrite its own enforcement.\n" +
          "      Review the diff, then re-run with:\n" +
          "        agent-contract update --allow-scope-change\n" +
          (dryRun ? "      (dry run — nothing would be written either way)\n" : "")
        );
        if (!dryRun) return 1;
      } else {
        process.stderr.write("      --allow-scope-change given; applying.\n");
      }
      process.stderr.write("\n");
    }
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
  // ---- hooks installation (.claude/settings.json) ----
  const hooksResult = installClaudeHooks(cwd, dryRun);
  const hooksSymbol = { create: "+", merge: "↻", skip: "·" }[hooksResult.action] || "?";
  process.stdout.write(`      ${hooksSymbol} .claude/settings.json (Claude Code hooks)\n`);

  process.stdout.write(
    "\n      always refreshed: stack.yaml, memory/codebase-map.md, checks/, roles/\n" +
    "      docs refreshed in place: config.yaml, CLAUDE.md/AGENTS.md shims\n" +
    (force
      ? "      force-overwritten: templates/\n"
      : "      preserved (use --force to overwrite): templates/, conventions.yaml, manifest.yaml\n")
  );

  return 0;
}

module.exports = { update };
