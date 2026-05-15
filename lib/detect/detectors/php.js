"use strict";

const FRAMEWORK_HINTS = {
  "laravel/framework": "laravel",
  "symfony/framework-bundle": "symfony",
  "slim/slim": "slim",
  "cakephp/cakephp": "cakephp",
  "yiisoft/yii2": "yii2",
};

const ORM_HINTS = {
  "doctrine/orm": "doctrine",
  // Laravel ships Eloquent inside laravel/framework
};

const DB_HINTS = {
  "doctrine/dbal": "rdbms",
};

const TEST_HINTS = {
  "phpunit/phpunit": "phpunit",
  "pestphp/pest": "pest",
};

const LINT_HINTS = {
  "squizlabs/php_codesniffer": "phpcs",
  "friendsofphp/php-cs-fixer": "php-cs-fixer",
  "phpstan/phpstan": "phpstan",
  "vimeo/psalm": "psalm",
};

async function detect(ctx) {
  if (!ctx.exists("composer.json")) return null;

  const composer = ctx.readJSON("composer.json");
  if (!composer) return null;

  const deps = {
    ...(composer.require || {}),
    ...(composer["require-dev"] || {}),
  };

  const evidence = [{ source: "manifest", key: "composer.json", value: "found" }];

  // ---- language + runtime ----
  let runtime = "php";
  if (deps.php) {
    runtime = `php@${cleanVersion(deps.php)}`;
    evidence.push({ source: "manifest", key: "php_version", value: deps.php });
  }

  // ---- package manager ----
  const pm = ctx.exists("composer.lock") ? "composer" : "composer";
  if (ctx.exists("composer.lock")) {
    evidence.push({ source: "lockfile", key: "package_manager", value: "composer.lock" });
  }

  // ---- framework ----
  let framework = null;
  for (const [dep, label] of Object.entries(FRAMEWORK_HINTS)) {
    if (deps[dep]) {
      framework = `${label}@${cleanVersion(deps[dep])}`;
      evidence.push({ source: "dependency", key: "framework", value: dep });
      break;
    }
  }

  // ---- ORM (Laravel: Eloquent inferred) ----
  let orm = null;
  if (framework && framework.startsWith("laravel")) {
    orm = "eloquent";
    evidence.push({ source: "inference", key: "orm", value: "eloquent_via_laravel" });
  }
  for (const [dep, label] of Object.entries(ORM_HINTS)) {
    if (deps[dep]) {
      orm = label;
      evidence.push({ source: "dependency", key: "orm", value: dep });
      break;
    }
  }

  // ---- DB: read .env.example for DB_CONNECTION if Laravel ----
  let db = null;
  if (framework && framework.startsWith("laravel")) {
    const envFiles = [".env", ".env.example"];
    for (const f of envFiles) {
      const content = ctx.read(f);
      if (content) {
        const m = content.match(/^DB_CONNECTION\s*=\s*(\w+)/m);
        if (m) {
          db = mapLaravelDb(m[1]);
          evidence.push({ source: "file", key: f, value: `DB_CONNECTION=${m[1]}` });
          break;
        }
      }
    }
  }
  if (!db) {
    for (const [dep, label] of Object.entries(DB_HINTS)) {
      if (deps[dep]) {
        db = label;
        break;
      }
    }
  }

  // ---- test runner ----
  let test_runner = null;
  for (const [dep, label] of Object.entries(TEST_HINTS)) {
    if (deps[dep]) {
      test_runner = label;
      evidence.push({ source: "dependency", key: "test_runner", value: dep });
      break;
    }
  }

  // ---- lint ----
  let lint = null;
  for (const [dep, label] of Object.entries(LINT_HINTS)) {
    if (deps[dep]) {
      lint = label;
      break;
    }
  }

  // ---- build ----
  let build = null;
  if (framework && framework.startsWith("laravel")) {
    // Laravel apps usually have a JS build step too
    if (ctx.exists("vite.config.js") || ctx.exists("vite.config.ts")) {
      build = "npm run build && php artisan optimize";
    } else {
      build = "php artisan optimize";
    }
  } else if (composer.scripts && composer.scripts.build) {
    build = "composer run-script build";
  }

  // ---- entry points ----
  const entry_points = [];
  const candidates = ["public/index.php", "index.php", "artisan"];
  for (const c of candidates) if (ctx.exists(c)) entry_points.push(c);

  // ---- score ----
  let score = 60;
  if (framework) score += 20;
  if (orm) score += 10;
  if (test_runner) score += 5;

  return {
    language: "php",
    runtime,
    framework,
    package_manager: pm,
    test_runner,
    build,
    lint,
    formatter: null,
    db,
    orm,
    entry_points,
    evidence,
    score,
  };
}

function cleanVersion(v) {
  return String(v).replace(/^[\^~>=<\s]+/, "").trim();
}

function mapLaravelDb(conn) {
  const map = {
    mysql: "mysql",
    pgsql: "postgresql",
    sqlite: "sqlite",
    sqlsrv: "mssql",
    mongodb: "mongodb",
  };
  return map[conn] || conn;
}

module.exports = { detect };
