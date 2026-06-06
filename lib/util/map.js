"use strict";

const fs = require("fs");
const path = require("path");

const IGNORE = new Set([
  ".git", "node_modules", "vendor", ".agent", "dist", "build", "out",
  "__pycache__", ".venv", "venv", "env", "target", ".next", ".nuxt",
  "coverage", ".nyc_output", "tmp", "temp",
]);

const SOURCE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".php", ".py", ".go", ".rb", ".rs", ".java", ".cs",
  ".ex", ".exs", ".scala", ".kt", ".swift", ".dart",
]);

const FILE_LIST_DEPTH = 2;
const FILE_CAP = 8;
const DIR_CROWDED = 20;

function countSourceFiles(cwd, limit) {
  let count = 0;
  const cap = limit || 500;
  function walk(dir, depth) {
    if (depth > 8 || count >= cap) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".") || IGNORE.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else if (e.isFile() && SOURCE_EXTS.has(path.extname(e.name))) {
        count++;
      }
    }
  }
  walk(cwd, 0);
  return count;
}

function isGreenfield(cwd) {
  return countSourceFiles(cwd, 5) < 5;
}

function buildDirTree(cwd, maxDepth) {
  const depth = maxDepth || 3;
  const lines = [];

  function sourceFilesIn(dir) {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && SOURCE_EXTS.has(path.extname(e.name)));
    } catch { return []; }
  }

  function walk(dir, d, prefix) {
    if (d > depth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const subdirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".") && !IGNORE.has(e.name));
    for (const dd of subdirs) {
      const subPath = path.join(dir, dd.name);
      if (d + 1 <= FILE_LIST_DEPTH) {
        const sub = sourceFilesIn(subPath);
        if (sub.length > DIR_CROWDED) {
          lines.push(prefix + dd.name + "/  (" + sub.length + " files)");
          walk(subPath, d + 1, prefix + "  ");
          continue;
        }
      }
      lines.push(prefix + dd.name + "/");
      walk(subPath, d + 1, prefix + "  ");
    }
    if (d <= FILE_LIST_DEPTH) {
      const files = entries.filter((e) => e.isFile() && SOURCE_EXTS.has(path.extname(e.name)));
      if (files.length > DIR_CROWDED) {
        lines.push(prefix + "(" + files.length + " source files)");
      } else if (files.length > 0) {
        const shown = files.slice(0, FILE_CAP);
        for (const f of shown) lines.push(prefix + f.name);
        if (files.length > FILE_CAP) lines.push(prefix + "... " + (files.length - FILE_CAP) + " more");
      }
    }
  }

  walk(cwd, 0, "");
  return lines;
}

function findKeyFiles(cwd) {
  const candidates = [
    "package.json", "composer.json", "pyproject.toml", "go.mod",
    "Cargo.toml", "build.sbt", "mix.exs", "Gemfile",
    "tsconfig.json", ".env.example", "Dockerfile", "docker-compose.yml",
    "artisan", "manage.py",
  ];
  return candidates.filter((f) => fs.existsSync(path.join(cwd, f)));
}

function extractDeps(cwd, detection) {
  if (!detection) return [];
  const lang = detection.language;
  try {
    if ((lang === "typescript" || lang === "javascript") && fs.existsSync(path.join(cwd, "package.json"))) {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
      return Object.keys(pkg.dependencies || {}).slice(0, 12);
    }
    if (lang === "php" && fs.existsSync(path.join(cwd, "composer.json"))) {
      const comp = JSON.parse(fs.readFileSync(path.join(cwd, "composer.json"), "utf8"));
      return Object.keys(comp.require || {}).filter((k) => k !== "php").slice(0, 12);
    }
  } catch {}
  return [];
}

function buildCodebaseMap(cwd, detection) {
  const greenfield = isGreenfield(cwd);
  const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
  const lang = (detection && detection.language) || "unknown";
  const framework = (detection && detection.framework) || null;

  const lines = [
    "# Codebase Map",
    "<!-- agent-contract:codebase-map -->",
    "Generated: " + ts,
    "Type: " + (greenfield ? "greenfield" : "existing"),
    "Language: " + lang,
  ];
  if (framework) lines.push("Framework: " + framework);
  lines.push("");

  if (greenfield) {
    lines.push("## Summary");
    lines.push("No source files detected — this is a new codebase.");
    lines.push("");
    lines.push("## Agent Usage Protocol");
    lines.push("Greenfield project. No existing code to index.");
    lines.push("Architect the solution from scratch according to `.agent/conventions.yaml`.");
    lines.push("Log every architectural decision to `.agent/memory/decisions.jsonl`.");
  } else {
    const fileCount = countSourceFiles(cwd);
    lines.push("## Summary");
    lines.push("~" + fileCount + " source files detected.");
    lines.push("");

    const tree = buildDirTree(cwd, 3);
    if (tree.length > 0) {
      lines.push("## Directory Structure");
      lines.push(...tree);
      lines.push("");
    }

    const entryPoints = (detection && detection.entry_points) || [];
    if (entryPoints.length > 0) {
      lines.push("## Entry Points");
      for (const ep of entryPoints) lines.push("- " + ep);
      lines.push("");
    }

    const keyFiles = findKeyFiles(cwd);
    if (keyFiles.length > 0) {
      lines.push("## Key Config Files");
      for (const f of keyFiles) lines.push("- " + f);
      lines.push("");
    }

    const deps = extractDeps(cwd, detection);
    if (deps.length > 0) {
      lines.push("## Top-Level Dependencies");
      lines.push(deps.join(", "));
      lines.push("");
    }

    lines.push("## Agent Usage Protocol");
    lines.push("1. Read this file BEFORE reading individual source files.");
    lines.push("2. Use the directory structure above to decide which files to read — do not scan the full codebase.");
    lines.push("3. When a file path or symbol from memory seems stale, grep for it before trusting it.");
    lines.push("4. This map refreshes on every `agent-contract init` or `agent-contract update`.");
  }

  lines.push("<!-- /agent-contract:codebase-map -->");
  return lines.join("\n") + "\n";
}

module.exports = { buildCodebaseMap, isGreenfield };
