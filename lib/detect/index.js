"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Detection result shape:
 * {
 *   language: string,
 *   runtime: string | null,
 *   framework: string | null,
 *   package_manager: string | null,
 *   test_runner: string | null,
 *   build: string | null,
 *   lint: string | null,
 *   formatter: string | null,
 *   db: string | null,
 *   orm: string | null,
 *   entry_points: string[],
 *   evidence: Array<{ source: string, key: string, value: string }>,
 *   confidence: "high" | "medium" | "low",
 *   unresolved: string[]   // fields we couldn't determine
 * }
 */

const DETECTORS = [
  require("./detectors/node"),
  require("./detectors/php"),
  require("./detectors/python"),
  require("./detectors/go"),
  require("./detectors/rust"),
  require("./detectors/java"),
  require("./detectors/ruby"),
  require("./detectors/dotnet"),
];

async function detectStack(cwd) {
  const ctx = createContext(cwd);
  const candidates = [];

  for (const detector of DETECTORS) {
    const result = await detector.detect(ctx);
    if (result && result.score > 0) {
      candidates.push(result);
    }
  }

  if (candidates.length === 0) {
    return unknownStack(cwd);
  }

  // Highest score wins. Ties broken by manifest specificity.
  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0];

  // Co-detection: a Node winner can co-exist with Python (e.g. ML+API repos).
  // Surface this in evidence so the architect sees it.
  const coexisting = candidates
    .slice(1)
    .filter((c) => c.score >= 50)
    .map((c) => c.language);

  if (coexisting.length > 0) {
    winner.evidence.push({
      source: "detector",
      key: "coexisting_languages",
      value: coexisting.join(","),
    });
  }

  return finalize(winner, ctx);
}

function createContext(cwd) {
  return {
    cwd,
    exists: (rel) => fs.existsSync(path.join(cwd, rel)),
    read: (rel) => {
      try {
        return fs.readFileSync(path.join(cwd, rel), "utf8");
      } catch {
        return null;
      }
    },
    readJSON: (rel) => {
      const raw = (() => {
        try {
          return fs.readFileSync(path.join(cwd, rel), "utf8");
        } catch {
          return null;
        }
      })();
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    listTop: () => {
      try {
        return fs.readdirSync(cwd);
      } catch {
        return [];
      }
    },
  };
}

function unknownStack(cwd) {
  return {
    language: "unknown",
    runtime: null,
    framework: null,
    package_manager: null,
    test_runner: null,
    build: null,
    lint: null,
    formatter: null,
    db: null,
    orm: null,
    entry_points: [],
    evidence: [],
    confidence: "low",
    unresolved: [
      "language",
      "runtime",
      "framework",
      "package_manager",
      "test_runner",
      "build",
      "lint",
      "formatter",
    ],
  };
}

function finalize(result, _ctx) {
  const fields = [
    "language",
    "runtime",
    "framework",
    "package_manager",
    "test_runner",
    "build",
    "lint",
    "formatter",
    "db",
    "orm",
  ];
  const unresolved = fields.filter((f) => result[f] == null);

  let confidence = "high";
  if (unresolved.length >= 4) confidence = "low";
  else if (unresolved.length >= 2) confidence = "medium";

  // strip internal scoring field
  delete result.score;

  return {
    ...result,
    confidence,
    unresolved,
  };
}

module.exports = { detectStack };
