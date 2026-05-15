"use strict";

async function detect(ctx) {
  if (!ctx.exists("pubspec.yaml")) return null;

  const pubspec = ctx.read("pubspec.yaml") || "";
  const evidence = [{ source: "manifest", key: "pubspec.yaml", value: "found" }];

  // Flutter detection: `flutter:` as a dependency key (sdk: flutter)
  const isFlutter =
    /^\s*flutter:\s*$/m.test(pubspec) ||
    /sdk:\s*flutter/.test(pubspec);

  let framework = null;
  let test_runner = "dart-test";
  let build = "dart compile exe";

  if (isFlutter) {
    framework = "flutter";
    test_runner = "flutter-test";
    build = "flutter build";
    evidence.push({ source: "dependency", key: "framework", value: "flutter" });
  }

  // ---- SDK version ----
  const sdkMatch = pubspec.match(/sdk:\s*["']?>=\s*([\d.]+)/);
  const runtime = sdkMatch ? `dart@${sdkMatch[1]}` : "dart";

  // ---- DB hints (common Dart packages) ----
  let db = null;
  if (/sqflite|drift/.test(pubspec)) db = "sqlite";
  else if (/postgres/.test(pubspec)) db = "postgresql";
  else if (/mongo_dart/.test(pubspec)) db = "mongodb";

  // ---- score ----
  let score = 70;
  if (framework) score += 20;

  return {
    language: "dart",
    runtime,
    framework,
    package_manager: "pub",
    test_runner,
    build,
    lint: "dart-analyze", // built-in, always available
    formatter: "dart-fmt",
    db,
    orm: null,
    entry_points: ctx.exists("lib/main.dart") ? ["lib/main.dart"] : [],
    evidence,
    score,
  };
}

module.exports = { detect };
