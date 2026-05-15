"use strict";

const fs = require("fs");
const path = require("path");

const SOURCE_EXTENSIONS = {
  typescript:  [".ts", ".tsx"],
  javascript:  [".js", ".jsx", ".mjs", ".cjs"],
  php:         [".php"],
  python:      [".py"],
  go:          [".go"],
  ruby:        [".rb"],
  rust:        [".rs"],
  java:        [".java"],
  kotlin:      [".kt"],
  csharp:      [".cs"],
};

const IGNORE_DIRS = new Set([
  ".git", "node_modules", "vendor", ".agent", "dist", "build", "out",
  "__pycache__", ".venv", "venv", "env", "target", ".next", ".nuxt",
  "coverage", ".nyc_output", "tmp", "temp",
]);

async function learnConventions(cwd, detection) {
  const lang = detection && detection.language !== "unknown" ? detection.language : null;
  const exts = lang
    ? (SOURCE_EXTENSIONS[lang] || SOURCE_EXTENSIONS.javascript)
    : [".ts", ".js", ".php", ".py"];

  const allSourceFiles = walkFiles(cwd, exts);
  const sampled = sampleFiles(allSourceFiles, 20);

  if (sampled.length === 0) {
    return { sample_size: 0, style: null, errors: null, naming: null, tests: null };
  }

  const contents = sampled
    .map((f) => ({
      path: f,
      rel: path.relative(cwd, f),
      content: readSafe(f),
    }))
    .filter((f) => f.content);

  return {
    sample_size: contents.length,
    style:  analyzeStyle(contents),
    errors: analyzeErrors(contents),
    naming: analyzeNaming(allSourceFiles),
    tests:  analyzeTests(cwd, allSourceFiles),
  };
}

// ─── File walking ────────────────────────────────────────────────────────────

function walkFiles(cwd, exts, maxDepth = 8) {
  const results = [];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || IGNORE_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() && exts.includes(path.extname(entry.name))) {
        results.push(full);
      }
    }
  }
  walk(cwd, 0);
  return results;
}

// Breadth-first sample: pick files spread across directories.
function sampleFiles(files, n) {
  if (files.length <= n) return files;
  const byDir = new Map();
  for (const f of files) {
    const d = path.dirname(f);
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d).push(f);
  }
  const result = [];
  const perDir = Math.max(1, Math.floor(n / byDir.size));
  for (const dirFiles of byDir.values()) {
    result.push(...dirFiles.slice(0, perDir));
    if (result.length >= n) break;
  }
  return result.slice(0, n);
}

function readSafe(f) {
  try { return fs.readFileSync(f, "utf8"); } catch { return ""; }
}

// ─── Style: class-based vs functional ────────────────────────────────────────

function analyzeStyle(contents) {
  let classFiles = 0;
  let funcFiles = 0;

  for (const { content } of contents) {
    const hasClass = /\bclass\s+\w/.test(content);
    const hasExportedFunc =
      /export\s+(async\s+)?function\s+\w/.test(content) ||
      /export\s+const\s+\w+\s*=\s*(async\s*)?\(/.test(content) ||
      /^def\s+\w/m.test(content) ||       // Python module-level functions
      /^func\s+\w/m.test(content);         // Go functions

    if (hasClass) classFiles++;
    else if (hasExportedFunc) funcFiles++;
  }

  const total = classFiles + funcFiles;
  if (total === 0) return null;

  const classRatio = classFiles / total;
  let paradigm, confidence;
  if (classRatio >= 0.6) {
    paradigm = "oop";
    confidence = classRatio >= 0.8 ? "high" : "medium";
  } else if (classRatio <= 0.4) {
    paradigm = "functional";
    confidence = classRatio <= 0.2 ? "high" : "medium";
  } else {
    paradigm = "mixed";
    confidence = "medium";
  }

  return { paradigm, confidence, evidence: { class_files: classFiles, func_files: funcFiles } };
}

// ─── Errors: try/catch density + custom error types ──────────────────────────

function analyzeErrors(contents) {
  let tryCatchFiles = 0;
  let customErrorClasses = 0;

  for (const { content } of contents) {
    if (/\btry\s*[\({]/.test(content) || /\btry:/.test(content)) tryCatchFiles++;
    if (/class\s+\w+(Error|Exception)\b/.test(content)) customErrorClasses++;
  }

  if (contents.length === 0) return null;

  const density = tryCatchFiles / contents.length;
  let style, confidence;

  if (customErrorClasses >= 2) {
    style = "typed_exceptions";
    confidence = customErrorClasses >= 4 ? "high" : "medium";
  } else if (density >= 0.5) {
    style = "try_catch";
    confidence = density >= 0.7 ? "high" : "medium";
  } else {
    style = "unstructured";
    confidence = "low";
  }

  return {
    style,
    confidence,
    evidence: { try_catch_files: tryCatchFiles, custom_error_classes: customErrorClasses },
  };
}

// ─── Naming: camelCase / PascalCase / snake_case / kebab-case ────────────────

function analyzeNaming(files) {
  const counts = { camelCase: 0, PascalCase: 0, snake_case: 0, "kebab-case": 0 };

  for (const f of files) {
    // Strip extension(s) so "user-service.spec.ts" → "user-service"
    let name = path.basename(f).replace(/(\.(spec|test|stories))?\.[^.]+$/, "");
    if (!name || name.length < 2) continue;

    if (/^[A-Z][a-zA-Z0-9]*$/.test(name) && /[a-z]/.test(name)) {
      counts.PascalCase++;
    } else if (/^[a-z][a-zA-Z0-9]*$/.test(name) && /[A-Z]/.test(name)) {
      counts.camelCase++;
    } else if (/^[a-z][a-z0-9_]+$/.test(name) && name.includes("_")) {
      counts.snake_case++;
    } else if (/^[a-z][a-z0-9-]+$/.test(name) && name.includes("-")) {
      counts["kebab-case"]++;
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  const [convention, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const confidence = count / total >= 0.7 ? "high" : "medium";

  return { convention, confidence, evidence: counts };
}

// ─── Tests: colocation pattern ────────────────────────────────────────────────

function analyzeTests(cwd, allSourceFiles) {
  // *.spec.* or *.test.* files sitting next to source
  const colocatedSpecs = allSourceFiles.filter((f) =>
    /\.(spec|test)\.[a-z]+$/.test(path.basename(f))
  );

  const hasTestsSubdir = dirExistsAnywhere(cwd, "__tests__");
  const hasSeparateTree =
    fs.existsSync(path.join(cwd, "tests")) ||
    fs.existsSync(path.join(cwd, "test")) ||
    fs.existsSync(path.join(cwd, "spec"));

  let pattern, confidence;
  if (colocatedSpecs.length > 0) {
    pattern = "colocated_spec";
    confidence = colocatedSpecs.length >= 3 ? "high" : "medium";
  } else if (hasTestsSubdir) {
    pattern = "colocated_dir";
    confidence = "high";
  } else if (hasSeparateTree) {
    pattern = "separate_tree";
    confidence = "high";
  } else {
    return null;
  }

  return { pattern, confidence, evidence: { spec_files: colocatedSpecs.length } };
}

function dirExistsAnywhere(cwd, name, maxDepth = 5) {
  function check(dir, depth) {
    if (depth > maxDepth) return false;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === name) return true;
      if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        if (check(path.join(dir, entry.name), depth + 1)) return true;
      }
    }
    return false;
  }
  return check(cwd, 0);
}

module.exports = { learnConventions };
