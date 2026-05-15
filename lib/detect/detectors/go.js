"use strict";

async function detect(ctx) {
  if (!ctx.exists("go.mod")) return null;

  const goMod = ctx.read("go.mod") || "";
  const evidence = [{ source: "manifest", key: "go.mod", value: "found" }];

  const moduleVer = goMod.match(/^go\s+([\d.]+)/m);
  const runtime = moduleVer ? `go@${moduleVer[1]}` : "go";

  let framework = null;
  if (/github\.com\/gin-gonic\/gin/.test(goMod)) framework = "gin";
  else if (/github\.com\/labstack\/echo/.test(goMod)) framework = "echo";
  else if (/github\.com\/gofiber\/fiber/.test(goMod)) framework = "fiber";
  else if (/github\.com\/go-chi\/chi/.test(goMod)) framework = "chi";

  const entry_points = [];
  for (const c of ["main.go", "cmd/main.go"]) if (ctx.exists(c)) entry_points.push(c);

  return {
    language: "go",
    runtime,
    framework,
    package_manager: "go modules",
    test_runner: "go test",
    build: "go build ./...",
    lint: ctx.exists(".golangci.yml") || ctx.exists(".golangci.yaml") ? "golangci-lint" : null,
    formatter: "gofmt",
    db: null,
    orm: /gorm\.io\/gorm/.test(goMod) ? "gorm" : /github\.com\/uptrace\/bun/.test(goMod) ? "bun" : null,
    entry_points,
    evidence,
    score: 70 + (framework ? 15 : 0),
  };
}

module.exports = { detect };
