#!/usr/bin/env node
"use strict";

/**
 * Smoke test. Runs end-to-end against synthetic fixtures.
 * Gates `npm publish` via `prepublishOnly`.
 *
 * Fails loudly on any assertion break. No test framework dependency.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const { detectStack } = require("../lib/detect");
const { init } = require("../lib/commands/init");
const { run } = require("../lib/commands/run");
const { update } = require("../lib/commands/update");
const { status } = require("../lib/commands/status");
const { learnConventions } = require("../lib/learn");
const { buildCodebaseMap, isGreenfield } = require("../lib/util/map");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "agent-contract-test-"));

// update() gates --force / --allow-scope-change on a controlling terminal. The suite has
// none, so it takes the documented CI escape hatch. Individual tests unset this to prove
// the gate still bites.
process.env.AGENT_CONTRACT_NONINTERACTIVE_CONSENT = "1";
// PreToolUse blocks ONLY on exit 2. Every other non-zero code is a non-blocking hook
// error and the tool call proceeds, so a guard exiting 1 refuses in words and permits
// in fact. These assertions are what pins that down.
const BLOCK = 2;

let failures = 0;
let passes = 0;

function assert(label, cond, detail) {
  if (cond) {
    passes++;
    process.stdout.write(`  ✓ ${label}\n`);
  } else {
    failures++;
    process.stdout.write(`  ✗ ${label}\n`);
    if (detail !== undefined) {
      process.stdout.write(`      got: ${JSON.stringify(detail)}\n`);
    }
  }
}

function fixture(name, files) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

async function suiteDetection() {
  process.stdout.write("\n[detection]\n");

  // ---- NestJS ----
  const nest = fixture("nestjs", {
    "package.json": JSON.stringify({
      name: "x",
      dependencies: { "@nestjs/core": "^10", typeorm: "^0.3", pg: "^8" },
      devDependencies: { typescript: "^5", jest: "^29", eslint: "^8", prettier: "^3" },
      engines: { node: ">=20" },
    }),
    "tsconfig.json": "{}",
    "pnpm-lock.yaml": "lockfile",
    "src/main.ts": "// entry",
  });
  let r = await detectStack(nest);
  assert("nestjs: language is typescript", r.language === "typescript", r.language);
  assert("nestjs: framework is nestjs", String(r.framework).startsWith("nestjs"), r.framework);
  assert("nestjs: package_manager is pnpm", r.package_manager === "pnpm", r.package_manager);
  assert("nestjs: orm is typeorm", r.orm === "typeorm", r.orm);
  assert("nestjs: db is postgresql", r.db === "postgresql", r.db);
  assert("nestjs: confidence is high", r.confidence === "high", r.confidence);

  // ---- Laravel ----
  const laravel = fixture("laravel", {
    "composer.json": JSON.stringify({
      require: { php: "^8.2", "laravel/framework": "^11.0" },
      "require-dev": { "phpunit/phpunit": "^11.0" },
    }),
    "composer.lock": "lock",
    ".env.example": "DB_CONNECTION=mysql\n",
    "artisan": "#!/usr/bin/env php\n",
  });
  r = await detectStack(laravel);
  assert("laravel: language is php", r.language === "php", r.language);
  assert("laravel: framework is laravel", String(r.framework).startsWith("laravel"), r.framework);
  assert("laravel: db is mysql (from .env.example)", r.db === "mysql", r.db);
  assert("laravel: orm is eloquent (inferred)", r.orm === "eloquent", r.orm);

  // ---- empty dir ----
  const empty = fixture("empty", { "notes.txt": "hi" });
  r = await detectStack(empty);
  assert("empty: language is unknown", r.language === "unknown", r.language);
  assert("empty: confidence is low", r.confidence === "low", r.confidence);

  // ---- Elixir/Phoenix ----
  const elixir = fixture("elixir", {
    "mix.exs": [
      "defmodule MyApp.MixProject do",
      "  use Mix.Project",
      "  def deps do",
      "    [",
      '      {:phoenix, "~> 1.7"},',
      '      {:ecto_sql, "~> 3.10"},',
      '      {:postgrex, ">= 0.0.0"},',
      '      {:credo, "~> 1.7", only: [:dev, :test]}',
      "    ]",
      "  end",
      "end",
    ].join("\n"),
  });
  r = await detectStack(elixir);
  assert("elixir: language is elixir", r.language === "elixir", r.language);
  assert("elixir: framework is phoenix", String(r.framework).startsWith("phoenix"), r.framework);
  assert("elixir: orm is ecto", r.orm === "ecto", r.orm);
  assert("elixir: db is postgresql", r.db === "postgresql", r.db);
  assert("elixir: lint is credo", r.lint === "credo", r.lint);

  // ---- Scala/Akka ----
  const scala = fixture("scala", {
    "build.sbt": [
      'name := "myapp"',
      'scalaVersion := "3.3.0"',
      "libraryDependencies ++= Seq(",
      '  "com.typesafe.akka" %% "akka-actor-typed" % "2.8.0",',
      '  "org.scalatest" %% "scalatest" % "3.2.15" % Test)',
    ].join("\n"),
  });
  r = await detectStack(scala);
  assert("scala: language is scala", r.language === "scala", r.language);
  assert("scala: framework is akka", String(r.framework).startsWith("akka"), r.framework);
  assert("scala: test_runner is scalatest", r.test_runner === "scalatest", r.test_runner);

  // ---- Clojure/Compojure ----
  const clojure = fixture("clojure", {
    "project.clj": [
      '(defproject my-app "0.1.0"',
      "  :dependencies [[org.clojure/clojure \"1.11.0\"]",
      "                 [ring/ring-core \"1.10.0\"]",
      "                 [compojure \"1.7.0\"]])",
    ].join("\n"),
  });
  r = await detectStack(clojure);
  assert("clojure: language is clojure", r.language === "clojure", r.language);
  assert("clojure: framework is compojure", String(r.framework).startsWith("compojure"), r.framework);

  // ---- Swift/Vapor ----
  const swift = fixture("swift", {
    "Package.swift": [
      "// swift-tools-version: 5.9",
      "import PackageDescription",
      "let package = Package(",
      '    name: "MyApp",',
      "    dependencies: [",
      '        .package(url: "https://github.com/vapor/vapor.git", from: "4.0.0"),',
      "    ],",
      "    targets: [",
      '        .target(name: "App", dependencies: [',
      '            .product(name: "Vapor", package: "vapor"),',
      "        ]),",
      "    ]",
      ")",
    ].join("\n"),
  });
  r = await detectStack(swift);
  assert("swift: language is swift", r.language === "swift", r.language);
  assert("swift: framework is vapor", String(r.framework).startsWith("vapor"), r.framework);

  // ---- Dart/Flutter ----
  const dart = fixture("dart", {
    "pubspec.yaml": [
      "name: my_app",
      "environment:",
      '  sdk: ">=3.0.0 <4.0.0"',
      "dependencies:",
      "  flutter:",
      "    sdk: flutter",
      "  dio: ^5.0.0",
      "dev_dependencies:",
      "  flutter_test:",
      "    sdk: flutter",
    ].join("\n"),
  });
  r = await detectStack(dart);
  assert("dart: language is dart", r.language === "dart", r.language);
  assert("dart: framework is flutter", String(r.framework).startsWith("flutter"), r.framework);
  assert("dart: package_manager is pub", r.package_manager === "pub", r.package_manager);

  // ---- Deno ----
  const deno = fixture("deno", {
    "deno.json": JSON.stringify({
      imports: { "@std/": "jsr:@std/" },
      tasks: { dev: "deno run --watch main.ts" },
    }),
    "main.ts": "// Deno app",
  });
  r = await detectStack(deno);
  assert("deno: language is typescript", r.language === "typescript", r.language);
  assert("deno: package_manager is deno", r.package_manager === "deno", r.package_manager);
  assert("deno: lint is deno-lint", r.lint === "deno-lint", r.lint);
  assert("deno: test_runner is deno-test", r.test_runner === "deno-test", r.test_runner);
}

async function suiteInit() {
  process.stdout.write("\n[init]\n");

  const target = fixture("init-target", {
    "package.json": JSON.stringify({
      name: "t",
      dependencies: { "@nestjs/core": "^10" },
    }),
  });

  // first init
  const stdout = captureStdout(async () => {
    await init({ cwd: target, flags: {} });
  });
  await stdout;

  const expected = [
    ".agent/manifest.yaml",
    ".agent/stack.yaml",
    ".agent/conventions.yaml",
    ".agent/config.yaml",
    ".agent/roles/generator.yaml",
    ".agent/roles/debugger.yaml",
    ".agent/checks/pre-generate.sh",
    ".agent/checks/post-generate.sh",
    ".agent/checks/debug-scope.sh",
    ".agent/memory/codebase-map.md",
    ".agent/templates/handoff.md",
    "CLAUDE.md",
    "AGENTS.md",
    ".cursorrules",
    ".github/copilot-instructions.md",
  ];
  for (const rel of expected) {
    const abs = path.join(target, rel);
    assert(`init creates ${rel}`, fs.existsSync(abs));
  }

  // codebase-map content: should contain the marker and boot protocol reference
  const codemapContent = fs.readFileSync(path.join(target, ".agent/memory/codebase-map.md"), "utf8");
  assert("init: codebase-map.md has opening marker", codemapContent.includes("<!-- agent-contract:codebase-map -->"));
  assert("init: codebase-map.md has closing marker", codemapContent.includes("<!-- /agent-contract:codebase-map -->"));

  // The shim states the mechanically-enforced rules and nothing else. It is always-on
  // context in every session of every target repo, so regrowth is a cost regression —
  // the budget assertion below is the guard against that.
  const claudeMd = fs.readFileSync(path.join(target, "CLAUDE.md"), "utf8");
  assert("init: CLAUDE.md shim states the role gate", claudeMd.includes("Declare a role before writing source"));
  assert("init: CLAUDE.md shim states contract files are off-limits", claudeMd.includes("off-limits in-session"));
  assert("init: CLAUDE.md shim states scope enforcement", claudeMd.includes("Stay in your role's scope"));
  assert("init: CLAUDE.md shim does NOT mandate a boot sequence", !claudeMd.includes("Boot Sequence"));
  assert("init: CLAUDE.md shim does NOT mandate a reading order", !claudeMd.includes("Do NOT read raw source files"));
  const shimBody = require("../lib/util/templates").shimContent();
  const shimTokens = Math.ceil(shimBody.length / 4);
  assert("init: shim stays within its 450-token budget", shimTokens <= 450, shimTokens);

  // new hook scripts
  for (const rel of [
    ".agent/checks/write-handoff.sh",
    ".agent/checks/scope-lib.sh",
    ".agent/checks/scope-check.sh",
    ".agent/checks/bash-write-guard.sh",
  ]) {
    assert(`init creates ${rel}`, fs.existsSync(path.join(target, rel)));
  }

  // checks must be executable
  for (const rel of [
    ".agent/checks/pre-generate.sh",
    ".agent/checks/post-generate.sh",
    ".agent/checks/debug-scope.sh",
    ".agent/checks/write-handoff.sh",
    ".agent/checks/scope-lib.sh",
    ".agent/checks/scope-check.sh",
    ".agent/checks/bash-write-guard.sh",
  ]) {
    const mode = fs.statSync(path.join(target, rel)).mode & 0o111;
    assert(`${rel} is executable`, mode !== 0, mode);
  }

  // .claude/settings.json is created with PreToolUse and Stop hooks
  const settingsPath = path.join(target, ".claude/settings.json");
  assert("init creates .claude/settings.json", fs.existsSync(settingsPath));
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert("init: settings.json has PreToolUse hook", Array.isArray(settings.hooks && settings.hooks.PreToolUse));
  assert("init: settings.json has Stop hook", Array.isArray(settings.hooks && settings.hooks.Stop));
  assert(
    "init: PreToolUse hook references scope-check.sh",
    (settings.hooks.PreToolUse || []).some((e) => e.hooks && e.hooks.some((h) => h.command && h.command.includes("scope-check.sh")))
  );
  assert(
    "init: PreToolUse hook references bash-write-guard.sh on Bash matcher",
    (settings.hooks.PreToolUse || []).some((e) => e.matcher === "Bash" && e.hooks && e.hooks.some((h) => h.command && h.command.includes("bash-write-guard.sh")))
  );
  assert(
    "init: Stop hook references write-handoff.sh",
    (settings.hooks.Stop || []).some((e) => e.hooks && e.hooks.some((h) => h.command && h.command.includes("write-handoff.sh")))
  );

  // re-run is idempotent — manifest content unchanged
  const manifestBefore = fs.readFileSync(path.join(target, ".agent/manifest.yaml"), "utf8");
  await captureStdout(async () => init({ cwd: target, flags: {} }));
  const manifestAfter = fs.readFileSync(path.join(target, ".agent/manifest.yaml"), "utf8");
  assert("idempotent: manifest.yaml unchanged on re-run", manifestBefore === manifestAfter);

  // shim merge preserves user content
  const target2 = fixture("init-target-merge", {
    "package.json": JSON.stringify({ name: "t" }),
    "CLAUDE.md": "# my notes\nimportant stuff\n",
  });
  await captureStdout(async () => init({ cwd: target2, flags: {} }));
  const merged = fs.readFileSync(path.join(target2, "CLAUDE.md"), "utf8");
  assert("shim merge: preserves user content", merged.includes("my notes\nimportant stuff"));
  assert("shim merge: appends contract shim", merged.includes("<!-- agent-contract:shim -->"));

  // re-run after merge does not duplicate
  await captureStdout(async () => init({ cwd: target2, flags: {} }));
  const merged2 = fs.readFileSync(path.join(target2, "CLAUDE.md"), "utf8");
  const shimCount = (merged2.match(/<!-- agent-contract:shim -->/g) || []).length;
  assert("shim merge: idempotent (one shim block)", shimCount === 1, shimCount);

  // An existing shim block must be REFRESHED in place, not skipped. Skipping would
  // freeze every already-initialized repo at whatever shim version first wrote it,
  // making `agent-contract update` unable to ship a shim change.
  const target3 = fixture("init-target-refresh", {
    "package.json": JSON.stringify({ name: "t" }),
    "CLAUDE.md":
      "# my notes\nkeep this head\n\n<!-- agent-contract:shim -->\n# Agent Contract\n\n" +
      "## Boot Sequence\n1. stale instruction from an older version\n" +
      "<!-- /agent-contract:shim -->\n\n## my tail section\nkeep this tail\n",
  });
  await captureStdout(async () => init({ cwd: target3, flags: {} }));
  const refreshed = fs.readFileSync(path.join(target3, "CLAUDE.md"), "utf8");
  assert("shim refresh: stale shim body is replaced", !refreshed.includes("stale instruction from an older version"));
  assert("shim refresh: stale boot sequence is gone", !refreshed.includes("Boot Sequence"));
  assert("shim refresh: current shim body is present", refreshed.includes("Declare a role before writing source"));
  assert("shim refresh: user content above the shim survives", refreshed.startsWith("# my notes\nkeep this head\n\n"));
  assert("shim refresh: user content below the shim survives", refreshed.includes("## my tail section\nkeep this tail\n"));
  assert(
    "shim refresh: still exactly one shim block",
    (refreshed.match(/<!-- agent-contract:shim -->/g) || []).length === 1,
    (refreshed.match(/<!-- agent-contract:shim -->/g) || []).length
  );

  // A second refresh must be a true no-op, byte for byte.
  await captureStdout(async () => init({ cwd: target3, flags: {} }));
  assert(
    "shim refresh: second run is byte-identical",
    fs.readFileSync(path.join(target3, "CLAUDE.md"), "utf8") === refreshed
  );

  // Half a marker pair means the block's boundaries are unknowable — leave it alone.
  const target4 = fixture("init-target-halfmarker", {
    "package.json": JSON.stringify({ name: "t" }),
    "CLAUDE.md": "# notes\n<!-- agent-contract:shim -->\nno closing marker here\n",
  });
  const halfBefore = fs.readFileSync(path.join(target4, "CLAUDE.md"), "utf8");
  await captureStdout(async () => init({ cwd: target4, flags: {} }));
  assert(
    "shim refresh: half-marker file is left untouched",
    fs.readFileSync(path.join(target4, "CLAUDE.md"), "utf8") === halfBefore
  );
}

async function suiteChecks() {
  process.stdout.write("\n[checks]\n");

  const target = fixture("check-target", {
    "package.json": JSON.stringify({ name: "t" }),
  });
  await captureStdout(async () => init({ cwd: target, flags: {} }));

  // pre-generate: should fail on missing fields
  const incompleteSpec = path.join(target, "spec-bad.json");
  fs.writeFileSync(incompleteSpec, JSON.stringify({ feature_name: "x" }));
  let exitCode = runScript(path.join(target, ".agent/checks/pre-generate.sh"), [incompleteSpec]);
  assert("pre-generate hard-fails on missing fields", exitCode === 1, exitCode);
  // A failing spec must not arm a role: persisting it first let scope-check permit the
  // role's writes even though the spec gate had refused.
  const declaredRole = path.join(target, ".agent/session/active-role.txt");
  assert("pre-generate: failing spec persists no role", !fs.existsSync(declaredRole), null);

  // pre-generate: should pass with all fields
  const completeSpec = path.join(target, "spec-good.json");
  fs.writeFileSync(
    completeSpec,
    JSON.stringify({
      feature_name: "x",
      input_shape: "y",
      output_shape: "z",
      error_cases: ["a"],
    })
  );
  exitCode = runScript(path.join(target, ".agent/checks/pre-generate.sh"), [completeSpec]);
  assert("pre-generate passes with all fields", exitCode === 0, exitCode);
  assert("pre-generate: passing spec persists the role",
    fs.readFileSync(declaredRole, "utf8").trim() === "generator", null);
  exitCode = runScript(path.join(target, ".agent/checks/pre-generate.sh"), [incompleteSpec, "tester"]);
  assert("pre-generate: failing spec leaves the declared role as it was",
    exitCode === 1 && fs.readFileSync(declaredRole, "utf8").trim() === "generator", exitCode);

  // post-generate.sh should contain stack-specific commands for a TypeScript + eslint + jest project
  const tsTarget = fixture("check-ts-target", {
    "package.json": JSON.stringify({
      name: "t",
      dependencies: { "@nestjs/core": "^10" },
      devDependencies: { typescript: "^5", eslint: "^8", jest: "^29" },
    }),
    "tsconfig.json": "{}",
  });
  await captureStdout(async () => init({ cwd: tsTarget, flags: {} }));
  const postGen = fs.readFileSync(path.join(tsTarget, ".agent/checks/post-generate.sh"), "utf8");
  assert("post-generate: contains eslint for ts project", postGen.includes("eslint"), postGen.slice(0, 100));
  assert("post-generate: contains tsc for ts project", postGen.includes("tsc --noEmit"), postGen.slice(0, 100));
  assert("post-generate: contains jest for ts project", postGen.includes("jest"), postGen.slice(0, 100));

  // post-generate.sh for a stack-agnostic project (no lint/test deps) should stay lean
  const genericTarget = fixture("check-generic-target", {
    "package.json": JSON.stringify({ name: "t" }),
  });
  await captureStdout(async () => init({ cwd: genericTarget, flags: {} }));
  const genericPost = fs.readFileSync(path.join(genericTarget, ".agent/checks/post-generate.sh"), "utf8");
  assert("post-generate: no lint section when none detected", !genericPost.includes("# Lint"), genericPost);
}

async function suitePresets() {
  process.stdout.write("\n[presets]\n");

  const mkTarget = (name, extra = {}) =>
    fixture(name, {
      "package.json": JSON.stringify({ name: "t" }),
      ...extra,
    });

  // oop-strict
  const oopTarget = mkTarget("preset-oop");
  await captureStdout(async () => init({ cwd: oopTarget, flags: { preset: "oop-strict" } }));
  const oopConv = fs.readFileSync(path.join(oopTarget, ".agent/conventions.yaml"), "utf8");
  assert("preset: oop-strict sets paradigm oop", oopConv.includes("paradigm: oop"), oopConv.slice(0, 80));

  // functional-pragmatic
  const funcTarget = mkTarget("preset-func");
  await captureStdout(async () => init({ cwd: funcTarget, flags: { preset: "functional-pragmatic" } }));
  const funcConv = fs.readFileSync(path.join(funcTarget, ".agent/conventions.yaml"), "utf8");
  assert("preset: functional-pragmatic sets paradigm functional", funcConv.includes("paradigm: functional"), funcConv.slice(0, 80));

  // nestjs-clean-architecture
  const nestTarget = mkTarget("preset-nestjs");
  await captureStdout(async () => init({ cwd: nestTarget, flags: { preset: "nestjs-clean-architecture" } }));
  const nestConv = fs.readFileSync(path.join(nestTarget, ".agent/conventions.yaml"), "utf8");
  assert("preset: nestjs-clean-architecture contains nestjs marker", nestConv.includes("nestjs"), nestConv.slice(0, 80));

  // laravel-service-pattern
  const laravelTarget = mkTarget("preset-laravel");
  await captureStdout(async () => init({ cwd: laravelTarget, flags: { preset: "laravel-service-pattern" } }));
  const laravelConv = fs.readFileSync(path.join(laravelTarget, ".agent/conventions.yaml"), "utf8");
  assert("preset: laravel-service-pattern contains laravel marker", laravelConv.includes("laravel"), laravelConv.slice(0, 80));

  // none / unknown preset → blank default
  const noneTarget = mkTarget("preset-none");
  await captureStdout(async () => init({ cwd: noneTarget, flags: { preset: "none" } }));
  const noneConv = fs.readFileSync(path.join(noneTarget, ".agent/conventions.yaml"), "utf8");
  assert("preset: none produces blank conventions.yaml", noneConv.includes("paradigm: oop"), noneConv.slice(0, 80));
}

async function suiteLearn() {
  process.stdout.write("\n[learn]\n");

  const target = fixture("learn-target", {
    "package.json": JSON.stringify({
      name: "t",
      devDependencies: { typescript: "^5", jest: "^29" },
    }),
    "tsconfig.json": "{}",
    "src/user-service.ts": [
      "export class UserService {",
      "  async find(id: string) {",
      "    try { return await this.repo.find(id); }",
      "    catch (err) { throw new UserNotFoundError(id); }",
      "  }",
      "}",
      "class UserNotFoundError extends Error {}",
    ].join("\n"),
    "src/user-service.spec.ts": "describe('UserService', () => { it('works', () => {}); });",
    "src/auth-service.ts": [
      "export class AuthService {",
      "  login(email: string) {",
      "    try { return this.validate(email); }",
      "    catch (e) { throw new AuthError('invalid'); }",
      "  }",
      "}",
      "class AuthError extends Error {}",
    ].join("\n"),
  });

  await captureStdout(async () => init({ cwd: target, flags: {} }));
  await captureStdout(async () => init({ cwd: target, flags: { learn: true } }));

  const draftPath = path.join(target, ".agent/conventions.draft.yaml");
  assert("learn: creates conventions.draft.yaml", fs.existsSync(draftPath));

  const draft = fs.readFileSync(draftPath, "utf8");
  assert("learn: draft contains DRAFT marker", draft.includes("DRAFT"));
  assert("learn: draft contains paradigm field", draft.includes("paradigm:"));
  assert("learn: draft infers oop from class-heavy fixture", draft.includes("paradigm: oop"));
  assert("learn: draft infers colocated_spec test pattern", draft.includes("colocated_spec"));

  // learnConventions is also usable as a programmatic API
  const inferences = await learnConventions(target, { language: "typescript" });
  assert("learn: sample_size > 0", inferences.sample_size > 0, inferences.sample_size);
  assert("learn: style is detected", inferences.style !== null);
  assert("learn: tests pattern is detected", inferences.tests !== null);
}

async function suiteRun() {
  process.stdout.write("\n[run]\n");

  const target = fixture("run-target", {
    "package.json": JSON.stringify({ name: "t", dependencies: { "@nestjs/core": "^10" } }),
  });
  await captureStdout(async () => init({ cwd: target, flags: {} }));

  // echo provider should succeed and append a decisions entry
  const exitCode = await captureAll(() =>
    run({ cwd: target, flags: { role: "generator", task: "add hello endpoint", provider: "echo" } })
  );
  assert("run: echo provider exits 0", exitCode === 0, exitCode);

  const decisionsRaw = fs.readFileSync(path.join(target, ".agent/memory/decisions.jsonl"), "utf8").trim();
  const lastLine = decisionsRaw.split("\n").filter((l) => l.trim()).pop();
  const entry = JSON.parse(lastLine);
  assert("run: appends to decisions.jsonl", entry.role === "generator", entry);

  // Completion handoff should be written after every successful run
  const memDir = path.join(target, ".agent/memory");
  const handoffFiles = fs.readdirSync(memDir).filter((f) => f.startsWith("handoff-done-") && f.endsWith(".md"));
  assert("run: completion handoff written after success", handoffFiles.length > 0, handoffFiles);

  // missing role must hard-fail
  const failCode = await captureAll(() =>
    run({ cwd: target, flags: { role: "nonexistent", task: "test", provider: "echo" } })
  );
  assert("run: missing role hard-fails", failCode === 1, failCode);

  // no manifest must hard-fail
  const emptyDir = fixture("run-no-manifest", { "notes.txt": "hi" });
  const noManifestCode = await captureAll(() =>
    run({ cwd: emptyDir, flags: { role: "generator", task: "test", provider: "echo" } })
  );
  assert("run: missing manifest hard-fails", noManifestCode === 1, noManifestCode);
}

async function suiteTokens() {
  process.stdout.write("\n[tokens]\n");

  const { estimateTokens, checkUsage, limitForModel, WARN_THRESHOLD, HANDOFF_THRESHOLD } = require("../lib/util/tokens");
  const T = require("../lib/util/templates");

  // estimateTokens: 4 chars per token
  assert("tokens: estimateTokens 400 chars → 100 tokens", estimateTokens("x".repeat(400)) === 100, null);
  assert("tokens: estimateTokens empty string → 0", estimateTokens("") === 0, null);

  // limitForModel: known model returns expected limit
  assert("tokens: limitForModel claude-opus-5 → 1M", limitForModel("claude-opus-5") === 1000000, null);
  assert("tokens: limitForModel claude-opus-4-7 → 1M", limitForModel("claude-opus-4-7") === 1000000, null);
  assert("tokens: limitForModel claude-sonnet-5 → 1M", limitForModel("claude-sonnet-5") === 1000000, null);
  assert("tokens: limitForModel claude-fable-5 → 1M", limitForModel("claude-fable-5") === 1000000, null);
  // Prefix matching must not let a 1M key swallow a 200K model listed after it.
  assert("tokens: limitForModel claude-opus-4-5 → 200K (not shadowed by opus-5)", limitForModel("claude-opus-4-5") === 200000, limitForModel("claude-opus-4-5"));
  assert("tokens: limitForModel claude-haiku-4-5 → 200K", limitForModel("claude-haiku-4-5") === 200000, null);
  assert("tokens: limitForModel dated suffix resolves by prefix", limitForModel("claude-opus-4-6-20260101") === 1000000, null);
  assert("tokens: limitForModel gpt-4o → 128000", limitForModel("gpt-4o") === 128000, null);
  assert("tokens: limitForModel unknown falls back to default", limitForModel("unknown-model-xyz") === 100000, null);

  // checkUsage: calculates pct correctly
  const info = checkUsage({ input_tokens: 140000, output_tokens: 30000 }, "claude-opus-4-7");
  assert("tokens: checkUsage total = input + output", info.total === 170000, info.total);
  assert("tokens: checkUsage pct = 17% for 170k/1M", info.pct === 17, info.pct);
  // 170k used to read as 85% of a 200K window and tripped the handoff threshold.
  // Against the real 1M window it must not.
  assert("tokens: 170k does NOT trip handoff on a 1M model", info.ratio < HANDOFF_THRESHOLD, info.ratio);
  const small = checkUsage({ input_tokens: 140000, output_tokens: 30000 }, "claude-haiku-4-5");
  assert("tokens: 170k DOES trip handoff on a 200K model", small.ratio >= HANDOFF_THRESHOLD, small.ratio);

  // WARN and HANDOFF thresholds are defined
  assert("tokens: WARN_THRESHOLD is 0.70", WARN_THRESHOLD === 0.70, WARN_THRESHOLD);
  assert("tokens: HANDOFF_THRESHOLD is 0.85", HANDOFF_THRESHOLD === 0.85, HANDOFF_THRESHOLD);

  // handoffNote template contains expected content
  const note = T.handoffNote({
    role: "generator",
    task: "add auth middleware",
    provider: "anthropic",
    model: "claude-opus-4-7",
    usage: { total: 170000, limit: 200000, pct: 85 },
    recentDecisions: [
      { ts: "2026-05-16T10:00:00.000Z", role: "generator", task: "scaffold user module", output_lines: 42 },
    ],
  });
  assert("tokens: handoffNote contains title", note.includes("# Agent Handoff"), note.slice(0, 80));
  assert("tokens: handoffNote contains role", note.includes("generator"), note.slice(0, 200));
  assert("tokens: handoffNote contains task", note.includes("add auth middleware"), note.slice(0, 300));
  assert("tokens: handoffNote contains pct", note.includes("85%"), note.slice(0, 400));
  assert("tokens: handoffNote contains fresh session prompt", note.includes("fresh session"), note.slice(0, 600));
  assert("tokens: handoffNote contains prior decision", note.includes("scaffold user module"), note);

  // decisions.jsonl entry includes tokens field after a run
  const target = fixture("tokens-run-target", {
    "package.json": JSON.stringify({ name: "t" }),
  });
  await captureStdout(async () => init({ cwd: target, flags: {} }));
  await captureAll(() =>
    run({ cwd: target, flags: { role: "generator", task: "test task", provider: "echo" } })
  );
  const lastEntry = JSON.parse(
    fs.readFileSync(path.join(target, ".agent/memory/decisions.jsonl"), "utf8")
      .trim().split("\n").filter(Boolean).pop()
  );
  assert("tokens: decisions.jsonl entry includes tokens.used", typeof lastEntry.tokens?.used === "number", lastEntry);
  assert("tokens: decisions.jsonl entry includes tokens.pct", typeof lastEntry.tokens?.pct === "number", lastEntry);

  // handoff file is created when usage exceeds HANDOFF_THRESHOLD
  // Simulate by calling handoffNote and writing manually (avoids mocking MODEL_LIMITS)
  const handoffTarget = fixture("tokens-handoff-target", { "package.json": JSON.stringify({ name: "t" }) });
  await captureStdout(async () => init({ cwd: handoffTarget, flags: {} }));
  const handoffDir = path.join(handoffTarget, ".agent/memory");
  const handoffContent = T.handoffNote({
    role: "generator", task: "big task", provider: "echo", model: "echo",
    usage: { total: 90000, limit: 100000, pct: 90 }, recentDecisions: [],
  });
  const handoffFile = path.join(handoffDir, `handoff-test.md`);
  fs.writeFileSync(handoffFile, handoffContent);
  const written = fs.readFileSync(handoffFile, "utf8");
  assert("tokens: handoff file is valid markdown", written.startsWith("# Agent Handoff"), written.slice(0, 60));
}

function captureStdout(fn) {
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  return Promise.resolve(fn()).finally(() => {
    process.stdout.write = origWrite;
  });
}

function captureAll(fn) {
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  return Promise.resolve(fn()).finally(() => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  });
}

function runScript(scriptPath, args) {
  try {
    execSync(`bash ${scriptPath} ${args.map((a) => `'${a}'`).join(" ")}`, {
      stdio: "pipe",
    });
    return 0;
  } catch (e) {
    return e.status || 1;
  }
}

function runScriptWithInput(scriptPath, args, input) {
  try {
    execSync(`bash ${scriptPath} ${args.map((a) => `'${a}'`).join(" ")}`, {
      stdio: "pipe",
      input,
    });
    return 0;
  } catch (e) {
    return e.status || 1;
  }
}

async function suiteUpdate() {
  process.stdout.write("\n[update]\n");

  const target = fixture("update-target", {
    "package.json": JSON.stringify({ name: "t", devDependencies: { jest: "^29" } }),
    "tsconfig.json": "{}",
  });

  // init first with architect persona
  await captureStdout(async () => init({ cwd: target, flags: { persona: "architect" } }));

  // Put a user edit marker in roles and conventions to verify preservation
  const genPath = path.join(target, ".agent/roles/generator.yaml");
  const origGen = fs.readFileSync(genPath, "utf8");
  fs.writeFileSync(genPath, origGen + "\n# USER_ROLE_EDIT\n");

  const convPath = path.join(target, ".agent/conventions.yaml");
  const origConv = fs.readFileSync(convPath, "utf8");
  fs.writeFileSync(convPath, origConv + "\n# USER_EDIT_MARKER\n");

  const manifestPath = path.join(target, ".agent/manifest.yaml");
  const origManifest = fs.readFileSync(manifestPath, "utf8");
  fs.writeFileSync(manifestPath, origManifest + "\n# USER_MANIFEST_MARKER\n");

  // Default update — roles are always refreshed from stack detection
  await captureStdout(async () => update({ cwd: target, flags: {} }));

  // roles must be refreshed (user edits are NOT preserved — roles are auto-generated)
  const genAfter = fs.readFileSync(genPath, "utf8");
  assert("update: always refreshes role yaml from detected stack", genAfter.includes("role: generator"), genAfter.slice(0, 80));

  // conventions.yaml must be untouched
  const convAfter = fs.readFileSync(convPath, "utf8");
  assert("update: does not touch conventions.yaml", convAfter.includes("USER_EDIT_MARKER"), convAfter.slice(0, 80));

  // manifest.yaml must be untouched
  const manifestAfter = fs.readFileSync(manifestPath, "utf8");
  assert("update: does not touch manifest.yaml", manifestAfter.includes("USER_MANIFEST_MARKER"), manifestAfter.slice(0, 80));

  // stack.yaml IS always refreshed (it's auto-generated)
  const stackPath = path.join(target, ".agent/stack.yaml");
  assert("update: always refreshes stack.yaml", fs.existsSync(stackPath), null);

  // --force overwrites roles and templates
  const forceTarget = fixture("update-force-target", {
    "package.json": JSON.stringify({ name: "t" }),
  });
  await captureStdout(async () => init({ cwd: forceTarget, flags: { persona: "architect" } }));
  const forceGenPath = path.join(forceTarget, ".agent/roles/generator.yaml");
  fs.writeFileSync(forceGenPath, "CORRUPTED");
  await captureStdout(async () => update({ cwd: forceTarget, flags: { force: true } }));
  const forceGenAfter = fs.readFileSync(forceGenPath, "utf8");
  assert("update: --force overwrites roles", forceGenAfter !== "CORRUPTED", forceGenAfter.slice(0, 60));
  assert("update: --force role has role field", forceGenAfter.includes("role: generator"), forceGenAfter.slice(0, 80));

  // --persona + --force re-applies persona to roles
  const personaTarget = fixture("update-persona-force", {
    "package.json": JSON.stringify({ name: "t" }),
  });
  await captureStdout(async () => init({ cwd: personaTarget, flags: { persona: "pragmatist" } }));
  await captureStdout(async () => update({ cwd: personaTarget, flags: { persona: "vibecoder", force: true } }));
  const personaGen = fs.readFileSync(path.join(personaTarget, ".agent/roles/generator.yaml"), "utf8");
  assert("update: --persona + --force re-applies persona to roles", personaGen.includes("ship working code first"), personaGen.slice(0, 120));

  // fails without .agent/ directory
  const fresh = fixture("update-no-agent", { "package.json": JSON.stringify({ name: "t" }) });
  const updateCode = await captureAll(async () => update({ cwd: fresh, flags: {} }));
  assert("update: fails without .agent/manifest.yaml", updateCode !== 0, updateCode);
}

async function suitePersonas() {
  process.stdout.write("\n[personas]\n");

  const mkTarget = (name) =>
    fixture(name, { "package.json": JSON.stringify({ name: "t" }) });

  // architect
  const archTarget = mkTarget("persona-architect");
  await captureStdout(async () => init({ cwd: archTarget, flags: { persona: "architect" } }));
  const archConv = fs.readFileSync(path.join(archTarget, ".agent/conventions.yaml"), "utf8");
  const archManifest = fs.readFileSync(path.join(archTarget, ".agent/manifest.yaml"), "utf8");
  const archGen = fs.readFileSync(path.join(archTarget, ".agent/roles/generator.yaml"), "utf8");
  assert("persona: architect sets tone.style deliberate in conventions", archConv.includes("style: deliberate"), archConv.slice(0, 120));
  assert("persona: architect sets persona in manifest", archManifest.includes("persona: architect"), archManifest.slice(0, 80));
  assert("persona: architect adds guidance to generator role", archGen.includes("guidance:"), archGen.slice(0, 120));

  // vibecoder
  const vibeTarget = mkTarget("persona-vibecoder");
  await captureStdout(async () => init({ cwd: vibeTarget, flags: { persona: "vibecoder" } }));
  const vibeConv = fs.readFileSync(path.join(vibeTarget, ".agent/conventions.yaml"), "utf8");
  assert("persona: vibecoder sets tone.style fast in conventions", vibeConv.includes("style: fast"), vibeConv.slice(0, 120));

  // lead
  const leadTarget = mkTarget("persona-lead");
  await captureStdout(async () => init({ cwd: leadTarget, flags: { persona: "lead" } }));
  const leadConv = fs.readFileSync(path.join(leadTarget, ".agent/conventions.yaml"), "utf8");
  assert("persona: lead sets tone.style mentorship in conventions", leadConv.includes("style: mentorship"), leadConv.slice(0, 120));

  // pragmatist (default)
  const pragTarget = mkTarget("persona-pragmatist");
  await captureStdout(async () => init({ cwd: pragTarget, flags: { persona: "pragmatist" } }));
  const pragConv = fs.readFileSync(path.join(pragTarget, ".agent/conventions.yaml"), "utf8");
  assert("persona: pragmatist sets tone.style balanced in conventions", pragConv.includes("style: balanced"), pragConv.slice(0, 120));

  // invalid persona → falls back to pragmatist
  const fallbackTarget = mkTarget("persona-invalid");
  await captureStdout(async () => init({ cwd: fallbackTarget, flags: { persona: "wizard" } }));
  const fallbackConv = fs.readFileSync(path.join(fallbackTarget, ".agent/conventions.yaml"), "utf8");
  assert("persona: invalid falls back to pragmatist (balanced)", fallbackConv.includes("style: balanced"), fallbackConv.slice(0, 120));
}

async function suiteMap() {
  process.stdout.write("\n[map]\n");

  // Empty dir is greenfield
  const empty = fixture("map-empty", { "README.md": "# hi" });
  assert("map: dir with no source files is greenfield", isGreenfield(empty) === true);

  // Dir with source files is not greenfield
  const existing = fixture("map-existing", {
    "package.json": JSON.stringify({ name: "t", dependencies: { "@nestjs/core": "^10" } }),
    "src/main.ts": "const x = 1;",
    "src/app.ts": "const y = 2;",
    "src/users/users.service.ts": "class UsersService {}",
    "src/users/users.controller.ts": "class UsersController {}",
    "src/orders/orders.service.ts": "class OrdersService {}",
  });
  assert("map: dir with source files is not greenfield", isGreenfield(existing) === false);

  // Greenfield map format
  const gMap = buildCodebaseMap(empty, { language: "unknown" });
  assert("map: greenfield map has type marker", gMap.includes("Type: greenfield"));
  assert("map: greenfield map has opening marker", gMap.includes("<!-- agent-contract:codebase-map -->"));
  assert("map: greenfield map has closing marker", gMap.includes("<!-- /agent-contract:codebase-map -->"));
  assert("map: greenfield map omits agent usage for architecture", gMap.includes("Architect the solution"));

  // Existing map format
  const det = await detectStack(existing);
  const eMap = buildCodebaseMap(existing, det);
  assert("map: existing map has type marker", eMap.includes("Type: existing"));
  assert("map: existing map has directory structure", eMap.includes("src/"));
  assert("map: existing map has agent usage protocol", eMap.includes("Agent Usage Protocol"));
  assert("map: existing map has key config files", eMap.includes("package.json"));
  assert("map: existing map lists nestjs dep", eMap.includes("@nestjs/core"));
}

async function suiteHooks() {
  process.stdout.write("\n[hooks]\n");

  const target = fixture("hooks-target", {
    "package.json": JSON.stringify({ name: "t" }),
  });
  await captureStdout(async () => init({ cwd: target, flags: {} }));

  const scopeCheck = path.join(target, ".agent/checks/scope-check.sh");
  const writeHandoff = path.join(target, ".agent/checks/write-handoff.sh");
  const sessionDir = path.join(target, ".agent/session");

  // scope-check: no active-role.txt → fail-closed (exit 1) for source writes
  const noRoleCode = runScriptWithInput(
    scopeCheck, [],
    JSON.stringify({ tool_name: "Write", tool_input: { file_path: path.join(target, "src/foo.ts"), content: "x" } })
  );
  assert("scope-check: exits 2 (blocks) when no active-role.txt (fail-closed)", noRoleCode === BLOCK, noRoleCode);

  // scope-check: no active-role.txt → writable .agent/ infra (memory/decisions/handoffs) still passes
  const noRoleAgentCode = runScriptWithInput(
    scopeCheck, [],
    JSON.stringify({ tool_name: "Write", tool_input: { file_path: path.join(target, ".agent/memory/notes.md"), content: "hi" } })
  );
  assert("scope-check: exits 0 for writable .agent/ infra when no active-role.txt", noRoleAgentCode === 0, noRoleAgentCode);

  // scope-check: active role "tester" (may_create/modify: tests/**)
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, "active-role.txt"), "tester\n");

  const inScopeCode = runScriptWithInput(
    scopeCheck, [],
    JSON.stringify({ tool_name: "Write", tool_input: { file_path: path.join(target, "tests/foo.test.ts"), content: "x" } })
  );
  assert("scope-check: exits 0 when file is in role scope", inScopeCode === 0, inScopeCode);

  const outOfScopeCode = runScriptWithInput(
    scopeCheck, [],
    JSON.stringify({ tool_name: "Write", tool_input: { file_path: path.join(target, "src/service.ts"), content: "x" } })
  );
  assert("scope-check: exits 2 (blocks) when file is outside role scope", outOfScopeCode === BLOCK, outOfScopeCode);

  // scope-check: unknown role file → fail-closed (declared role has no YAML → block source writes)
  fs.writeFileSync(path.join(sessionDir, "active-role.txt"), "nonexistent-role\n");
  const unknownRoleCode = runScriptWithInput(
    scopeCheck, [],
    JSON.stringify({ tool_name: "Write", tool_input: { file_path: path.join(target, "src/anything.ts"), content: "x" } })
  );
  assert("scope-check: exits 2 (blocks) when role YAML not found (fail-closed)", unknownRoleCode === BLOCK, unknownRoleCode);

  // scope-check: always allows writes to .agent/ infrastructure regardless of role
  fs.writeFileSync(path.join(sessionDir, "active-role.txt"), "tester\n");
  const agentInfraCode = runScriptWithInput(
    scopeCheck, [],
    JSON.stringify({ tool_name: "Write", tool_input: { file_path: path.join(target, ".agent/memory/decisions.jsonl"), content: "x" } })
  );
  assert("scope-check: exits 0 for .agent/ infrastructure writes", agentInfraCode === 0, agentInfraCode);

  // write-handoff: skips write when no git changes (avoids noise on trivial turns)
  // In a non-git temp dir, CHANGED stays empty → script exits 0 without creating a file
  const memFilesBefore = fs.readdirSync(path.join(target, ".agent/memory"))
    .filter((f) => f.startsWith("handoff-done-") && f.endsWith(".md")).length;
  runScript(writeHandoff, []);
  const memFilesAfterNoChange = fs.readdirSync(path.join(target, ".agent/memory"))
    .filter((f) => f.startsWith("handoff-done-") && f.endsWith(".md")).length;
  assert("write-handoff: skips write when no git changes", memFilesAfterNoChange === memFilesBefore, memFilesAfterNoChange);

  // write-handoff: creates a handoff file in .agent/memory/ when there ARE changes
  // Simulate by initialising a git repo and making an uncommitted change
  const gitTarget = fixture("hooks-git-target", { "package.json": JSON.stringify({ name: "t" }) });
  execSync("git init && git add . && git commit -m init --allow-empty-message", { cwd: gitTarget, stdio: "pipe" });
  await captureStdout(async () => init({ cwd: gitTarget, flags: {} }));
  // Stage a new file so git diff HEAD reports a change
  fs.mkdirSync(path.join(gitTarget, "src"), { recursive: true });
  fs.writeFileSync(path.join(gitTarget, "src/new.ts"), "export const x = 1;\n");
  execSync("git add src/new.ts", { cwd: gitTarget, stdio: "pipe" });
  const gitWriteHandoff = path.join(gitTarget, ".agent/checks/write-handoff.sh");
  const gitSessionDir = path.join(gitTarget, ".agent/session");
  fs.mkdirSync(gitSessionDir, { recursive: true });
  fs.writeFileSync(path.join(gitSessionDir, "active-role.txt"), "generator\n");
  runScript(gitWriteHandoff, []);
  const memFiles = fs.readdirSync(path.join(gitTarget, ".agent/memory"))
    .filter((f) => f.startsWith("handoff-done-") && f.endsWith(".md"));
  assert("write-handoff: creates handoff file when changes exist", memFiles.length > 0, memFiles);

  // write-handoff: handoff file contains role and resume prompt
  const handoffContent = fs.readFileSync(path.join(gitTarget, ".agent/memory", memFiles[0]), "utf8");
  assert("write-handoff: handoff file contains role", handoffContent.includes("generator"), handoffContent.slice(0, 200));
  assert("write-handoff: handoff file contains resume prompt", handoffContent.includes("Resume Prompt"), handoffContent.slice(0, 400));
  assert(
    "write-handoff: filename has second-granularity timestamp",
    /handoff-done-\d{4}-\d{2}-\d{2}-\d{6}\.md/.test(memFiles[0]),
    memFiles[0]
  );

  // write-handoff: compaction — keeps only 5, archives the rest
  {
    const compactMemDir = path.join(gitTarget, ".agent/memory");
    // Seed 7 fake handoff files (older than the one written above)
    for (let i = 1; i <= 7; i++) {
      const ts = `2020-01-0${i}-120000`;
      fs.writeFileSync(
        path.join(compactMemDir, `handoff-done-${ts}.md`),
        `# Agent Handoff — ${ts}\n\n## Role\ngenerator\n\n## Files Changed\nfoo.ts\n\n## Last 5 Decisions\n{}\n\n## Resume Prompt\n\`\`\`\ntest\n\`\`\`\n`
      );
    }
    runScript(gitWriteHandoff, []);
    // Background compaction may need a moment to finish
    await new Promise((r) => setTimeout(r, 400));
    const remaining = fs.readdirSync(compactMemDir).filter((f) => f.startsWith("handoff-done-") && f.endsWith(".md"));
    assert("write-handoff: compaction keeps at most 5 handoffs", remaining.length <= 5, remaining.length);
    const archiveExists = fs.existsSync(path.join(compactMemDir, "handoff-archive.jsonl"));
    assert("write-handoff: compaction writes handoff-archive.jsonl", archiveExists, null);
    if (archiveExists) {
      const archiveLine = fs.readFileSync(path.join(compactMemDir, "handoff-archive.jsonl"), "utf8").trim();
      assert("write-handoff: archive entries are valid JSON", archiveLine.split("\n").every((l) => { try { JSON.parse(l); return true; } catch { return false; } }), archiveLine.slice(0, 200));
    }
  }

  // scope-check: quoted patterns (YAML emitter quotes strings starting with *) are stripped
  const quotedRoleDir = path.join(gitTarget, ".agent/roles");
  fs.writeFileSync(path.join(quotedRoleDir, "custom.yaml"), [
    "schema: agent-contract/v1",
    "role: custom",
    "scope:",
    "  may_create:",
    '  - "**/utils/**"',
    "  may_modify: []",
    "  may_delete: []",
  ].join("\n") + "\n");
  const gitScopeCheck = path.join(gitTarget, ".agent/checks/scope-check.sh");
  fs.writeFileSync(path.join(gitSessionDir, "active-role.txt"), "custom\n");
  const quotedInScope = runScriptWithInput(
    gitScopeCheck, [],
    JSON.stringify({ tool_name: "Write", tool_input: { file_path: path.join(gitTarget, "src/utils/helper.ts"), content: "x" } })
  );
  assert("scope-check: quoted pattern matches correctly after stripping quotes", quotedInScope === 0, quotedInScope);
  const quotedOutOfScope = runScriptWithInput(
    gitScopeCheck, [],
    JSON.stringify({ tool_name: "Write", tool_input: { file_path: path.join(gitTarget, "src/service.ts"), content: "x" } })
  );
  assert("scope-check: quoted pattern blocks files outside scope", quotedOutOfScope === BLOCK, quotedOutOfScope);

  // .agent/session/.gitignore created by init
  assert(
    "init creates .agent/session/.gitignore",
    fs.existsSync(path.join(target, ".agent/session/.gitignore"))
  );
  const sessionGitignore = fs.readFileSync(path.join(target, ".agent/session/.gitignore"), "utf8");
  assert(".agent/session/.gitignore ignores everything", sessionGitignore.trim() === "*");

  // installClaudeHooks is idempotent — re-running init does not duplicate hooks
  await captureStdout(async () => init({ cwd: target, flags: {} }));
  const settings2 = JSON.parse(fs.readFileSync(path.join(target, ".claude/settings.json"), "utf8"));
  const scopeHookCount = (settings2.hooks.PreToolUse || [])
    .flatMap((e) => e.hooks || [])
    .filter((h) => h.command && h.command.includes("scope-check.sh")).length;
  assert("hooks install: idempotent (scope-check not duplicated)", scopeHookCount === 1, scopeHookCount);
}

async function suiteHookContract() {
  process.stdout.write("\n[hook contract]\n");

  const T = require("../lib/util/templates");
  const { installClaudeHooks } = require("../lib/util/hooks");

  // PreToolUse blocks ONLY on exit 2. Anything else non-zero is a non-blocking hook
  // error: Claude Code notes it and runs the tool anyway. A guard that exits 1 on a
  // violation therefore prints a refusal and permits the write -- silently, and
  // indistinguishably from "no violation found". This suite pins the contract.
  const guards = {
    "scope-check.sh": T.scopeCheckScript(),
    "bash-write-guard.sh": T.bashWriteGuardScript(),
  };
  for (const [name, body] of Object.entries(guards)) {
    const strayOnes = (body.match(/^\s*exit 1$/gm) || []).length;
    const twos = (body.match(/^\s*exit 2$/gm) || []).length;
    assert(`hook: ${name} has no bare 'exit 1'`, strayOnes === 0, strayOnes);
    assert(`hook: ${name} blocks with 'exit 2'`, twos > 0, twos);
    assert(`hook: ${name} still allows with 'exit 0'`,
      /^\s*exit 0$/m.test(body), null);
  }

  // Scripts invoked directly or from CI keep exit 1 — the conventional failure code.
  // Conflating the two conventions is how the bug above happened.
  const direct = {
    "review-check.sh": T.reviewCheck(),
    "security-audit.sh": T.securityAuditCheck(),
  };
  for (const [name, body] of Object.entries(direct)) {
    assert(`hook: ${name} (CI-invoked) still fails with exit 1`,
      /^\s*exit 1$/m.test(body), null);
  }

  // Hook commands must not depend on the working directory. A script the shell cannot
  // find exits 127, which is also non-blocking — the same silent failure mode.
  const dir = fs.mkdtempSync(path.join(TMP, "hookfmt-"));
  installClaudeHooks(dir, false);
  const settings = JSON.parse(fs.readFileSync(path.join(dir, ".claude/settings.json"), "utf8"));
  const commands = []
    .concat(settings.hooks.PreToolUse || [], settings.hooks.Stop || [])
    .flatMap((e) => (e.hooks || []).map((h) => h.command));
  assert("hook: every command is registered", commands.length === 3, commands);
  for (const cmd of commands) {
    assert(`hook: cwd-independent path in ${cmd.split("/").pop()}`,
      cmd.includes("$CLAUDE_PROJECT_DIR"), cmd);
    assert(`hook: project dir is quoted in ${cmd.split("/").pop()}`,
      cmd.includes('"$CLAUDE_PROJECT_DIR/'), cmd);
  }
  assert("hook: install is idempotent", installClaudeHooks(dir, false).action === "skip", null);

  // End to end: a real violation must return exactly 2, not merely non-zero.
  const repo = fixture("hook-exit", {
    "package.json": JSON.stringify({ name: "he", version: "1.0.0" }),
    "lib/a.js": "module.exports = 1;",
    "docs/a.md": "# d",
  });
  await captureStdout(async () => init({ cwd: repo, flags: { yes: true } }));
  const sc = path.join(repo, ".agent/checks/scope-check.sh");
  const bw = path.join(repo, ".agent/checks/bash-write-guard.sh");
  fs.writeFileSync(path.join(repo, ".agent/session/active-role.txt"), "documenter\n");

  const w = (rel) => runScriptWithInput(sc, [], JSON.stringify({
    tool_name: "Write", tool_input: { file_path: path.join(repo, rel) },
  }));
  assert("hook: out-of-scope write returns exactly 2", w("lib/a.js") === 2, w("lib/a.js"));
  assert("hook: in-scope write returns 0", w("docs/a.md") === 0, w("docs/a.md"));

  const b = (cmd) => runScriptWithInput(bw, [], JSON.stringify({
    tool_name: "Bash", tool_input: { command: cmd },
  }));
  assert("hook: protected bash write returns exactly 2",
    b("echo x > .agent/roles/generator.yaml") === 2, b("echo x > .agent/roles/generator.yaml"));
  assert("hook: harmless bash returns 0", b("npm test") === 0, b("npm test"));
}

async function suiteRoleInference() {
  process.stdout.write("\n[role inference]\n");

  const { parseRoleScope, writableGlobs } = require("../lib/util/scope");

  const target = fixture("infer", {
    "package.json": JSON.stringify({ name: "ir", version: "1.0.0" }),
    "lib/a.js": "module.exports = 1;",
    "test/a.test.js": "// t",
    "README.md": "# r",
    "docs/guide.md": "# g",
  });
  await captureStdout(async () => init({ cwd: target, flags: { yes: true } }));

  const sc = path.join(target, ".agent/checks/scope-check.sh");
  const session = path.join(target, ".agent/session/active-role.txt");

  // Each probe starts from a fresh session so inference is what is being measured.
  const probe = (rel) => {
    try { fs.rmSync(session); } catch {}
    const code = runScriptWithInput(sc, [], JSON.stringify({
      tool_name: "Write", tool_input: { file_path: path.join(target, rel) },
    }));
    let role = null;
    try { role = fs.readFileSync(session, "utf8").trim(); } catch {}
    return { code, role };
  };

  // Editing an existing file resolves through may_modify, which is unique per area.
  let r = probe("lib/a.js");
  assert("infer: existing source -> integrator", r.code === 0 && r.role === "integrator", r);
  r = probe("test/a.test.js");
  assert("infer: existing test -> tester", r.code === 0 && r.role === "tester", r);
  r = probe("README.md");
  assert("infer: README -> documenter", r.code === 0 && r.role === "documenter", r);
  r = probe("docs/guide.md");
  assert("infer: existing doc -> documenter", r.code === 0 && r.role === "documenter", r);

  // Creating resolves through may_create. New source belongs to generator, which
  // declares inputs_required — so the spec gate must still bite rather than infer.
  r = probe("lib/brand-new.js");
  assert("infer: new source still requires a spec", r.code === BLOCK && r.role === null, r);
  r = probe("src/brand-new.ts");
  assert("infer: new src/ also requires a spec", r.code === BLOCK && r.role === null, r);

  // New tests and docs are unambiguous among roles that need no spec.
  r = probe("test/new.test.js");
  assert("infer: new test -> tester", r.code === 0 && r.role === "tester", r);
  r = probe("docs/new.md");
  assert("infer: new doc -> documenter", r.code === 0 && r.role === "documenter", r);

  // Paths no role covers stay blocked, and nothing is persisted.
  r = probe("package.json");
  assert("infer: uncovered existing path blocked", r.code === BLOCK && r.role === null, r);
  r = probe("Makefile");
  assert("infer: uncovered new path blocked", r.code === BLOCK && r.role === null, r);

  // Inference grants nothing beyond the role it picks.
  try { fs.rmSync(session); } catch {}
  runScriptWithInput(sc, [], JSON.stringify({
    tool_name: "Write", tool_input: { file_path: path.join(target, "test/a.test.js") },
  }));
  assert("infer: persisted role is tester", fs.readFileSync(session, "utf8").trim() === "tester", null);
  const afterInfer = runScriptWithInput(sc, [], JSON.stringify({
    tool_name: "Write", tool_input: { file_path: path.join(target, "lib/a.js") },
  }));
  assert("infer: inferred tester still cannot write lib/", afterInfer === BLOCK, afterInfer);

  // An explicitly declared role is never overridden by inference.
  fs.writeFileSync(session, "documenter\n");
  assert("infer: explicit role still enforced",
    runScriptWithInput(sc, [], JSON.stringify({
      tool_name: "Write", tool_input: { file_path: path.join(target, "lib/a.js") },
    })) === BLOCK, null);
  assert("infer: explicit role still permitted in its own scope",
    runScriptWithInput(sc, [], JSON.stringify({
      tool_name: "Write", tool_input: { file_path: path.join(target, "docs/guide.md") },
    })) === 0, null);

  // Contract-controlled paths are unaffected by inference.
  try { fs.rmSync(session); } catch {}
  assert("infer: never infers a role for a contract-controlled path",
    runScriptWithInput(sc, [], JSON.stringify({
      tool_name: "Write", tool_input: { file_path: path.join(target, ".agent/roles/generator.yaml") },
    })) === BLOCK, null);
  assert("infer: no role persisted after a protected-path block",
    !fs.existsSync(session), null);

  // Read-only roles declare no writable globs, so they can never be inferred.
  const roleOf = (name) => fs.readFileSync(path.join(target, ".agent/roles", name + ".yaml"), "utf8");
  for (const ro of ["reviewer", "security"]) {
    assert("infer: " + ro + " declares no writable globs",
      writableGlobs(parseRoleScope(roleOf(ro))).length === 0, ro);
  }

  // The debugger fixes what it diagnosed, so it may write source and tests — but only once
  // declared. It requires a spec, so inference never picks it; otherwise it would tie with
  // integrator and tester and make every ordinary edit ambiguous (the probes above pin that).
  assert("debugger: declares writable globs",
    writableGlobs(parseRoleScope(roleOf("debugger"))).length > 0, roleOf("debugger"));
  assert("debugger: declares inputs_required", /^inputs_required:/m.test(roleOf("debugger")), null);
  const edit = (rel) => runScriptWithInput(sc, [], JSON.stringify({
    tool_name: "Edit", tool_input: { file_path: path.join(target, rel) },
  }));
  fs.writeFileSync(session, "debugger\n");
  assert("debugger: declared debugger can fix existing source", edit("lib/a.js") === 0, null);
  assert("debugger: declared debugger can fix an existing test", edit("test/a.test.js") === 0, null);
  assert("debugger: declared debugger still cannot write outside source/tests",
    edit("package.json") === BLOCK, null);

  // pre-generate validates the debugger's own fields, not the generator defaults.
  const preGen = path.join(target, ".agent/checks/pre-generate.sh");
  const dSpec = path.join(target, "debug-spec.json");
  fs.rmSync(session);
  fs.writeFileSync(dSpec, JSON.stringify({ feature_name: "x", input_shape: "y", output_shape: "z", error_cases: [] }));
  assert("debugger: a generator-shaped spec does not declare the debugger",
    runScript(preGen, [dSpec, "debugger"]) === 1 && !fs.existsSync(session), null);
  fs.writeFileSync(dSpec, JSON.stringify({
    symptom: "s", diagnosis: "d", affected_files: ["lib/a.js"], selected_solution: "1",
  }));
  assert("debugger: a filled-in diagnosis declares it",
    runScript(preGen, [dSpec, "debugger"]) === 0 && fs.readFileSync(session, "utf8").trim() === "debugger", null);
  fs.rmSync(session);
  fs.rmSync(dSpec);

  // -- status reports role drift in BOTH directions --------------------------
  // An earlier version only flagged scopes wider than the template, so a contract
  // that was simply never updated read as clean.
  const genPath = path.join(target, ".agent/roles/generator.yaml");
  const genOrig = fs.readFileSync(genPath, "utf8");
  fs.writeFileSync(genPath, genOrig.replace("  - bin/**\n", ""));
  let out = "";
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { out += chunk; return true; };
  try {
    await status({ cwd: target });
  } finally {
    process.stdout.write = origWrite;
  }
  assert("drift: narrower-than-template role is reported",
    out.includes("NARROWER than template"), out.split("\n").filter((l) => l.includes("roles:")));
  assert("drift: names the missing glob", out.includes("bin/**"), null);
  fs.writeFileSync(genPath, genOrig);

  out = "";
  process.stdout.write = (chunk) => { out += chunk; return true; };
  try {
    await status({ cwd: target });
  } finally {
    process.stdout.write = origWrite;
  }
  assert("drift: clean contract reports roles matching templates",
    out.includes("roles:      match the installed templates"), out.split("\n").filter((l) => l.includes("roles:")));
}

async function suiteScopeGuard() {
  process.stdout.write("\n[scope guard]\n");

  const { parseRoleScope, writableGlobs, diffRoleScope } = require("../lib/util/scope");

  // ── parser: must read exactly what the shell guard reads ──────────────────
  const blockList = [
    "role: generator",
    "scope:",
    "  may_create:",
    "  - src/**",
    "  - lib/**",
    "  may_modify: []",
    "  may_delete: []",
    "handoff_to: integrator",
  ].join("\n");
  const parsed = parseRoleScope(blockList);
  assert("scope: parses block list", JSON.stringify(parsed.may_create) === '["src/**","lib/**"]', parsed.may_create);
  assert("scope: parses inline [] as empty", parsed.may_modify.length === 0, parsed.may_modify);
  assert("scope: stops at next top-level key", !JSON.stringify(parsed).includes("integrator"), parsed);
  assert("scope: writableGlobs unions create+modify, sorted",
    JSON.stringify(writableGlobs(parsed)) === '["lib/**","src/**"]', writableGlobs(parsed));

  const noScope = parseRoleScope("role: reviewer\nresponsibility: none\n");
  assert("scope: missing scope block yields empty (read-only)",
    writableGlobs(noScope).length === 0, noScope);

  // ── diff direction ────────────────────────────────────────────────────────
  const narrow = "scope:\n  may_create:\n  - docs/**\n  may_modify: []\n  may_delete: []\n";
  const wide = "scope:\n  may_create:\n  - docs/**\n  - bin/**\n  may_modify: []\n  may_delete: []\n";
  const widened = diffRoleScope(narrow, wide);
  assert("scope: gaining a glob is a widening", widened.widens === true && widened.added[0] === "bin/**", widened);
  const narrowed = diffRoleScope(wide, narrow);
  assert("scope: losing a glob is not a widening", narrowed.widens === false, narrowed);
  assert("scope: narrowing is reported as removed", narrowed.removed[0] === "bin/**", narrowed);
  const delWide = diffRoleScope(narrow, "scope:\n  may_create:\n  - docs/**\n  may_modify: []\n  may_delete:\n  - docs/**\n");
  assert("scope: gaining delete reach is a widening", delWide.widens === true && delWide.addedDelete[0] === "docs/**", delWide);
  assert("scope: identical roles do not widen", diffRoleScope(wide, wide).widens === false, null);

  // ── the guard, end to end ─────────────────────────────────────────────────
  const target = fixture("scope-guard", {
    "package.json": JSON.stringify({ name: "sg", version: "1.0.0" }),
    "lib/x.js": "module.exports = 1;\n",
  });
  await captureStdout(async () => init({ cwd: target, flags: { yes: true } }));

  const genPath = path.join(target, ".agent/roles/generator.yaml");
  const full = fs.readFileSync(genPath, "utf8");
  assert("scope: js fixture grants generator bin/**", full.includes("- bin/**"), full);

  // Hand-narrow the role, then let update try to regenerate it wider.
  fs.writeFileSync(genPath, full.replace("  - bin/**\n", ""));
  let code = await captureAll(async () => update({ cwd: target, flags: { skipSelfUpdate: true } }));
  assert("scope: update refuses to widen without consent", code === 1, code);
  assert("scope: refused run wrote nothing",
    !fs.readFileSync(genPath, "utf8").includes("- bin/**"), null);

  code = await captureAll(async () => update({ cwd: target, flags: { skipSelfUpdate: true, allowScopeChange: true } }));
  assert("scope: --allow-scope-change applies the widening", code === 0, code);
  assert("scope: role regained the glob",
    fs.readFileSync(genPath, "utf8").includes("- bin/**"), null);

  // A corrupted role parses as empty scope, so restoring it looks like a widening.
  // --force has to carry consent or the repair path is unreachable.
  fs.writeFileSync(genPath, "CORRUPTED\n");
  code = await captureAll(async () => update({ cwd: target, flags: { skipSelfUpdate: true, force: true } }));
  assert("scope: --force implies consent", code === 0, code);
  assert("scope: --force restored the role",
    fs.readFileSync(genPath, "utf8").includes("- bin/**"), null);

  // Steady state: nothing to widen, so the guard must not fire.
  code = await captureAll(async () => update({ cwd: target, flags: { skipSelfUpdate: true } }));
  assert("scope: guard silent when nothing widens", code === 0, code);

  // ── documenter owns the agent-facing shims ────────────────────────────────
  const T = require("../lib/util/templates");
  const docScope = parseRoleScope(T.roleYaml("documenter", "pragmatist", { language: "javascript" }));
  for (const f of T.SHIM_FILES) {
    assert(`scope: documenter may write ${f}`, docScope.may_modify.includes(f), docScope.may_modify);
  }
  const intScope = parseRoleScope(T.roleYaml("integrator", "pragmatist", { language: "javascript" }));
  assert("scope: integrator may modify bin/**", intScope.may_modify.includes("bin/**"), intScope.may_modify);
  const reviewerScope = parseRoleScope(T.roleYaml("reviewer", "pragmatist", { language: "javascript" }));
  assert("scope: reviewer stays read-only", writableGlobs(reviewerScope).length === 0, reviewerScope);

  // ── bash guard blocks the consent flags in-session ────────────────────────
  const guard = path.join(target, ".agent/checks/bash-write-guard.sh");
  const bash = (cmd) => runScriptWithInput(guard, [], JSON.stringify({ tool_name: "Bash", tool_input: { command: cmd } }));
  assert("scope: bash guard blocks --allow-scope-change",
    bash("agent-contract update --allow-scope-change") === BLOCK, null);
  assert("scope: bash guard blocks node-invoked --allow-scope-change",
    bash("node bin/agent-contract.js update --cwd . --allow-scope-change") === BLOCK, null);
  assert("scope: bash guard blocks update --force", bash("agent-contract update --force") === BLOCK, null);
  assert("scope: bash guard blocks init --force", bash("agent-contract init --force") === BLOCK, null);
  assert("scope: bash guard blocks npx form", bash("npx agent-contract update --force") === BLOCK, null);
  assert("scope: bash guard allows plain update", bash("agent-contract update") === 0, null);
  assert("scope: bash guard allows dry-run", bash("agent-contract update --dry-run") === 0, null);
  assert("scope: bash guard allows npm test", bash("npm test") === 0, null);
  assert("scope: bash guard allows a commit mentioning the flag",
    bash("git commit -m 'document --allow-scope-change'") === 0, null);

  // ── toolchain integrity ───────────────────────────────────────────────────
  // The installed package sits outside the repo, and every check is regenerated from
  // its templates — so an unguarded out-of-repo write is a route to neutering the
  // guards from any target repo, not just a self-hosted one.
  const sc = path.join(target, ".agent/checks/scope-check.sh");
  const writeTo = (p) => runScriptWithInput(sc, [], JSON.stringify({ tool_name: "Write", tool_input: { file_path: p } }));

  assert("toolchain: blocks writes to an installed agent-contract lib",
    writeTo("/usr/local/lib/node_modules/@semeton/agent-contract/lib/util/templates.js") === BLOCK, null);
  assert("toolchain: blocks writes to an installed agent-contract bin",
    writeTo("/opt/homebrew/lib/node_modules/agent-contract/bin/agent-contract.js") === BLOCK, null);
  assert("toolchain: blocks writes to its package.json",
    writeTo("/usr/local/lib/node_modules/agent-contract/package.json") === BLOCK, null);
  assert("toolchain: blocks hook settings anywhere",
    writeTo(path.join(os.homedir(), ".claude/settings.json")) === BLOCK, null);
  assert("toolchain: still allows unrelated out-of-repo writes",
    writeTo("/tmp/scratch-file.js") === 0, null);
  assert("toolchain: still allows a sibling project",
    writeTo(path.join(os.tmpdir(), "some-other-project/src/x.js")) === 0, null);

  // A stale scope-lib.sh (one predating the helper) must not fall open: an undefined
  // function returns 127, which an `if` reads as "not protected".
  const slPath = path.join(target, ".agent/checks/scope-lib.sh");
  const slOrig = fs.readFileSync(slPath, "utf8");
  assert("toolchain: scope-lib defines the abs helper",
    slOrig.includes("scope_is_protected_abs"), null);
  fs.writeFileSync(slPath, slOrig.replace(/scope_is_protected_abs\(\)[\s\S]*?\n}\n/, ""));
  assert("toolchain: fails closed when scope-lib is stale",
    writeTo("/usr/local/lib/node_modules/agent-contract/lib/util/templates.js") === BLOCK, null);
  assert("toolchain: stale scope-lib still allows unrelated paths",
    writeTo("/tmp/scratch-file.js") === 0, null);
  fs.writeFileSync(slPath, slOrig);

  // ── enforcement-surface consent when self-hosted ──────────────────────────
  // Vendor bin+lib into the fixture so the running CLI's templates live inside the
  // repo it is updating — the case where an agent with lib/ scope owns the guards.
  const vend = fixture("vendored", {
    "package.json": JSON.stringify({ name: "vendored", version: "1.0.0" }),
  });
  for (const d of ["bin", "lib"]) {
    fs.cpSync(path.join(__dirname, "..", d), path.join(vend, d), { recursive: true });
  }
  const cli = path.join(vend, "bin/agent-contract.js");
  const sh = (args) => {
    try {
      execSync(`node '${cli}' ${args}`, { cwd: vend, stdio: "pipe" });
      return 0;
    } catch (e) { return e.status || 1; }
  };
  assert("self-hosted: init succeeds", sh("init --cwd . --yes") === 0, null);
  assert("self-hosted: steady-state update is silent", sh("update --cwd . --skip-self-update") === 0, null);

  // Now tamper with the guard's own generator, exactly as an lib/-scoped agent could.
  const tmplPath = path.join(vend, "lib/util/templates.js");
  const tmpl = fs.readFileSync(tmplPath, "utf8");
  fs.writeFileSync(tmplPath, tmpl.replace('RE3="agent-contract', 'RE3="NEVERMATCHagent-contract'));
  assert("self-hosted: plain update refuses to deploy edited guards",
    sh("update --cwd . --skip-self-update") === 1, null);
  assert("self-hosted: the guard on disk is untouched",
    fs.readFileSync(path.join(vend, ".agent/checks/bash-write-guard.sh"), "utf8").includes('RE3="agent-contract'), null);
  assert("self-hosted: consent deploys it",
    sh("update --cwd . --skip-self-update --allow-scope-change") === 0, null);
  assert("self-hosted: consented change landed",
    fs.readFileSync(path.join(vend, ".agent/checks/bash-write-guard.sh"), "utf8").includes("NEVERMATCH"), null);

  // The normal case must be unaffected: templates outside the repo are upstream, so a
  // plain update still ships improved checks. Breaking this breaks self-update.
  const plain = fixture("not-self-hosted", {
    "package.json": JSON.stringify({ name: "nsh", version: "1.0.0" }),
    "lib/a.js": "module.exports = 1;\n",
  });
  await captureStdout(async () => init({ cwd: plain, flags: { yes: true } }));
  const psc = path.join(plain, ".agent/checks/scope-check.sh");
  fs.writeFileSync(psc, fs.readFileSync(psc, "utf8").replace("#!/usr/bin/env bash", "#!/usr/bin/env bash\n# STALE"));
  const code2 = await captureAll(async () => update({ cwd: plain, flags: { skipSelfUpdate: true } }));
  assert("not-self-hosted: plain update needs no consent", code2 === 0, code2);
  assert("not-self-hosted: upstream check applied",
    !fs.readFileSync(psc, "utf8").includes("# STALE"), null);

  // -- consent requires a human, not a matchable command string --------------
  // The Bash guard can only pattern-match how a command was typed, and shell
  // indirection defeats that. The gate that actually holds lives in update() itself.
  const gateTarget = fixture("consent-gate", {
    "package.json": JSON.stringify({ name: "cg", version: "1.0.0" }),
    "lib/a.js": "module.exports = 1;",
  });
  await captureStdout(async () => init({ cwd: gateTarget, flags: { yes: true } }));

  delete process.env.AGENT_CONTRACT_NONINTERACTIVE_CONSENT;
  try {
    let c = await captureAll(async () => update({ cwd: gateTarget, flags: { skipSelfUpdate: true, force: true } }));
    assert("consent: --force refused with no TTY and no hatch", c === 1, c);
    c = await captureAll(async () => update({ cwd: gateTarget, flags: { skipSelfUpdate: true, allowScopeChange: true } }));
    assert("consent: --allow-scope-change refused with no TTY and no hatch", c === 1, c);
    c = await captureAll(async () => update({ cwd: gateTarget, flags: { skipSelfUpdate: true } }));
    assert("consent: plain update unaffected by the gate", c === 0, c);
  } finally {
    process.env.AGENT_CONTRACT_NONINTERACTIVE_CONSENT = "1";
  }
  const c2 = await captureAll(async () => update({ cwd: gateTarget, flags: { skipSelfUpdate: true, force: true } }));
  assert("consent: hatch re-enables --force", c2 === 0, c2);

  const bwg = path.join(gateTarget, ".agent/checks/bash-write-guard.sh");
  const bash2 = (cmd) => runScriptWithInput(bwg, [], JSON.stringify({ tool_name: "Bash", tool_input: { command: cmd } }));
  assert("consent: bash guard blocks setting the hatch",
    bash2("AGENT_CONTRACT_NONINTERACTIVE_CONSENT=1 agent-contract update") === BLOCK, null);
  assert("consent: bash guard blocks the hatch even without a subcommand",
    bash2("export AGENT_CONTRACT_NONINTERACTIVE_CONSENT=1") === BLOCK, null);

  // -- enforcement wiring drift ---------------------------------------------
  const pgCheck = path.join(gateTarget, ".agent/checks/pre-generate.sh");
  const specPath = path.join(gateTarget, "spec.json");
  fs.writeFileSync(specPath, JSON.stringify({ feature_name: "x", input_shape: "x", output_shape: "x", error_cases: [] }));
  const settings = path.join(gateTarget, ".claude/settings.json");
  const settingsOrig = fs.readFileSync(settings, "utf8");

  assert("wiring: passes with hooks intact", runScript(pgCheck, [specPath, "documenter"]) === 0, null);
  fs.writeFileSync(settings, JSON.stringify({ hooks: { PreToolUse: [] } }));
  assert("wiring: hard-fails when the guards are unwired",
    runScript(pgCheck, [specPath, "documenter"]) === 1, null);
  fs.rmSync(settings);
  assert("wiring: only warns when there is no settings.json at all",
    runScript(pgCheck, [specPath, "documenter"]) === 0, null);
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, settingsOrig);

  // -- update refreshes every check init installs ----------------------------
  // review-check.sh was in init's plan but not update's, so it was never refreshed.
  const checksDir = path.join(gateTarget, ".agent/checks");
  for (const f of fs.readdirSync(checksDir)) {
    const abs = path.join(checksDir, f);
    fs.writeFileSync(abs, fs.readFileSync(abs, "utf8") + "#STALE_MARKER");
  }
  await captureAll(async () => update({ cwd: gateTarget, flags: { skipSelfUpdate: true, allowScopeChange: true } }));
  const stillStale = fs.readdirSync(checksDir)
    .filter((f) => fs.readFileSync(path.join(checksDir, f), "utf8").includes("STALE_MARKER"));
  assert("wiring: update refreshes every installed check", stillStale.length === 0, stillStale);

  // -- parser conformance: scope.js vs scope-lib.sh --------------------------
  // Twin implementations of one rule in two languages. The shell copy is what the hook
  // enforces, so the JS copy must never see fewer globs than it does.
  const slib = path.join(gateTarget, ".agent/checks/scope-lib.sh");
  const NL = "\n";
  const corpus = {
    "block list": "scope:" + NL + "  may_create:" + NL + "  - src/**" + NL + "  - lib/**" + NL + "  may_modify: []" + NL,
    "both populated": "scope:" + NL + "  may_create:" + NL + "  - a/**" + NL + "  may_modify:" + NL + "  - b/**" + NL,
    "all empty": "scope:" + NL + "  may_create: []" + NL + "  may_modify: []" + NL,
    "quoted values": "scope:" + NL + "  may_create:" + NL + '  - "q/**"' + NL + "  may_modify: []" + NL,
    "key after list": "scope:" + NL + "  may_create:" + NL + "  - a/**" + NL + "  may_modify: []" + NL + "handoff_to: tester" + NL,
    "no scope block": "role: reviewer" + NL + "responsibility: none" + NL,
    "deep indent": "scope:" + NL + "    may_create:" + NL + "    - deep/**" + NL + "    may_modify: []" + NL,
    "keys outside scope": "may_create:" + NL + "- loose/**" + NL + "scope:" + NL + "  may_create:" + NL + "  - inner/**" + NL,
    "blank line in list": "scope:" + NL + "  may_create:" + NL + "  - a/**" + NL + NL + "  may_modify:" + NL + "  - b/**" + NL,
    "root and dotfiles": "scope:" + NL + "  may_create:" + NL + "  - .cursorrules" + NL + "  - README.md" + NL + "  may_modify: []" + NL,
  };
  for (const [name, yaml] of Object.entries(corpus)) {
    const f = path.join(gateTarget, "corpus.yaml");
    fs.writeFileSync(f, yaml);
    let shellOut = "";
    try {
      shellOut = execSync("bash -c 'source \"" + slib + "\"; scope_role_patterns \"" + f + "\"'", { encoding: "utf8" });
    } catch {
      shellOut = "";
    }
    const shellGlobs = shellOut.split(NL).map((x) => x.trim()).filter(Boolean).sort();
    const jsGlobs = writableGlobs(parseRoleScope(yaml));
    const jsSet = new Set(jsGlobs);
    const missed = shellGlobs.filter((g) => !jsSet.has(g));
    assert("conformance: js sees everything the shell does - " + name,
      missed.length === 0, { shell: shellGlobs, js: jsGlobs, missed });
  }
}



async function suiteStreaming() {
  process.stdout.write("\n[streaming]\n");

  const A = require("../lib/providers/anthropic");
  const { extractSseEvents, createStreamMessage, applyStreamEvent, finalizeStreamMessage, parseResponse } = A;

  // Feed frames a few bytes at a time — a chunk boundary inside a frame is the
  // normal case on a real socket, not an edge case.
  function feed(frames, chunkSize) {
    const raw = frames.map((f) => `event: ${f.type}\ndata: ${JSON.stringify(f)}\n\n`).join("");
    const msg = createStreamMessage();
    let buf = "";
    for (let i = 0; i < raw.length; i += chunkSize) {
      buf += raw.slice(i, i + chunkSize);
      const { events, rest } = extractSseEvents(buf);
      buf = rest;
      for (const ev of events) applyStreamEvent(msg, ev);
    }
    return finalizeStreamMessage(msg);
  }

  const happy = [
    { type: "message_start", message: { model: "claude-opus-5", usage: { input_tokens: 1200, cache_read_input_tokens: 1024 } } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "pondering" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "text" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hello " } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "world" } },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 88 } },
    { type: "message_stop" },
  ];

  for (const size of [1, 7, 4096]) {
    const r = parseResponse(feed(happy, size));
    assert(`stream: text assembled at ${size}-byte chunks`, r.output === "Hello world", r.output);
  }

  const r = parseResponse(feed(happy, 7));
  assert("stream: skips the leading thinking block", r.output === "Hello world", r.output);
  assert("stream: model from message_start", r.model === "claude-opus-5", r.model);
  assert("stream: input tokens carried", r.usage.input_tokens === 1200, r.usage);
  assert("stream: cache reads reported", r.usage.cache_read_input_tokens === 1024, r.usage);
  assert("stream: output tokens from message_delta", r.usage.output_tokens === 88, r.usage);

  // A refusal is HTTP 200 with a stop_reason, so it must not read as empty output.
  const refused = feed([
    { type: "message_start", message: { model: "claude-opus-5", usage: { input_tokens: 10 } } },
    { type: "message_delta", delta: { stop_reason: "refusal", stop_details: { category: "cyber", explanation: "nope" } }, usage: { output_tokens: 0 } },
  ], 5);
  let threw = null;
  try { parseResponse(refused); } catch (e) { threw = e.message; }
  assert("stream: refusal throws", threw !== null, threw);
  assert("stream: refusal names the category", threw && threw.includes("cyber"), threw);

  threw = null;
  try {
    feed([{ type: "message_start", message: {} }, { type: "error", error: { type: "overloaded_error", message: "overloaded" } }], 5);
  } catch (e) { threw = e.message; }
  assert("stream: error event throws", threw !== null && threw.includes("overloaded"), threw);

  // Index holes: only block 3 ever starts, so content has gaps before compaction.
  const holed = feed([
    { type: "message_start", message: { model: "claude-opus-5", usage: { input_tokens: 5 } } },
    { type: "content_block_start", index: 3, content_block: { type: "thinking" } },
    { type: "content_block_delta", index: 3, delta: { type: "thinking_delta", thinking: "..." } },
    { type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 64000 } },
  ], 9);
  assert("stream: index holes compacted", holed.content.length === 1, holed.content.length);
  threw = null;
  try { parseResponse(holed); } catch (e) { threw = e.message; }
  assert("stream: thinking-only response throws", threw !== null, threw);
  assert("stream: max_tokens gets an actionable message",
    threw && threw.includes("max_tokens"), threw);

  // A malformed frame must not take the run down.
  const mixed = extractSseEvents('data: {bad json\n\ndata: {"type":"ping"}\n\n');
  assert("stream: malformed frame skipped, good one kept",
    mixed.events.length === 1 && mixed.events[0].type === "ping", mixed.events);
  assert("stream: incomplete trailing frame is buffered, not parsed",
    extractSseEvents('data: {"type":"ping"}\n\ndata: {"typ').rest.startsWith("data:"), null);
  assert("stream: CRLF line endings handled",
    extractSseEvents('data: {"type":"ping"}\r\n\r\n').events.length === 1, null);
  assert("stream: [DONE] sentinel ignored", extractSseEvents("data: [DONE]\n\n").events.length === 0, null);

  // The request itself
  const body = A.buildRequest({ system: "s", user: "u", effort: "xhigh" });
  assert("stream: adaptive thinking set", body.thinking && body.thinking.type === "adaptive", body.thinking);
  assert("stream: effort nested in output_config", body.output_config.effort === "xhigh", body.output_config);
  assert("stream: system carries a cache breakpoint",
    body.system[0].cache_control.type === "ephemeral", body.system[0]);
  assert("stream: max_tokens raised for streaming", A.DEFAULT_MAX_TOKENS === 64000, A.DEFAULT_MAX_TOKENS);
  assert("stream: no budget_tokens (rejected on current models)",
    !("budget_tokens" in body.thinking), body.thinking);
  let effortErr = null;
  try { A.buildRequest({ system: "s", user: "u", effort: "extreme" }); } catch (e) { effortErr = e.message; }
  assert("stream: invalid effort rejected in buildRequest", effortErr !== null, effortErr);

  // openai: the same blind-index bug the anthropic provider had
  const O = require("../lib/providers/openai");
  assert("openai: default model is the documented pin", O.DEFAULT_MODEL === "gpt-4o", O.DEFAULT_MODEL);
}

async function suiteScopeHardening() {
  process.stdout.write("\n[scope-hardening]\n");

  const target = fixture("hardening-target", {
    "package.json": JSON.stringify({ name: "t" }),
  });
  await captureStdout(async () => init({ cwd: target, flags: {} }));

  const scopeCheck = path.join(target, ".agent/checks/scope-check.sh");
  const bashGuard = path.join(target, ".agent/checks/bash-write-guard.sh");
  const sessionDir = path.join(target, ".agent/session");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, "active-role.txt"), "generator\n");

  const writeInput = (rel) =>
    JSON.stringify({ tool_name: "Write", tool_input: { file_path: path.join(target, rel), content: "x" } });
  const bashInput = (command) =>
    JSON.stringify({ tool_name: "Bash", tool_input: { command } });

  // --- Gap 0: contract-controlled files are never agent-writable via file tools ---
  const protectedPaths = [
    ".agent/session/active-role.txt",
    ".agent/roles/generator.yaml",
    ".agent/checks/scope-check.sh",
    ".agent/checks/scope-lib.sh",
    ".claude/settings.json",
  ];
  for (const rel of protectedPaths) {
    const code = runScriptWithInput(scopeCheck, [], writeInput(rel));
    assert(`scope-check: BLOCKS write to contract-controlled ${rel}`, code === BLOCK, code);
  }

  // Gap 0 regression: writable .agent infra (memory/decisions) still passes
  const infraCode = runScriptWithInput(scopeCheck, [], writeInput(".agent/memory/decisions.jsonl"));
  assert("scope-check: still ALLOWS writable .agent/ infra (.agent/memory)", infraCode === 0, infraCode);

  // --- Gap 3: empty-scope role is fail-closed (read-only) ---
  // reviewer declares may_create: [] / may_modify: [] → must not write source
  fs.writeFileSync(path.join(sessionDir, "active-role.txt"), "reviewer\n");
  const reviewerCode = runScriptWithInput(scopeCheck, [], writeInput("src/whatever.ts"));
  assert("scope-check: empty-scope role (reviewer) is fail-closed on source write", reviewerCode === BLOCK, reviewerCode);

  // --- Path canonicalisation: the target is checked as requested AND as resolved ---
  // Matched as a raw string, 'lib/../.agent/roles/x' passed as lib/**, and a symlinked
  // directory reached a protected file with no '..' at all. rawInput skips path.join,
  // which would normalise the '..' away before the hook ever saw it.
  const rawInput = (p) =>
    JSON.stringify({ tool_name: "Write", tool_input: { file_path: p, content: "x" } });
  const asRole = (role) => fs.writeFileSync(path.join(sessionDir, "active-role.txt"), role + "\n");
  asRole("generator");
  assert("scope-check: BLOCKS '..' traversal into a protected file",
    runScriptWithInput(scopeCheck, [], rawInput(`${target}/lib/../.agent/roles/tester.yaml`)) === BLOCK, null);
  asRole("tester");
  assert("scope-check: BLOCKS '..' traversal out of the role's scope",
    runScriptWithInput(scopeCheck, [], rawInput(`${target}/test/../lib/a.js`)) === BLOCK, null);
  assert("scope-check: '..' that stays inside the scope is still allowed",
    runScriptWithInput(scopeCheck, [], rawInput(`${target}/test/unit/../a.test.js`)) === 0, null);

  fs.mkdirSync(path.join(target, "test"), { recursive: true });
  fs.mkdirSync(path.join(target, "lib"), { recursive: true });
  fs.symlinkSync("../.agent/roles", path.join(target, "test/roles-link"));
  fs.symlinkSync("../lib", path.join(target, "test/lib-link"));
  fs.symlinkSync("../.agent/roles/tester.yaml", path.join(target, "test/role.yaml"));
  assert("scope-check: BLOCKS a protected file reached through a symlinked dir",
    runScriptWithInput(scopeCheck, [], writeInput("test/roles-link/tester.yaml")) === BLOCK, null);
  assert("scope-check: BLOCKS a protected file reached through a file symlink",
    runScriptWithInput(scopeCheck, [], writeInput("test/role.yaml")) === BLOCK, null);
  // The kernel resolves 'link/..' to the parent of the link's TARGET: lexically this is
  // test/checks/scope-check.sh (in tester scope), on disk it is .agent/checks/scope-check.sh.
  assert("scope-check: BLOCKS 'link/..' resolved the way the kernel does",
    runScriptWithInput(scopeCheck, [], rawInput(`${target}/test/roles-link/../checks/scope-check.sh`)) === BLOCK, null);
  assert("scope-check: BLOCKS an out-of-scope file reached through a symlinked dir",
    runScriptWithInput(scopeCheck, [], writeInput("test/lib-link/a.js")) === BLOCK, null);

  // The project root in its resolved spelling (macOS: /var -> /private/var) used to leave
  // the path absolute, which read as outside the repo and skipped the scope check. On a
  // filesystem without such a link the two spellings coincide and this is a plain check.
  const realTarget = fs.realpathSync(target);
  assert("scope-check: resolved-root spelling is still scope-checked",
    runScriptWithInput(scopeCheck, [], rawInput(path.join(realTarget, "lib/a.js"))) === BLOCK, null);
  assert("scope-check: resolved-root spelling still allows in-scope writes",
    runScriptWithInput(scopeCheck, [], rawInput(path.join(realTarget, "test/a.test.js"))) === 0, null);

  // restore a writing role for later
  fs.writeFileSync(path.join(sessionDir, "active-role.txt"), "generator\n");

  // --- Gap 1: bash-write-guard blocks Bash tampering with contract-controlled files ---
  const blockedCommands = [
    'echo generator > .agent/session/active-role.txt',
    'echo "x" >> .agent/roles/generator.yaml',
    "sed -i 's/a/b/' .agent/checks/scope-check.sh",
    "rm .agent/checks/scope-check.sh",
    "cp /tmp/evil.yaml .agent/roles/generator.yaml",
    'printf "{}" > .claude/settings.json',
  ];
  for (const cmd of blockedCommands) {
    const code = runScriptWithInput(bashGuard, [], bashInput(cmd));
    assert(`bash-write-guard: BLOCKS \`${cmd.slice(0, 42)}…\``, code === BLOCK, code);
  }

  // bash-write-guard must NOT block legitimate commands (low false-positive)
  const allowedCommands = [
    "cat .agent/roles/generator.yaml",            // read of a protected path, no write op
    "grep -r foo .agent/checks 2>/dev/null",      // read + unrelated stderr redirect
    "echo hello > src/foo.ts",                    // write, but not a protected path → outcome layer's job
    "npm test",                                   // no protected path at all
    "git add .agent/roles/generator.yaml",        // staging is not a file write ('add' must not match 'dd')
    "git diff .agent/checks/scope-check.sh",      // read-only diff
    "bash .agent/checks/pre-generate.sh spec.json generator", // sanctioned: runs a protected script, doesn't write it
  ];
  for (const cmd of allowedCommands) {
    const code = runScriptWithInput(bashGuard, [], bashInput(cmd));
    assert(`bash-write-guard: ALLOWS \`${cmd.slice(0, 42)}…\``, code === 0, code);
  }

  // --- Gap 3 at the outcome layer: post-generate fail-closed for read-only role ---
  // Needs a git repo so post-generate sees a diff.
  const gitTarget = fixture("hardening-postgen", { "package.json": JSON.stringify({ name: "t" }) });
  execSync("git init && git add . && git commit -m init --allow-empty-message", { cwd: gitTarget, stdio: "pipe" });
  await captureStdout(async () => init({ cwd: gitTarget, flags: {} }));
  const gitSession = path.join(gitTarget, ".agent/session");
  fs.mkdirSync(gitSession, { recursive: true });
  const postGen = path.join(gitTarget, ".agent/checks/post-generate.sh");
  // Exit code AND stderr: a crash exits 1 too, and the read-only case used to pass
  // this suite by crashing on an unbound array rather than by detecting anything.
  const runPostGen = () => {
    try {
      execSync(`bash ${postGen}`, { stdio: "pipe" });
      return { code: 0, err: "" };
    } catch (e) {
      return { code: e.status || 1, err: String(e.stderr || "") };
    }
  };
  const asGitRole = (role) => fs.writeFileSync(path.join(gitSession, "active-role.txt"), role + "\n");

  // The check compares the working tree to HEAD, so the contract itself is committed
  // first — uncommitted init output would otherwise count as the task's change.
  execSync("git add -A && git commit -m contract --allow-empty-message", { cwd: gitTarget, stdio: "pipe" });

  // It used to read only `git diff --cached`: an agent's new file, never staged, was invisible.
  fs.mkdirSync(path.join(gitTarget, "src"), { recursive: true });
  fs.writeFileSync(path.join(gitTarget, "src/leak.ts"), "export const x = 1;\n");
  asGitRole("reviewer");
  let pg = runPostGen();
  assert("post-generate: read-only role's UNTRACKED source file is HARD FAIL",
    pg.code === 1 && pg.err.includes("is read-only (no writable paths) but changed: src/leak.ts"), pg);
  assert("post-generate: a failure says what the change set is compared against",
    pg.err.includes("Compared against HEAD"), pg.err);

  // generator creating the same file is in scope → passes (the lean stack has no other gates)
  asGitRole("generator");
  pg = runPostGen();
  assert("post-generate: generator source change passes scope check", pg.code === 0, pg);

  // An unstaged edit to a tracked file is the task's change too.
  execSync("git add src/leak.ts && git commit -m leak --allow-empty-message", { cwd: gitTarget, stdio: "pipe" });
  fs.appendFileSync(path.join(gitTarget, "src/leak.ts"), "export const y = 2;\n");
  asGitRole("tester");
  pg = runPostGen();
  assert("post-generate: UNSTAGED edit outside the role's scope is HARD FAIL",
    pg.code === 1 && pg.err.includes("scope violation: src/leak.ts"), pg);

  // ...and staging it does not change the answer.
  execSync("git add src/leak.ts", { cwd: gitTarget, stdio: "pipe" });
  pg = runPostGen();
  assert("post-generate: STAGED edit outside the role's scope is HARD FAIL",
    pg.code === 1 && pg.err.includes("scope violation: src/leak.ts"), pg);
  execSync("git reset -q && git checkout -- src/leak.ts", { cwd: gitTarget, stdio: "pipe" });

  // debug-scope reads the same change set; the report it is given is not part of the fix.
  const debugScope = path.join(gitTarget, ".agent/checks/debug-scope.sh");
  fs.writeFileSync(path.join(gitTarget, "debug-report.md"),
    "# Debug Report\n\n## Affected Files\n- src/leak.ts:1-2\n\n## Proposed Solutions\n");
  fs.appendFileSync(path.join(gitTarget, "src/leak.ts"), "// fix\n");
  assert("debug-scope: unstaged fix inside the diagnosis passes (report itself ignored)",
    runScript(debugScope, [path.join(gitTarget, "debug-report.md")]) === 0, null);
  fs.writeFileSync(path.join(gitTarget, "src/extra.ts"), "export {};\n");
  assert("debug-scope: UNTRACKED file outside the diagnosis is HARD FAIL",
    runScript(debugScope, [path.join(gitTarget, "debug-report.md")]) === 1, null);
}

async function suiteEffort() {
  process.stdout.write("\n[effort + provider]\n");

  const T = require("../lib/util/templates");
  const anthropic = require("../lib/providers/anthropic");

  // ---- per-role effort ----
  // Default API effort is "high", so medium/low are genuine reductions and xhigh is
  // spent only where the reasoning pays for itself.
  const EXPECTED = {
    generator: "high",
    integrator: "medium",
    tester: "medium",
    reviewer: "high",
    debugger: "xhigh",
    documenter: "low",
    security: "xhigh",
  };
  for (const role of T.ROLES) {
    const yaml = T.roleYaml(role, "pragmatist", { language: "javascript" });
    const got = (yaml.match(/^effort:\s*(\S+)$/m) || [])[1];
    assert(`effort: ${role} declares ${EXPECTED[role]}`, got === EXPECTED[role], got);
  }
  assert(
    "effort: every declared value is one the API accepts",
    T.ROLES.every((r) => {
      const v = (T.roleYaml(r, "pragmatist", { language: "javascript" }).match(/^effort:\s*(\S+)$/m) || [])[1];
      return anthropic.VALID_EFFORT.has(v);
    })
  );

  // ---- request shape ----
  const req = anthropic.buildRequest({ system: "SYS", user: "USR", effort: "xhigh" });
  assert("provider: defaults to claude-opus-5", req.model === "claude-opus-5", req.model);
  assert("provider: sends adaptive thinking", req.thinking && req.thinking.type === "adaptive", req.thinking);
  // budget_tokens is rejected outright on current models — it must never come back.
  assert("provider: sends no budget_tokens", !("budget_tokens" in (req.thinking || {})), req.thinking);
  assert("provider: effort goes inside output_config", req.output_config && req.output_config.effort === "xhigh", req.output_config);
  assert("provider: omits output_config when no effort given",
    !("output_config" in anthropic.buildRequest({ system: "S", user: "U" })));
  // The contract prefix is byte-identical across runs of a role, so it carries the
  // cache breakpoint and the volatile task spec stays out of it.
  assert("provider: system is a cacheable block array", Array.isArray(req.system), typeof req.system);
  assert("provider: system block has a cache breakpoint",
    req.system[0].cache_control && req.system[0].cache_control.type === "ephemeral", req.system[0]);
  assert("provider: task spec stays in messages, not the cached prefix",
    req.messages[0].content === "USR" && !JSON.stringify(req.system).includes("USR"));
  assert("provider: max_tokens leaves room for thinking tokens", req.max_tokens >= 32000, req.max_tokens);
  let threw = null;
  try { anthropic.buildRequest({ system: "S", user: "U", effort: "turbo" }); } catch (e) { threw = e.message; }
  assert("provider: rejects an invalid effort value", threw !== null && /invalid effort/.test(threw), threw);

  // ---- response parsing ----
  // With thinking on, content[0] is a thinking block; indexing it blindly returned undefined.
  const withThinking = anthropic.parseResponse({
    model: "claude-opus-5",
    stop_reason: "end_turn",
    content: [{ type: "thinking", thinking: "" }, { type: "text", text: "real answer" }],
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 7 },
  });
  assert("provider: skips thinking blocks to find the text", withThinking.output === "real answer", withThinking.output);
  assert("provider: reports cache reads", withThinking.usage.cache_read_input_tokens === 900, withThinking.usage);
  assert("provider: reports cache writes", withThinking.usage.cache_creation_input_tokens === 7, withThinking.usage);

  const multi = anthropic.parseResponse({
    stop_reason: "end_turn",
    content: [{ type: "text", text: "part one" }, { type: "text", text: "part two" }],
    usage: {},
  });
  assert("provider: joins multiple text blocks", multi.output === "part one\npart two", multi.output);

  let refusal = null;
  try {
    anthropic.parseResponse({ stop_reason: "refusal", stop_details: { category: "cyber", explanation: "nope" }, content: [] });
  } catch (e) { refusal = e.message; }
  assert("provider: a refusal throws rather than reading as empty output",
    refusal !== null && /declined/.test(refusal) && /cyber/.test(refusal), refusal);

  let empty = null;
  try { anthropic.parseResponse({ stop_reason: "max_tokens", content: [{ type: "thinking", thinking: "" }] }); }
  catch (e) { empty = e.message; }
  assert("provider: a text-less response names max_tokens as the cause",
    empty !== null && /max_tokens/.test(empty), empty);

  // ---- effort resolution precedence, end to end through run() ----
  const target = fixture("effort-target", {
    "package.json": JSON.stringify({ name: "e" }),
    "src/a.js": "module.exports = 1;\n",
  });
  await captureStdout(async () => init({ cwd: target, flags: {} }));

  // captureStdout only silences output; this collects it so the resolved effort line
  // (and its source) can be asserted on.
  async function runCollecting(flags) {
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    let text = "";
    process.stdout.write = (c) => { text += c; return true; };
    process.stderr.write = (c) => { text += c; return true; };
    try {
      const exit = await run({ cwd: target, flags });
      return { text, exit };
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
  }

  const roleDefault = await runCollecting({ role: "documenter", task: "t", dryRun: true });
  assert("effort: role value is used when nothing overrides it",
    /effort:\s+low \(role:documenter\)/.test(roleDefault.text),
    (roleDefault.text.match(/effort:.*/) || [])[0]);

  const debuggerRun = await runCollecting({ role: "debugger", task: "t", dryRun: true });
  assert("effort: a different role resolves to its own value",
    /effort:\s+xhigh \(role:debugger\)/.test(debuggerRun.text),
    (debuggerRun.text.match(/effort:.*/) || [])[0]);

  process.env.AGENT_EFFORT = "max";
  const overridden = await runCollecting({ role: "documenter", task: "t", dryRun: true });
  assert("effort: config/env overrides the role value",
    /effort:\s+max \(config\)/.test(overridden.text),
    (overridden.text.match(/effort:.*/) || [])[0]);

  const flagWins = await runCollecting({ role: "documenter", task: "t", dryRun: true, effort: "low" });
  assert("effort: an explicit flag outranks config",
    /effort:\s+low \(flag\)/.test(flagWins.text),
    (flagWins.text.match(/effort:.*/) || [])[0]);

  process.env.AGENT_EFFORT = "turbo";
  const bad = await runCollecting({ role: "documenter", task: "t", dryRun: true });
  assert("effort: an invalid value fails the run", bad.exit === 1, bad.exit);
  assert("effort: the failure names the offending value and its source",
    /invalid effort "turbo".*config/.test(bad.text), (bad.text.match(/invalid effort.*/) || [])[0]);
  delete process.env.AGENT_EFFORT;
}

async function suiteConfigRefresh() {
  process.stdout.write("\n[config refresh]\n");

  const { writeFile } = require("../lib/util/fs");
  const T = require("../lib/util/templates");
  const cfg = T.configYaml();

  assert("config: docs are wrapped in markers", cfg.includes(T.CONFIG_DOCS_OPEN) && cfg.includes(T.CONFIG_DOCS_CLOSE));
  // Settings must sit OUTSIDE the refreshed region, or uncommenting one would put it
  // inside a block that gets rewritten.
  const closeAt = cfg.indexOf(T.CONFIG_DOCS_CLOSE);
  assert("config: example settings sit below the closing marker",
    cfg.indexOf("# provider: claude-code") > closeAt && cfg.indexOf("# effort: high") > closeAt);
  assert("config: docs advertise the current default model", cfg.includes("claude-opus-5"));

  const dir = fixture("config-refresh", {});
  function attempt(name, initial) {
    const abs = path.join(dir, name);
    fs.writeFileSync(abs, initial);
    const res = writeFile(abs, cfg, { mode: "merge-config" });
    return { action: res.action, after: fs.readFileSync(abs, "utf8") };
  }

  // Already current — must be a true no-op, not a rewrite.
  const current = attempt("current.yaml", cfg);
  assert("config: an up-to-date file is skipped", current.action === "skip", current.action);
  assert("config: an up-to-date file is byte-identical", current.after === cfg);

  // Marked file with real settings: docs refresh, settings survive, nothing duplicates.
  const customized = cfg
    .replace("# provider: claude-code", "provider: anthropic")
    .replace("# model: claude-opus-5", "model: claude-sonnet-5");
  const stale = customized.replace("# Uncomment and set values to override the defaults.", "# OBSOLETE DOC LINE");
  const refreshed = attempt("customized.yaml", stale);
  assert("config: stale doc text is replaced", !refreshed.after.includes("OBSOLETE DOC LINE"), refreshed.action);
  assert("config: an active provider setting survives", /^provider: anthropic$/m.test(refreshed.after));
  assert("config: an active model setting survives", /^model: claude-sonnet-5$/m.test(refreshed.after));
  assert("config: settings are not duplicated",
    (refreshed.after.match(/^provider:/gm) || []).length === 1,
    (refreshed.after.match(/^provider:/gm) || []).length);
  const abs = path.join(dir, "customized.yaml");
  const once = fs.readFileSync(abs, "utf8");
  writeFile(abs, cfg, { mode: "merge-config" });
  assert("config: a second refresh changes nothing", fs.readFileSync(abs, "utf8") === once);

  // Pre-markers file that is still pristine boilerplate — safe to regenerate, and this
  // is the path that carries stale defaults forward for repos initialized long ago.
  const legacyPristine = attempt("legacy.yaml", "# .agent/config.yaml — orchestrator configuration.\n# model: claude-opus-4-7\n");
  assert("config: pristine legacy file is regenerated", legacyPristine.action === "overwrite", legacyPristine.action);
  assert("config: regeneration drops the stale model id", !legacyPristine.after.includes("claude-opus-4-7"));
  assert("config: regeneration adds the markers", legacyPristine.after.includes(T.CONFIG_DOCS_OPEN));

  // Pre-markers file that the user has actually configured — never touch it.
  const legacyBody = "# .agent/config.yaml\n# model: claude-opus-4-7\nprovider: anthropic\n";
  const legacyActive = attempt("legacy-active.yaml", legacyBody);
  assert("config: legacy file with settings is skipped", legacyActive.action === "skip", legacyActive.action);
  assert("config: legacy file with settings is untouched", legacyActive.after === legacyBody);

  const halfBody = T.CONFIG_DOCS_OPEN + "\n# no closing marker\nprovider: openai\n";
  const half = attempt("half.yaml", halfBody);
  assert("config: half a marker pair is skipped", half.action === "skip", half.action);
  assert("config: half a marker pair is untouched", half.after === halfBody);

  // ---- end to end through update() ----
  const target = fixture("config-update", { "package.json": JSON.stringify({ name: "c" }) });
  await captureStdout(async () => init({ cwd: target, flags: {} }));
  const cfgPath = path.join(target, ".agent/config.yaml");
  // Simulate a repo whose docs are stale and whose owner has picked a provider.
  fs.writeFileSync(
    cfgPath,
    fs.readFileSync(cfgPath, "utf8")
      .replace("claude-opus-5", "claude-opus-4-7")
      .replace("# provider: claude-code", "provider: anthropic")
  );
  await captureStdout(async () => update({ cwd: target, flags: {} }));
  const updated = fs.readFileSync(cfgPath, "utf8");
  assert("config: update refreshes stale docs in place", !updated.includes("claude-opus-4-7"), updated.match(/claude-opus[^\s]*/g));
  assert("config: update preserves the user's provider", /^provider: anthropic$/m.test(updated));

  // --force must not reach config.yaml — a lost provider choice is worse than a stale comment.
  fs.writeFileSync(cfgPath, updated.replace("provider: anthropic", "provider: openai"));
  await captureStdout(async () => update({ cwd: target, flags: { force: true } }));
  assert("config: --force still preserves the user's setting",
    /^provider: openai$/m.test(fs.readFileSync(cfgPath, "utf8")));
}

async function suiteVersion() {
  process.stdout.write("\n[version]\n");

  // Test the pure helpers directly — no network needed
  // Inline the logic to avoid spawning a subprocess
  const PKG = require("../package.json");

  // isNewer: extracted inline for testing
  function isNewer(a, b) {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) > (pb[i] || 0)) return true;
      if ((pa[i] || 0) < (pb[i] || 0)) return false;
    }
    return false;
  }

  assert("version: package.json has version field", typeof PKG.version === "string", PKG.version);
  assert("version: version matches semver pattern", /^\d+\.\d+\.\d+$/.test(PKG.version), PKG.version);
  assert("version: isNewer(1.0.1, 1.0.0) → true", isNewer("1.0.1", "1.0.0") === true, null);
  assert("version: isNewer(1.0.0, 1.0.0) → false", isNewer("1.0.0", "1.0.0") === false, null);
  assert("version: isNewer(1.0.0, 1.0.1) → false", isNewer("1.0.0", "1.0.1") === false, null);
  assert("version: isNewer(2.0.0, 1.9.9) → true", isNewer("2.0.0", "1.9.9") === true, null);
  assert("version: isNewer(0.2.0, 0.1.9) → true", isNewer("0.2.0", "0.1.9") === true, null);

  // --version flag wires through the CLI bin without network (catch network errors)
  const { execSync } = require("child_process");
  let out;
  try {
    out = execSync("node bin/agent-contract.js --version", {
      cwd: path.resolve(__dirname, ".."),
      timeout: 10000,
      encoding: "utf8",
    });
  } catch (e) {
    out = e.stdout || "";
  }
  assert("version: --version prints current version", out.includes(PKG.version), out.trim());
  assert("version: -v alias works", (() => {
    try { return execSync("node bin/agent-contract.js -v", { cwd: path.resolve(__dirname, ".."), timeout: 10000, encoding: "utf8" }); }
    catch (e) { return e.stdout || ""; }
  })().includes(PKG.version), null);
}

(async () => {
  process.stdout.write("agent-contract smoke test\n");
  try {
    await suiteDetection();
    await suiteInit();
    await suiteChecks();
    await suiteRun();
    await suitePresets();
    await suiteLearn();
    await suitePersonas();
    await suiteUpdate();
    await suiteTokens();
    await suiteMap();
    await suiteHooks();
    await suiteScopeHardening();
    await suiteHookContract();
    await suiteRoleInference();
    await suiteScopeGuard();
    await suiteStreaming();
    await suiteEffort();
    await suiteConfigRefresh();
    await suiteVersion();
  } catch (e) {
    process.stderr.write(`fatal: ${e.message}\n${e.stack}\n`);
    process.exit(2);
  } finally {
    try {
      fs.rmSync(TMP, { recursive: true, force: true });
    } catch {}
  }

  process.stdout.write(`\n${passes} passed, ${failures} failed\n`);
  process.exit(failures > 0 ? 1 : 0);
})();
