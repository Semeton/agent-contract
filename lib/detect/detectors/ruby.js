"use strict";

async function detect(ctx) {
  if (!ctx.exists("Gemfile")) return null;
  const gemfile = ctx.read("Gemfile") || "";
  const evidence = [{ source: "manifest", key: "Gemfile", value: "found" }];

  let framework = null;
  if (/gem\s+['"]rails['"]/m.test(gemfile)) framework = "rails";
  else if (/gem\s+['"]sinatra['"]/m.test(gemfile)) framework = "sinatra";

  return {
    language: "ruby",
    runtime: "ruby",
    framework,
    package_manager: "bundler",
    test_runner: /rspec/.test(gemfile) ? "rspec" : /minitest/.test(gemfile) ? "minitest" : null,
    build: null,
    lint: /rubocop/.test(gemfile) ? "rubocop" : null,
    formatter: null,
    db: null,
    orm: framework === "rails" ? "active-record" : null,
    entry_points: ctx.exists("config.ru") ? ["config.ru"] : [],
    evidence,
    score: 70 + (framework ? 15 : 0),
  };
}

module.exports = { detect };
