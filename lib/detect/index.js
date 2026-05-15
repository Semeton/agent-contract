"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Detection result shape:
 * {
 *   language: string,
 *   runtime: string | null,
 *   framework: string | null,
 *   package_manager: string | null,
 *   test_runner: string | null,
 *   build: string | null,
 *   lint: string | null,
 *   formatter: string | null,
 *   db: string | null,
 *   orm: string | null,
 *   entry_points: string[],
 *   evidence: Array<{ source: string, key: string, value: string }>,
 *   confidence: "high" | "medium" | "low",
 *   unresolved: string[]   // fields we couldn't determine
 * }
 */

const DETECTORS = [
  require("./detectors/deno"),    // before node — scores higher when deno.json present
  require("./detectors/node"),
  require("./detectors/php"),
  require("./detectors/python"),
  require("./detectors/go"),
  require("./detectors/rust"),
  require("./detectors/java"),
  require("./detectors/ruby"),
  require("./detectors/dotnet"),
  require("./detectors/elixir"),
  require("./detectors/scala"),
  require("./detectors/clojure"),
  require("./detectors/swift"),
  require("./detectors/dart"),
];

async function detectStack(cwd) {
  const ctx = createContext(cwd);
  const candidates = [];

  for (const detector of DETECTORS) {
    const result = await detector.detect(ctx);
    if (result && result.score > 0) {
      candidates.push(result);
    }
  }

  if (candidates.length === 0) {
    return unknownStack(cwd);
  }

  // Highest score wins. Ties broken by manifest specificity.
  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0];

  // Co-detection: a Node winner can co-exist with Python (e.g. ML+API repos).
  // Surface this in evidence so the architect sees it.
  const coexisting = candidates
    .slice(1)
    .filter((c) => c.score >= 50)
    .map((c) => c.language);

  if (coexisting.length > 0) {
    winner.evidence.push({
      source: "detector",
      key: "coexisting_languages",
      value: coexisting.join(","),
    });
  }

  return finalize(winner, ctx);
}

function createContext(cwd) {
  return {
    cwd,
    exists: (rel) => fs.existsSync(path.join(cwd, rel)),
    read: (rel) => {
      try {
        return fs.readFileSync(path.join(cwd, rel), "utf8");
      } catch {
        return null;
      }
    },
    readJSON: (rel) => {
      const raw = (() => {
        try {
          return fs.readFileSync(path.join(cwd, rel), "utf8");
        } catch {
          return null;
        }
      })();
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    listTop: () => {
      try {
        return fs.readdirSync(cwd);
      } catch {
        return [];
      }
    },
  };
}

function unknownStack(cwd) {
  return {
    language: "unknown",
    runtime: null,
    framework: null,
    package_manager: null,
    test_runner: null,
    build: null,
    lint: null,
    formatter: null,
    db: null,
    orm: null,
    entry_points: [],
    evidence: [],
    confidence: "low",
    unresolved: [
      "language",
      "runtime",
      "framework",
      "package_manager",
      "test_runner",
      "build",
      "lint",
      "formatter",
    ],
  };
}

function finalize(result, _ctx) {
  const fields = [
    "language",
    "runtime",
    "framework",
    "package_manager",
    "test_runner",
    "build",
    "lint",
    "formatter",
    "db",
    "orm",
  ];
  const unresolved = fields.filter((f) => result[f] == null);

  let confidence = "high";
  if (unresolved.length >= 4) confidence = "low";
  else if (unresolved.length >= 2) confidence = "medium";

  delete result.score;

  return {
    ...result,
    commands: deriveCommands(result),
    confidence,
    unresolved,
  };
}

// Derive shell commands from detected stack labels.
// No detector changes needed — maps existing lint/test_runner/language fields.
function deriveCommands(r) {
  const pm = r.package_manager;
  const run = pm === "pnpm" ? "pnpm exec" : pm === "yarn" ? "yarn exec" : pm === "bun" ? "bunx" : "npx";

  let lint = null;
  let lint_ext = null;
  switch (r.lint) {
    case "eslint":       lint = `${run} eslint`;                     lint_ext = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]; break;
    case "biome":        lint = `${run} biome check`;                lint_ext = [".ts", ".tsx", ".js", ".jsx"]; break;
    case "phpstan":      lint = "./vendor/bin/phpstan analyse";       lint_ext = [".php"]; break;
    case "phpcs":        lint = "./vendor/bin/phpcs";                 lint_ext = [".php"]; break;
    case "php-cs-fixer": lint = "./vendor/bin/php-cs-fixer check";   lint_ext = [".php"]; break;
    case "psalm":        lint = "./vendor/bin/psalm";                 lint_ext = [".php"]; break;
    case "flake8":       lint = "python -m flake8";                  lint_ext = [".py"]; break;
    case "ruff":         lint = "python -m ruff check";              lint_ext = [".py"]; break;
    case "pylint":       lint = "python -m pylint";                  lint_ext = [".py"]; break;
    case "golangci-lint": lint = "golangci-lint run";                lint_ext = [".go"]; break;
    case "rubocop":      lint = "bundle exec rubocop";               lint_ext = [".rb"]; break;
    case "credo":        lint = "mix credo";                         lint_ext = [".ex", ".exs"]; break;
    case "clj-kondo":    lint = "clj-kondo --lint";                  lint_ext = [".clj", ".cljs", ".cljc"]; break;
    case "swiftlint":    lint = "swiftlint lint";                    lint_ext = [".swift"]; break;
    case "deno-lint":    lint = "deno lint";                         lint_ext = [".ts", ".tsx", ".js", ".jsx"]; break;
    case "dart-analyze": lint = "dart analyze";                      lint_ext = [".dart"]; break;
  }

  let typecheck = null;
  switch (r.language) {
    case "typescript":
      // Deno has its own checker; Node/browser TS uses tsc
      typecheck = r.package_manager === "deno" ? "deno check" : `${run} tsc --noEmit`;
      break;
    case "go":      typecheck = "go vet ./..."; break;
    case "rust":    typecheck = "cargo check"; break;
    case "dotnet":  typecheck = "dotnet build --no-restore"; break;
    case "elixir":  typecheck = "mix compile --warnings-as-errors"; break;
    case "scala":   typecheck = r.package_manager === "sbt" ? "sbt compile" : "mvn compile"; break;
    case "swift":   typecheck = "swift build"; break;
    case "dart":    typecheck = r.framework === "flutter" ? "flutter analyze" : "dart analyze"; break;
  }

  let test = null;
  let test_files = false; // whether to pass changed files to the test command
  switch (r.test_runner) {
    case "jest":       test = `${run} jest --findRelatedTests`; test_files = true; break;
    case "vitest":     test = `${run} vitest run`; break;
    case "mocha":      test = `${run} mocha`; break;
    case "phpunit":    test = "./vendor/bin/phpunit"; break;
    case "pest":       test = "./vendor/bin/pest"; break;
    case "pytest":     test = "python -m pytest"; break;
    case "rspec":      test = "bundle exec rspec"; break;
    case "exunit":     test = "mix test"; break;
    case "sbt-test":   test = "sbt test"; break;
    case "scalatest":  test = "sbt test"; break;
    case "munit":      test = "sbt test"; break;
    case "lein-test":  test = "lein test"; break;
    case "clj-test":   test = "clj -M:test"; break;
    case "swift-test": test = "swift test"; break;
    case "flutter-test": test = "flutter test"; break;
    case "dart-test":  test = "dart test"; break;
    case "deno-test":  test = "deno test"; break;
  }

  if (!lint && !typecheck && !test) return null;
  return { lint, lint_ext, typecheck, test, test_files };
}

module.exports = { detectStack };
