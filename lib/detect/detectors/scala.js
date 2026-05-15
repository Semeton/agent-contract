"use strict";

const FRAMEWORK_HINTS = [
  { pattern: /"com\.typesafe\.akka"\s*%%\s*"akka-actor/,   label: "akka" },
  { pattern: /"com\.typesafe\.play"\s*%%\s*"play"/,         label: "play" },
  { pattern: /"org\.http4s"\s*%%\s*"http4s-core"/,          label: "http4s" },
  { pattern: /"dev\.zio"\s*%%\s*"zio"/,                     label: "zio" },
  { pattern: /"io\.finch"\s*%%\s*"finch-core"/,             label: "finch" },
];

const TEST_HINTS = [
  { pattern: /"org\.scalatest"\s*%%\s*"scalatest"/,  label: "scalatest" },
  { pattern: /"org\.scalameta"\s*%%\s*"munit"/,       label: "munit" },
  { pattern: /"org\.specs2"\s*%%\s*"specs2-core"/,    label: "specs2" },
];

async function detect(ctx) {
  const hasSbt = ctx.exists("build.sbt");
  const hasPom = ctx.exists("pom.xml");
  if (!hasSbt && !hasPom) return null;

  // Confirm this is actually a Scala project
  const buildContent = hasSbt ? ctx.read("build.sbt") : "";
  const pomContent = hasPom ? ctx.read("pom.xml") : "";
  const isScala =
    /scalaVersion/.test(buildContent) ||
    /scala-library/.test(pomContent) ||
    ctx.exists("src/main/scala");

  if (!isScala) return null;

  const content = buildContent + pomContent;
  const evidence = [{ source: "manifest", key: hasSbt ? "build.sbt" : "pom.xml", value: "found" }];

  // ---- framework ----
  let framework = null;
  for (const { pattern, label } of FRAMEWORK_HINTS) {
    if (pattern.test(content)) {
      framework = label;
      evidence.push({ source: "dependency", key: "framework", value: label });
      break;
    }
  }

  // ---- test runner ----
  let test_runner = "sbt-test"; // sbt test is universal
  for (const { pattern, label } of TEST_HINTS) {
    if (pattern.test(content)) {
      test_runner = label;
      evidence.push({ source: "dependency", key: "test_runner", value: label });
      break;
    }
  }

  // ---- lint ----
  const lint = ctx.exists(".scalafmt.conf") ? "scalafmt" : null;

  // ---- package manager ----
  const pm = hasSbt ? "sbt" : "maven";

  // ---- score ----
  let score = 70;
  if (framework) score += 20;

  return {
    language: "scala",
    runtime: "jvm",
    framework,
    package_manager: pm,
    test_runner,
    build: pm === "sbt" ? "sbt compile" : "mvn compile",
    lint,
    formatter: null,
    db: null,
    orm: null,
    entry_points: [],
    evidence,
    score,
  };
}

module.exports = { detect };
