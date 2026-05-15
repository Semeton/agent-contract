"use strict";

const fs = require("fs");
const path = require("path");

async function detect(ctx) {
  const top = ctx.listTop();
  const hasSln = top.some((f) => f.endsWith(".sln"));
  const hasCsproj = walkForExt(ctx.cwd, ".csproj", 3);
  if (!hasSln && hasCsproj.length === 0) return null;

  const evidence = [];
  if (hasSln) evidence.push({ source: "manifest", key: "solution", value: "found" });
  if (hasCsproj.length) evidence.push({ source: "manifest", key: "csproj_count", value: String(hasCsproj.length) });

  let framework = null;
  for (const proj of hasCsproj.slice(0, 5)) {
    const content = (() => {
      try { return fs.readFileSync(proj, "utf8"); } catch { return ""; }
    })();
    if (/Microsoft\.NET\.Sdk\.Web/i.test(content) || /AspNetCore/i.test(content)) {
      framework = "aspnetcore";
      break;
    }
  }

  return {
    language: "csharp",
    runtime: "dotnet",
    framework,
    package_manager: "nuget",
    test_runner: null,
    build: "dotnet build",
    lint: null,
    formatter: null,
    db: null,
    orm: null,
    entry_points: [],
    evidence,
    score: 70 + (framework ? 15 : 0),
  };
}

function walkForExt(root, ext, maxDepth) {
  const out = [];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "bin" || e.name === "obj") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.name.endsWith(ext)) out.push(full);
    }
  }
  walk(root, 0);
  return out;
}

module.exports = { detect };
