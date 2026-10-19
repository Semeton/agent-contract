"use strict";

// Layout discovery — where the source actually lives.
//
// frameworkScopes() maps a framework to its canonical layout (Next's app/, Flutter's
// lib/, Maven's src/main/). Real repos drift from that: Next with a src/ directory,
// Expo's app/ + components/, melos and Maven monorepos with one lib/ or src/main/ per
// module, and stack-less repos of scripts, static pages or IaC. When the canonical globs
// match less than half of a repo's tracked source files, every role is effectively
// read-only there — fail-closed, but useless.
//
// adjustScopes() keeps the framework globs and, only when they cover less than
// COVERAGE_FLOOR of the source files, adds globs for where the uncovered files are:
//   1. module manifests (pubspec.yaml, pom.xml, build.gradle, package.json) → each
//      module's own src/test folders, compressed to parent/*/… when ≥ 3 siblings;
//   2. remaining top-level folders that hold source files;
//   3. root-level source files, as *.ext.
// It never removes a framework glob, so a well-fitting repo gets exactly what it had.
// The result feeds the role YAMLs, so on an existing contract any addition is a
// widening and `update` asks for consent as usual.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const COVERAGE_FLOOR = 0.5;

const SKIP_DIRS = new Set([
  "node_modules", "vendor", ".git", "build", "dist", "target", "out", ".next", ".nuxt",
  ".svelte-kit", ".dart_tool", ".expo", "ios", "android", "macos", "windows", "linux", "web-build",
  "Pods", "coverage", "storage", "bootstrap", ".agent", ".agents", ".github", ".claude",
  ".cursor", ".idea", ".vscode", "__pycache__", ".venv", "venv", "env", "tmp", "log", "logs",
  "docs", "doc",
]);

const CODE_EXT = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "vue", "svelte", "astro", "php", "py", "rb", "go", "rs",
  "java", "kt", "kts", "scala", "clj", "cljs", "cs", "ex", "exs", "dart", "swift", "sh", "bash",
  "zsh", "html", "css", "scss", "sass", "less", "sql", "tf", "hcl", "lua", "groovy",
]);
const CONFIG_EXT = new Set(["json", "yaml", "yml", "toml", "xml", "properties", "ini", "conf", "tpl", "j2"]);
const TEST_SEG = /^(tests?|spec|specs|__tests__|e2e|integration_test)$/;
const COLOCATED_TEST = /\.(test|spec)\.[a-z0-9]+$/i;

// Per-language module layout: which manifest marks a module, and its src/test folders.
const MODULES = {
  dart:       { manifests: ["pubspec.yaml"], src: ["lib"], test: ["test", "integration_test"] },
  java:       { manifests: ["pom.xml", "build.gradle", "build.gradle.kts"], src: ["src/main"], test: ["src/test"] },
  javascript: { manifests: ["package.json"], src: ["src", "lib"], test: ["test", "tests", "__tests__"] },
};
MODULES.kotlin = MODULES.java;
MODULES.scala = MODULES.java;
MODULES.typescript = MODULES.javascript;

const cache = new Map();

function listFiles(cwd) {
  let files = [];
  try {
    const out = execFileSync("git", ["-C", cwd, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    });
    files = out.split("\0").filter(Boolean);
  } catch {
    files = [];
  }
  if (files.length === 0) files = walk(cwd, "", 0);
  return files.filter((f) => !f.split("/").slice(0, -1).some((seg) => SKIP_DIRS.has(seg)));
}

function walk(root, rel, depth) {
  if (depth > 5) return [];
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) out.push(...walk(root, r, depth + 1));
    } else if (e.isFile()) {
      out.push(r);
    }
  }
  return out;
}

function ext(f) {
  const b = path.basename(f);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i + 1).toLowerCase() : "";
}

// Same semantics as the bash `case` matching in scope-check.sh: `*` matches any run of
// characters including `/`, so `**` behaves like `*` and `src/**` covers all of src/.
const regexCache = new Map();
function globToRegex(glob) {
  if (regexCache.has(glob)) return regexCache.get(glob);
  let re = "";
  for (const ch of glob) {
    if (ch === "*") re += ".*";
    else if (ch === "?") re += ".";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const rx = new RegExp(`^${re}$`);
  regexCache.set(glob, rx);
  return rx;
}

function matchesAny(file, globs) {
  return globs.some((g) => globToRegex(g).test(file));
}

// ["packages/a/lib/**", "packages/b/lib/**", "packages/c/lib/**"] → ["packages/*/lib/**"]
// Greedy: try each inner segment as the wildcard, take the grouping that absorbs the most
// globs (at least 3), repeat. The first segment is never wildcarded, so a top-level
// grouping like */lib/** (which would also reach vendored trees) is never produced.
function compress(globs) {
  let pool = [...new Set(globs)];
  for (;;) {
    const groups = new Map();
    for (const g of pool) {
      const segs = g.split("/");
      for (let i = 1; i < segs.length - 1; i++) {
        if (segs[i] === "*" || segs[i] === "**") continue;
        const key = [...segs.slice(0, i), "*", ...segs.slice(i + 1)].join("/");
        if (!groups.has(key)) groups.set(key, new Set());
        groups.get(key).add(g);
      }
    }
    let best = null;
    for (const [key, members] of groups) {
      if (members.size >= 3 && (!best || members.size > best[1].size)) best = [key, members];
    }
    if (!best) break;
    pool = [...pool.filter((g) => !best[1].has(g)), best[0]];
  }
  return pool.sort();
}

function inferLanguage(files) {
  const names = new Set(files.map((f) => path.basename(f)));
  if (names.has("pubspec.yaml")) return "dart";
  if (names.has("pom.xml") || names.has("build.gradle") || names.has("build.gradle.kts")) return "java";
  if (names.has("package.json")) return "javascript";
  return "";
}

function moduleDirs(files, lang) {
  const spec = MODULES[lang];
  if (!spec) return [];
  return [...new Set(files.filter((f) => spec.manifests.includes(path.basename(f))).map((f) => path.dirname(f)))];
}

function moduleGlobs(files, lang) {
  const spec = MODULES[lang];
  if (!spec) return { src: [], test: [] };
  const dirs = moduleDirs(files, lang);
  const has = (prefix) => files.some((f) => f.startsWith(prefix + "/"));
  const src = [];
  const test = [];
  for (const d of dirs) {
    const base = d === "." ? "" : `${d}/`;
    for (const s of spec.src) if (has(`${base}${s}`)) src.push(`${base}${s}/**`);
    for (const t of spec.test) if (has(`${base}${t}`)) test.push(`${base}${t}/**`);
  }
  return { src: compress(src), test: compress(test) };
}

/**
 * Widen framework scopes to the repo's real layout when they cover too little of it.
 * @param {{src:string[], test:string[]}} base  framework/language defaults
 * @param {string} cwd                          repo root
 * @param {object} detection                    detectStack() result
 * @returns {{src:string[], test:string[], basis:string, coverage:number}}
 */
function adjustScopes(base, cwd, detection) {
  const key = `${cwd}\u0000${JSON.stringify(base)}`;
  if (cache.has(key)) return cache.get(key);

  const files = listFiles(cwd);
  const code = files.filter((f) => CODE_EXT.has(ext(f)));
  // Config-only repos (Helm, IaC, dashboards) have their "source" in YAML/JSON.
  const source = code.length >= 5 ? code : files.filter((f) => CODE_EXT.has(ext(f)) || CONFIG_EXT.has(ext(f)));
  const all = [...base.src, ...base.test];
  const covered = source.filter((f) => matchesAny(f, all)).length;
  const coverage = source.length ? covered / source.length : 1;

  let result = { src: base.src, test: base.test, basis: "framework", coverage };
  if (source.length > 0 && coverage < COVERAGE_FLOOR) {
    const lang = MODULES[(detection && detection.language) || ""] ? detection.language : inferLanguage(files);
    const mods = moduleGlobs(files, lang);
    const addSrc = [...mods.src];
    const addTest = [...mods.test];
    const covers = (f) => matchesAny(f, [...base.src, ...base.test, ...addSrc, ...addTest]);

    // Whatever is still uncovered: its top-level folder, or the file itself at the root.
    // Root files become *.ext only when they ARE the repo (scripts, a static page): in a
    // bash `case`, *.ts matches every .ts file at any depth, which is too broad for an app.
    // A stray file inside a module opens only that module's sub-folder (or the file), so
    // one script in core-services/x/ doesn't hand out all of core-services/**.
    const mdirs = moduleDirs(files, lang).filter((d) => d !== ".").sort((a, b) => b.length - a.length);
    const rootFiles = source.filter((f) => !f.includes("/") && !covers(f));
    const rootIsSource = rootFiles.length >= source.length / 2;
    for (const f of source) {
      if (covers(f)) continue;
      const mod = mdirs.find((d) => f.startsWith(d + "/"));
      const prefix = mod ? mod + "/" : "";
      const segs = f.slice(prefix.length).split("/");
      const testAt = segs.findIndex((s) => TEST_SEG.test(s));
      if (testAt >= 0 && testAt < segs.length - 1) {
        addTest.push(`${prefix}${segs.slice(0, testAt + 1).join("/")}/**`);
      } else if (segs.length > 1) {
        addSrc.push(`${prefix}${segs[0]}/**`);
      } else if (mod) {
        addSrc.push(f);
      } else {
        addSrc.push(rootIsSource ? `*.${ext(f)}` : f);
      }
    }
    if (source.some((f) => COLOCATED_TEST.test(f))) addTest.push("*.test.*", "*.spec.*");

    const src = [...base.src, ...compress([...new Set(addSrc)].filter((g) => !base.src.includes(g)))];
    const test = [...base.test, ...compress([...new Set(addTest)].filter((g) => !base.test.includes(g)))];
    const after = source.filter((f) => matchesAny(f, [...src, ...test])).length / source.length;
    result = { src, test, basis: "layout", coverage: after };
  }
  cache.set(key, result);
  return result;
}

module.exports = { adjustScopes, globToRegex, compress, COVERAGE_FLOOR };
