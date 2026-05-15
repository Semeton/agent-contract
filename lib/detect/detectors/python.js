"use strict";

const FRAMEWORK_PATTERNS = [
  { pattern: /^django[=~<>!]?/im, label: "django" },
  { pattern: /^flask[=~<>!]?/im, label: "flask" },
  { pattern: /^fastapi[=~<>!]?/im, label: "fastapi" },
  { pattern: /^starlette[=~<>!]?/im, label: "starlette" },
  { pattern: /^tornado[=~<>!]?/im, label: "tornado" },
];

const TEST_PATTERNS = [
  { pattern: /^pytest[=~<>!]?/im, label: "pytest" },
  { pattern: /^nose2[=~<>!]?/im, label: "nose2" },
];

const ORM_PATTERNS = [
  { pattern: /^sqlalchemy[=~<>!]?/im, label: "sqlalchemy" },
  { pattern: /^django[=~<>!]?/im, label: "django-orm" },
  { pattern: /^tortoise-orm[=~<>!]?/im, label: "tortoise" },
  { pattern: /^peewee[=~<>!]?/im, label: "peewee" },
];

async function detect(ctx) {
  const hasPyproject = ctx.exists("pyproject.toml");
  const hasReq = ctx.exists("requirements.txt");
  const hasPipfile = ctx.exists("Pipfile");
  const hasSetup = ctx.exists("setup.py") || ctx.exists("setup.cfg");

  if (!hasPyproject && !hasReq && !hasPipfile && !hasSetup) return null;

  const evidence = [];
  let depBlob = "";

  if (hasPyproject) {
    depBlob += ctx.read("pyproject.toml") || "";
    evidence.push({ source: "manifest", key: "pyproject.toml", value: "found" });
  }
  if (hasReq) {
    depBlob += "\n" + (ctx.read("requirements.txt") || "");
    evidence.push({ source: "manifest", key: "requirements.txt", value: "found" });
  }
  if (hasPipfile) {
    depBlob += "\n" + (ctx.read("Pipfile") || "");
    evidence.push({ source: "manifest", key: "Pipfile", value: "found" });
  }

  // ---- package manager ----
  let pm = null;
  if (ctx.exists("poetry.lock")) pm = "poetry";
  else if (ctx.exists("uv.lock")) pm = "uv";
  else if (ctx.exists("Pipfile.lock")) pm = "pipenv";
  else if (ctx.exists("pdm.lock")) pm = "pdm";
  else if (hasReq) pm = "pip";
  if (pm) evidence.push({ source: "lockfile", key: "package_manager", value: pm });

  // ---- framework ----
  let framework = null;
  for (const { pattern, label } of FRAMEWORK_PATTERNS) {
    if (pattern.test(depBlob)) {
      framework = label;
      evidence.push({ source: "dependency", key: "framework", value: label });
      break;
    }
  }

  // ---- ORM ----
  let orm = null;
  for (const { pattern, label } of ORM_PATTERNS) {
    if (pattern.test(depBlob)) {
      orm = label;
      break;
    }
  }

  // ---- test runner ----
  let test_runner = null;
  for (const { pattern, label } of TEST_PATTERNS) {
    if (pattern.test(depBlob)) {
      test_runner = label;
      break;
    }
  }

  // ---- entry points ----
  const entry_points = [];
  for (const c of ["main.py", "app.py", "manage.py", "src/main.py"]) {
    if (ctx.exists(c)) entry_points.push(c);
  }

  let score = 55;
  if (framework) score += 20;
  if (orm) score += 10;
  if (test_runner) score += 5;
  if (pm) score += 5;

  return {
    language: "python",
    runtime: "python",
    framework,
    package_manager: pm,
    test_runner,
    build: null,
    lint: /ruff/i.test(depBlob) ? "ruff" : /flake8/i.test(depBlob) ? "flake8" : null,
    formatter: /black/i.test(depBlob) ? "black" : /ruff/i.test(depBlob) ? "ruff" : null,
    db: null,
    orm,
    entry_points,
    evidence,
    score,
  };
}

module.exports = { detect };
