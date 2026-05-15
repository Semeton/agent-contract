"use strict";

async function detect(ctx) {
  const hasMaven = ctx.exists("pom.xml");
  const hasGradle = ctx.exists("build.gradle") || ctx.exists("build.gradle.kts");
  if (!hasMaven && !hasGradle) return null;

  const evidence = [];
  let blob = "";
  if (hasMaven) {
    blob += ctx.read("pom.xml") || "";
    evidence.push({ source: "manifest", key: "pom.xml", value: "found" });
  }
  if (hasGradle) {
    blob += "\n" + (ctx.read("build.gradle") || ctx.read("build.gradle.kts") || "");
    evidence.push({ source: "manifest", key: "build.gradle", value: "found" });
  }

  const isKotlin = ctx.exists("build.gradle.kts") || /kotlin/i.test(blob);
  const language = isKotlin ? "kotlin" : "java";

  let framework = null;
  if (/spring-boot/i.test(blob)) framework = "spring-boot";
  else if (/quarkus/i.test(blob)) framework = "quarkus";
  else if (/micronaut/i.test(blob)) framework = "micronaut";

  return {
    language,
    runtime: "jvm",
    framework,
    package_manager: hasMaven ? "maven" : "gradle",
    test_runner: /junit/i.test(blob) ? "junit" : null,
    build: hasMaven ? "mvn package" : "gradle build",
    lint: null,
    formatter: null,
    db: null,
    orm: /hibernate|spring-data-jpa/i.test(blob) ? "hibernate" : null,
    entry_points: [],
    evidence,
    score: 70 + (framework ? 15 : 0),
  };
}

module.exports = { detect };
