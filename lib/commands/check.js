"use strict";

// agent-contract check — the merge gate.
//
// Runs on the change a pull request carries (base...HEAD), outside any agent session,
// so nothing the agent can edit decides the outcome. The first rule: a change that
// touches a sensitive path must record WHY, either as a decision file committed with it
// or as a "## Decision" section in the PR description. Decisions then live where the
// team already reviews them — in git — instead of a log the agent may or may not write.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { loadConfig } = require("../util/config");

// Paths whose change is a decision, not a task detail: dependency manifests (zero-dep
// style policies live or die here), the contract's own scopes and guards, CI, and hook
// wiring. Override with `decisions_required_for:` in .agent/config.yaml.
const DEFAULT_DECISION_PATHS = [
  "package.json", "**/package.json",
  "composer.json", "requirements*.txt", "pyproject.toml", "go.mod", "Cargo.toml",
  "Gemfile", "pom.xml", "build.gradle", "build.gradle.kts", "pubspec.yaml", "*.csproj",
  ".agent/roles/**", ".agent/checks/**", ".agent/conventions.yaml",
  ".github/workflows/**", ".claude/settings.json",
];
const DEFAULT_DECISIONS_DIR = "docs/decisions";

// Same semantics as the bash guards' `case` patterns: '*' and '**' both cross '/'.
function globToRegExp(glob) {
  const re = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*+/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${re}$`);
}

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function resolveBase(cwd, flagBase) {
  const candidates = flagBase
    ? [flagBase]
    : [process.env.GITHUB_BASE_REF && `origin/${process.env.GITHUB_BASE_REF}`, "origin/HEAD"].filter(Boolean);
  for (const ref of candidates) {
    try {
      git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
      return ref;
    } catch {
      // try the next one
    }
  }
  return null;
}

// "## Decision" / "## Decisions" heading with at least one non-blank line before the next heading.
function bodyHasDecision(body) {
  const m = /^#{2,3}\s+Decisions?\s*$/im.exec(body || "");
  if (!m) return false;
  const rest = body.slice(m.index + m[0].length).split(/^#{1,3}\s/m)[0];
  return rest.split("\n").some((l) => l.trim() && !/^<!--.*-->$/.test(l.trim()));
}

function readPrBody(flags) {
  if (flags.prBody) return fs.readFileSync(flags.prBody, "utf8");
  const ev = process.env.GITHUB_EVENT_PATH;
  if (!ev) return "";
  try {
    const event = JSON.parse(fs.readFileSync(ev, "utf8"));
    return (event.pull_request && event.pull_request.body) || "";
  } catch {
    return "";
  }
}

async function check({ cwd, flags }) {
  const out = (s) => process.stdout.write(s + "\n");
  const err = (s) => process.stderr.write(s + "\n");

  try {
    git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    err("check: not a git repository");
    return 2;
  }

  const base = resolveBase(cwd, flags.base);
  if (!base) {
    err(`check: base ref ${flags.base ? `'${flags.base}' ` : ""}does not resolve — pass --base <ref> (e.g. origin/main)`);
    return 2;
  }

  let body = "";
  try {
    body = readPrBody(flags);
  } catch (e) {
    err(`check: cannot read --pr-body: ${e.message}`);
    return 2;
  }

  const config = loadConfig(cwd);
  const globs = config.decisions_required_for
    ? config.decisions_required_for.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_DECISION_PATHS;
  const decisionsDir = (config.decisions_dir || DEFAULT_DECISIONS_DIR).replace(/\/+$/, "");
  const matchers = globs.map(globToRegExp);

  const range = `${base}...HEAD`;
  const lines = (s) => s.split("\n").map((l) => l.trim()).filter(Boolean);
  const changed = lines(git(cwd, ["diff", "--name-only", range]));
  // A decision is recorded by adding or editing a file; deleting one records nothing.
  const decisionFiles = lines(git(cwd, ["diff", "--name-only", "--diff-filter=AMR", range]))
    .filter((f) => f.startsWith(decisionsDir + "/") && f.endsWith(".md"));

  const sensitive = changed.filter((f) => matchers.some((re) => re.test(f)));

  out(`agent-contract check  ${range}  (${changed.length} file${changed.length === 1 ? "" : "s"} changed)`);
  if (sensitive.length === 0) {
    out("  decisions: not required — no sensitive paths changed");
    return 0;
  }

  out("  sensitive paths changed:");
  for (const f of sensitive) out(`    ${f}`);

  if (decisionFiles.length > 0) {
    out(`  decisions: recorded in ${decisionFiles.join(", ")}`);
    return 0;
  }
  if (bodyHasDecision(body)) {
    out("  decisions: recorded in the PR description (## Decision)");
    return 0;
  }

  err("  decisions: MISSING — these changes need a recorded reason. Either:");
  err(`    • commit ${decisionsDir}/NNNN-<title>.md with the change, or`);
  err("    • add a '## Decision' section to the PR description.");
  return 1;
}

module.exports = { check, bodyHasDecision, globToRegExp, DEFAULT_DECISION_PATHS };
