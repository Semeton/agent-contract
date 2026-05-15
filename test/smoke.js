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
}

function captureStdout(fn) {
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  return Promise.resolve(fn()).finally(() => {
    process.stdout.write = origWrite;
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

(async () => {
  process.stdout.write("agent-contract smoke test\n");
  try {
    await suiteDetection();
    await suiteInit();
    await suiteChecks();
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
