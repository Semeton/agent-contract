"use strict";

async function detect(ctx) {
  if (!ctx.exists("Cargo.toml")) return null;

  const cargo = ctx.read("Cargo.toml") || "";
  const evidence = [{ source: "manifest", key: "Cargo.toml", value: "found" }];

  let framework = null;
  if (/^axum\s*=/m.test(cargo)) framework = "axum";
  else if (/^actix-web\s*=/m.test(cargo)) framework = "actix-web";
  else if (/^rocket\s*=/m.test(cargo)) framework = "rocket";

  return {
    language: "rust",
    runtime: "rust",
    framework,
    package_manager: "cargo",
    test_runner: "cargo test",
    build: "cargo build --release",
    lint: "clippy",
    formatter: "rustfmt",
    db: null,
    orm: /^sqlx\s*=/m.test(cargo) ? "sqlx" : /^diesel\s*=/m.test(cargo) ? "diesel" : null,
    entry_points: ctx.exists("src/main.rs") ? ["src/main.rs"] : [],
    evidence,
    score: 75 + (framework ? 10 : 0),
  };
}

module.exports = { detect };
