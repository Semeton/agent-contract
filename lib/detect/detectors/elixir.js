"use strict";

const FRAMEWORK_HINTS = {
  phoenix:   "phoenix",
  absinthe:  "absinthe",
  plug:      "plug",
  nerves:    "nerves",
};

const DB_HINTS = {
  postgrex:    "postgresql",
  myxql:       "mysql",
  sqlite_ecto3: "sqlite",
  tds:         "mssql",
};

async function detect(ctx) {
  if (!ctx.exists("mix.exs")) return null;

  const mixExs = ctx.read("mix.exs");
  if (!mixExs) return null;

  const evidence = [{ source: "manifest", key: "mix.exs", value: "found" }];

  // ---- framework ----
  let framework = null;
  for (const [dep, label] of Object.entries(FRAMEWORK_HINTS)) {
    if (new RegExp(`\\{:${dep},`).test(mixExs)) {
      const ver = extractMixVersion(mixExs, dep);
      framework = ver ? `${label}@${ver}` : label;
      evidence.push({ source: "dependency", key: "framework", value: dep });
      break;
    }
  }

  // ---- ORM ----
  const hasEcto = /{:ecto_sql,/.test(mixExs) || /{:ecto,/.test(mixExs);
  const orm = hasEcto ? "ecto" : null;
  if (orm) evidence.push({ source: "dependency", key: "orm", value: "ecto" });

  // ---- DB ----
  let db = null;
  for (const [dep, label] of Object.entries(DB_HINTS)) {
    if (new RegExp(`\\{:${dep.replace(/_/g, "_")},`).test(mixExs)) {
      db = label;
      evidence.push({ source: "dependency", key: "db", value: dep });
      break;
    }
  }
  // Fallback: check config files for database adapter
  if (!db) {
    const devConfig = ctx.read("config/dev.exs") || ctx.read("config/prod.exs") || "";
    if (/Ecto\.Adapters\.Postgres/.test(devConfig)) db = "postgresql";
    else if (/Ecto\.Adapters\.MyXQL/.test(devConfig)) db = "mysql";
  }

  // ---- lint ----
  const lint = /{:credo,/.test(mixExs) ? "credo" : null;

  // ---- formatter ----
  const formatter = ctx.exists(".formatter.exs") ? "mix-format" : null;

  // ---- test runner ----
  // ExUnit is the standard; always present
  const test_runner = "exunit";

  // ---- package manager / runtime ----
  const runtimeMatch = mixExs.match(/elixir:\s*"([^"]+)"/);
  const runtime = runtimeMatch ? `elixir@${runtimeMatch[1]}` : "elixir";

  // ---- entry points ----
  const entry_points = [];
  const appMatch = mixExs.match(/app:\s*:(\w+)/);
  if (appMatch) {
    const app = appMatch[1];
    const candidates = [
      `lib/${app}/application.ex`,
      `lib/${app}_web/endpoint.ex`,
      `lib/${app}.ex`,
    ];
    for (const c of candidates) if (ctx.exists(c)) entry_points.push(c);
  }

  // ---- score ----
  let score = 70; // mix.exs is a strong Elixir signal
  if (framework) score += 20;
  if (orm) score += 10;

  return {
    language: "elixir",
    runtime,
    framework,
    package_manager: "mix",
    test_runner,
    build: "mix compile",
    lint,
    formatter,
    db,
    orm,
    entry_points,
    evidence,
    score,
  };
}

function extractMixVersion(content, dep) {
  const m = content.match(new RegExp(`\\{:${dep},\\s*"([^"]+)"`));
  return m ? m[1].replace(/^[~>= ]+/, "") : null;
}

module.exports = { detect };
