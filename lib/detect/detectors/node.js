"use strict";

const FRAMEWORK_HINTS = {
  // map dep name → framework label
  "@nestjs/core": "nestjs",
  next: "nextjs",
  "react-scripts": "create-react-app",
  vite: "vite",
  express: "express",
  fastify: "fastify",
  koa: "koa",
  "@remix-run/node": "remix",
  "@sveltejs/kit": "sveltekit",
  nuxt: "nuxt",
  "@nuxt/kit": "nuxt",
  hono: "hono",
};

const ORM_HINTS = {
  typeorm: "typeorm",
  prisma: "prisma",
  "@prisma/client": "prisma",
  sequelize: "sequelize",
  mongoose: "mongoose",
  "drizzle-orm": "drizzle",
  knex: "knex",
};

const DB_HINTS = {
  pg: "postgresql",
  "pg-promise": "postgresql",
  postgres: "postgresql",
  mysql: "mysql",
  mysql2: "mysql",
  mongodb: "mongodb",
  redis: "redis",
  ioredis: "redis",
  sqlite3: "sqlite",
  "better-sqlite3": "sqlite",
};

const TEST_HINTS = {
  jest: "jest",
  vitest: "vitest",
  mocha: "mocha",
  "@japa/runner": "japa",
  ava: "ava",
};

const LINT_HINTS = {
  eslint: "eslint",
  biome: "biome",
  "@biomejs/biome": "biome",
  xo: "xo",
};

const FORMATTER_HINTS = {
  prettier: "prettier",
  "@biomejs/biome": "biome",
};

async function detect(ctx) {
  if (!ctx.exists("package.json")) return null;

  const pkg = ctx.readJSON("package.json");
  if (!pkg) return null;

  const allDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.peerDependencies || {}),
  };

  const isTypeScript = ctx.exists("tsconfig.json") || !!allDeps.typescript;
  const language = isTypeScript ? "typescript" : "javascript";

  const evidence = [
    { source: "manifest", key: "package.json", value: "found" },
  ];

  // ---- package manager ----
  let pm = null;
  if (ctx.exists("pnpm-lock.yaml")) {
    pm = "pnpm";
    evidence.push({ source: "lockfile", key: "package_manager", value: "pnpm-lock.yaml" });
  } else if (ctx.exists("yarn.lock")) {
    pm = "yarn";
    evidence.push({ source: "lockfile", key: "package_manager", value: "yarn.lock" });
  } else if (ctx.exists("bun.lockb") || ctx.exists("bun.lock")) {
    pm = "bun";
    evidence.push({ source: "lockfile", key: "package_manager", value: "bun.lock" });
  } else if (ctx.exists("package-lock.json")) {
    pm = "npm";
    evidence.push({ source: "lockfile", key: "package_manager", value: "package-lock.json" });
  } else if (pkg.packageManager) {
    pm = String(pkg.packageManager).split("@")[0];
    evidence.push({ source: "manifest", key: "packageManager", value: pkg.packageManager });
  }

  // ---- runtime ----
  let runtime = null;
  if (pm === "bun") {
    runtime = "bun";
  } else if (pkg.engines && pkg.engines.node) {
    runtime = `node@${pkg.engines.node.replace(/[^\d.]/g, "")}`;
  } else {
    runtime = "node";
  }

  // ---- framework ----
  let framework = null;
  for (const [dep, label] of Object.entries(FRAMEWORK_HINTS)) {
    if (allDeps[dep]) {
      framework = `${label}@${cleanVersion(allDeps[dep])}`;
      evidence.push({ source: "dependency", key: "framework", value: dep });
      break;
    }
  }

  // ---- ORM + DB ----
  let orm = null;
  for (const [dep, label] of Object.entries(ORM_HINTS)) {
    if (allDeps[dep]) {
      orm = label;
      evidence.push({ source: "dependency", key: "orm", value: dep });
      break;
    }
  }

  let db = null;
  for (const [dep, label] of Object.entries(DB_HINTS)) {
    if (allDeps[dep]) {
      db = label;
      evidence.push({ source: "dependency", key: "db", value: dep });
      break;
    }
  }

  // Prisma is special: db comes from schema.prisma, not deps
  if (orm === "prisma" && !db) {
    const schema = ctx.read("prisma/schema.prisma");
    if (schema) {
      const m = schema.match(/provider\s*=\s*"(\w+)"/);
      if (m) {
        db = m[1];
        evidence.push({ source: "file", key: "prisma_provider", value: m[1] });
      }
    }
  }

  // ---- test runner ----
  let test_runner = null;
  for (const [dep, label] of Object.entries(TEST_HINTS)) {
    if (allDeps[dep]) {
      test_runner = label;
      evidence.push({ source: "dependency", key: "test_runner", value: dep });
      break;
    }
  }

  // ---- lint + formatter ----
  let lint = null;
  for (const [dep, label] of Object.entries(LINT_HINTS)) {
    if (allDeps[dep]) {
      lint = label;
      break;
    }
  }
  let formatter = null;
  for (const [dep, label] of Object.entries(FORMATTER_HINTS)) {
    if (allDeps[dep]) {
      formatter = label;
      break;
    }
  }

  // ---- build script ----
  let build = null;
  if (pkg.scripts) {
    if (pkg.scripts.build) build = `${pm || "npm"} run build`;
    else if (framework && framework.startsWith("nestjs")) build = "nest build";
    else if (framework && framework.startsWith("nextjs")) build = "next build";
  }

  // ---- entry points ----
  const entry_points = [];
  const candidates = [
    "src/main.ts",
    "src/main.js",
    "src/index.ts",
    "src/index.js",
    "index.ts",
    "index.js",
    "server.ts",
    "server.js",
    "app/page.tsx",
    "pages/index.tsx",
  ];
  for (const c of candidates) {
    if (ctx.exists(c)) entry_points.push(c);
  }
  if (pkg.main && ctx.exists(pkg.main)) entry_points.push(pkg.main);

  // ---- score: how confident are we this is the primary stack? ----
  let score = 60; // has package.json
  if (framework) score += 20;
  if (orm) score += 10;
  if (test_runner) score += 5;
  if (pm) score += 5;

  return {
    language,
    runtime,
    framework,
    package_manager: pm,
    test_runner,
    build,
    lint,
    formatter,
    db,
    orm,
    entry_points: dedupe(entry_points),
    evidence,
    score,
  };
}

function cleanVersion(v) {
  if (!v) return "";
  return String(v).replace(/^[\^~>=<\s]+/, "").trim();
}

function dedupe(arr) {
  return Array.from(new Set(arr));
}

module.exports = { detect };
