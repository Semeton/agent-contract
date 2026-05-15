"use strict";

const FRAMEWORK_HINTS = [
  { pattern: /compojure/,                   label: "compojure" },
  { pattern: /ring\/ring/,                  label: "ring" },
  { pattern: /io\.pedestal\/pedestal\.service/, label: "pedestal" },
  { pattern: /metosin\/reitit/,             label: "reitit" },
  { pattern: /luminus/,                     label: "luminus" },
];

const DB_HINTS = [
  { pattern: /next\.jdbc/,                  label: "sql" },
  { pattern: /honeysql/,                    label: "sql" },
  { pattern: /mongodb\/mongodb-driver/,     label: "mongodb" },
];

async function detect(ctx) {
  const hasProjectClj = ctx.exists("project.clj");
  const hasDepsEdn = ctx.exists("deps.edn");
  if (!hasProjectClj && !hasDepsEdn) return null;

  const content = (ctx.read("project.clj") || "") + (ctx.read("deps.edn") || "");
  const evidence = [
    { source: "manifest", key: hasProjectClj ? "project.clj" : "deps.edn", value: "found" },
  ];

  // ---- framework ----
  let framework = null;
  for (const { pattern, label } of FRAMEWORK_HINTS) {
    if (pattern.test(content)) {
      framework = label;
      evidence.push({ source: "dependency", key: "framework", value: label });
      break;
    }
  }

  // ---- db ----
  let db = null;
  for (const { pattern, label } of DB_HINTS) {
    if (pattern.test(content)) {
      db = label;
      break;
    }
  }

  // ---- lint ----
  const hasKondo = ctx.exists(".clj-kondo") || /clj-kondo/.test(content);
  const lint = hasKondo ? "clj-kondo" : null;

  // ---- package manager / test runner ----
  const pm = hasProjectClj ? "leiningen" : "clojure-cli";
  const test_runner = hasProjectClj ? "lein-test" : "clj-test";

  // ---- score ----
  let score = 70;
  if (framework) score += 20;

  return {
    language: "clojure",
    runtime: "jvm",
    framework,
    package_manager: pm,
    test_runner,
    build: hasProjectClj ? "lein compile" : "clj -T:build compile",
    lint,
    formatter: null,
    db,
    orm: null,
    entry_points: [],
    evidence,
    score,
  };
}

module.exports = { detect };
