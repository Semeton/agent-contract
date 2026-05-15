"use strict";

const FRAMEWORK_HINTS = [
  { pattern: /vapor\/vapor/i,           label: "vapor" },
  { pattern: /hummingbird-project/i,    label: "hummingbird" },
  { pattern: /apple\/swift-nio/i,       label: "swift-nio" },
];

const DB_HINTS = [
  { pattern: /fluent-postgres-driver/i, label: "postgresql" },
  { pattern: /fluent-mysql-driver/i,    label: "mysql" },
  { pattern: /fluent-sqlite-driver/i,   label: "sqlite" },
];

async function detect(ctx) {
  if (!ctx.exists("Package.swift")) return null;

  const pkgSwift = ctx.read("Package.swift") || "";
  const evidence = [{ source: "manifest", key: "Package.swift", value: "found" }];

  // ---- framework ----
  let framework = null;
  for (const { pattern, label } of FRAMEWORK_HINTS) {
    if (pattern.test(pkgSwift)) {
      framework = label;
      evidence.push({ source: "dependency", key: "framework", value: label });
      break;
    }
  }

  // ---- db ----
  let db = null;
  let orm = null;
  for (const { pattern, label } of DB_HINTS) {
    if (pattern.test(pkgSwift)) {
      db = label;
      orm = "fluent";
      evidence.push({ source: "dependency", key: "db", value: label });
      break;
    }
  }

  // ---- lint ----
  const lint = ctx.exists(".swiftlint.yml") || ctx.exists(".swiftlint.yaml") ? "swiftlint" : null;

  // ---- runtime version ----
  const verMatch = pkgSwift.match(/swift-tools-version:\s*([\d.]+)/);
  const runtime = verMatch ? `swift@${verMatch[1]}` : "swift";

  // ---- score ----
  let score = 70;
  if (framework) score += 20;

  return {
    language: "swift",
    runtime,
    framework,
    package_manager: "swift-pm",
    test_runner: "swift-test",
    build: "swift build",
    lint,
    formatter: null,
    db,
    orm,
    entry_points: [],
    evidence,
    score,
  };
}

module.exports = { detect };
