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
const { learnConventions } = require("../lib/learn");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "agent-contract-test-"));
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
    "CLAUDE.md",
    "AGENTS.md",
    ".cursorrules",
    ".github/copilot-instructions.md",
  ];
  for (const rel of expected) {
    const abs = path.join(target, rel);
    assert(`init creates ${rel}`, fs.existsSync(abs));
  }

  // checks must be executable
  for (const rel of [
    ".agent/checks/pre-generate.sh",
    ".agent/checks/post-generate.sh",
    ".agent/checks/debug-scope.sh",
  ]) {
    const mode = fs.statSync(path.join(target, rel)).mode & 0o111;
    assert(`${rel} is executable`, mode !== 0, mode);
  }

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

async function suiteUpdate() {
  process.stdout.write("\n[update]\n");

  const target = fixture("update-target", {
    "package.json": JSON.stringify({ name: "t", devDependencies: { jest: "^29" } }),
    "tsconfig.json": "{}",
  });

  // init first with architect persona
  await captureStdout(async () => init({ cwd: target, flags: { persona: "architect" } }));

  // Manually corrupt a role file to confirm update refreshes it
  const genPath = path.join(target, ".agent/roles/generator.yaml");
  fs.writeFileSync(genPath, "CORRUPTED");

  // Manually edit conventions.yaml to confirm update does NOT touch it
  const convPath = path.join(target, ".agent/conventions.yaml");
  const origConv = fs.readFileSync(convPath, "utf8");
  fs.writeFileSync(convPath, origConv + "\n# USER_EDIT_MARKER\n");

  // Manually edit manifest.yaml to confirm update does NOT touch it
  const manifestPath = path.join(target, ".agent/manifest.yaml");
  const origManifest = fs.readFileSync(manifestPath, "utf8");
  fs.writeFileSync(manifestPath, origManifest + "\n# USER_MANIFEST_MARKER\n");

  await captureStdout(async () => update({ cwd: target, flags: {} }));

  // role yaml must be refreshed
  const genAfter = fs.readFileSync(genPath, "utf8");
  assert("update: refreshes generator.yaml", genAfter !== "CORRUPTED", genAfter.slice(0, 60));
  assert("update: generator.yaml has role field", genAfter.includes("role: generator"), genAfter.slice(0, 80));

  // persona is read from manifest.yaml (architect) and applied to roles
  assert("update: re-applies persona from manifest (architect guidance)", genAfter.includes("guidance:"), genAfter.slice(0, 120));

  // conventions.yaml must be untouched
  const convAfter = fs.readFileSync(convPath, "utf8");
  assert("update: does not touch conventions.yaml", convAfter.includes("USER_EDIT_MARKER"), convAfter.slice(0, 80));

  // manifest.yaml must be untouched
  const manifestAfter = fs.readFileSync(manifestPath, "utf8");
  assert("update: does not touch manifest.yaml", manifestAfter.includes("USER_MANIFEST_MARKER"), manifestAfter.slice(0, 80));

  // fails without .agent/ directory
  const fresh = fixture("update-no-agent", { "package.json": JSON.stringify({ name: "t" }) });
  const { stderr: updateErr, code: updateCode } = await captureAll(async () => update({ cwd: fresh, flags: {} }));
  assert("update: fails without .agent/manifest.yaml", updateCode !== 0, updateErr);

  // --persona flag overrides manifest persona
  const target2 = fixture("update-persona-override", {
    "package.json": JSON.stringify({ name: "t" }),
  });
  await captureStdout(async () => init({ cwd: target2, flags: { persona: "pragmatist" } }));
  await captureStdout(async () => update({ cwd: target2, flags: { persona: "vibecoder" } }));
  const genOverride = fs.readFileSync(path.join(target2, ".agent/roles/generator.yaml"), "utf8");
  assert("update: --persona flag overrides manifest persona", genOverride.includes("ship working code first"), genOverride.slice(0, 120));
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
