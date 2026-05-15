"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { loadConfig } = require("../util/config");
const { getProvider, detectProvider } = require("../providers");

async function run({ cwd, flags }) {
  const role = flags.role || (flags._ && flags._[0]);
  const task = flags.task || (flags._ && flags._.slice(1).join(" "));
  const specFile = flags.spec || null;
  const dryRun = !!flags.dryRun;

  if (!role) {
    process.stderr.write("error: --role <name> is required\n");
    return 1;
  }
  if (!task && !specFile) {
    process.stderr.write("error: --task <description> or --spec <file> is required\n");
    return 1;
  }

  // 1. Validate contract presence
  const manifestPath = path.join(cwd, ".agent/manifest.yaml");
  if (!fs.existsSync(manifestPath)) {
    process.stderr.write(`error: no .agent/manifest.yaml in ${cwd} — run \`agent-contract init\` first\n`);
    return 1;
  }

  const rolePath = path.join(cwd, `.agent/roles/${role}.yaml`);
  if (!fs.existsSync(rolePath)) {
    process.stderr.write(`error: role not found: ${rolePath}\n`);
    return 1;
  }

  // 2. Resolve provider + model
  const config = loadConfig(cwd);
  const providerName = dryRun ? "echo" : (flags.provider || config.provider || detectProvider());
  const model = config.model || undefined;

  process.stdout.write("agent-contract run\n");
  process.stdout.write(`  target:   ${cwd}\n`);
  process.stdout.write(`  role:     ${role}\n`);
  process.stdout.write(`  provider: ${providerName}\n`);
  if (dryRun) process.stdout.write("  mode:     dry-run\n");
  process.stdout.write("\n");

  // 3. Load contract files
  process.stdout.write("[1/4] loading contract…\n");
  const roleContent = fs.readFileSync(rolePath, "utf8");
  const stackPath = path.join(cwd, ".agent/stack.yaml");
  const conventionsPath = path.join(cwd, ".agent/conventions.yaml");
  const stackContent = fs.existsSync(stackPath) ? fs.readFileSync(stackPath, "utf8") : "";
  const conventionsContent = fs.existsSync(conventionsPath) ? fs.readFileSync(conventionsPath, "utf8") : "";
  process.stdout.write(`      manifest + stack + conventions + ${role} role loaded\n\n`);

  // 4. Build or load task spec
  let spec;
  if (specFile) {
    if (!fs.existsSync(specFile)) {
      process.stderr.write(`error: spec file not found: ${specFile}\n`);
      return 1;
    }
    try {
      spec = JSON.parse(fs.readFileSync(specFile, "utf8"));
    } catch (e) {
      process.stderr.write(`error: invalid JSON in spec file: ${e.message}\n`);
      return 1;
    }
  } else {
    spec = {
      feature_name: task,
      input_shape: "unspecified",
      output_shape: "unspecified",
      error_cases: [],
    };
  }

  // 5. Pre-generate check (generator role only — check is hardcoded to generator inputs)
  const preCheckPath = path.join(cwd, ".agent/checks/pre-generate.sh");
  let tmpSpec = null;
  if (role === "generator" && fs.existsSync(preCheckPath)) {
    process.stdout.write("[2/4] running pre-generate check…\n");
    tmpSpec = path.join(os.tmpdir(), `agent-spec-${Date.now()}.json`);
    fs.writeFileSync(tmpSpec, JSON.stringify(spec));
    const checkExit = runScript(preCheckPath, [tmpSpec]);
    if (checkExit !== 0) {
      cleanup(tmpSpec);
      process.stderr.write("error: pre-generate check failed — task spec is incomplete\n");
      return 1;
    }
    process.stdout.write("      pre-generate: OK\n\n");
  } else {
    process.stdout.write("[2/4] pre-generate check: skipped (not applicable to this role)\n\n");
  }

  // 6. Assemble prompt
  process.stdout.write("[3/4] calling provider…\n");
  const { system, user } = assemblePrompt({ role, roleContent, stackContent, conventionsContent, spec });

  // 7. Call provider
  let result;
  try {
    const provider = getProvider(providerName);
    result = await provider.generate({ system, user, model });
  } catch (err) {
    cleanup(tmpSpec);
    process.stderr.write(`error: provider call failed — ${err.message}\n`);
    return 1;
  } finally {
    cleanup(tmpSpec);
  }
  process.stdout.write("\n");

  // 8. Post-generate check
  const postCheckPath = path.join(cwd, ".agent/checks/post-generate.sh");
  if (fs.existsSync(postCheckPath)) {
    process.stdout.write("[4/4] running post-generate check…\n");
    const checkExit = runScript(postCheckPath, []);
    if (checkExit !== 0) {
      process.stderr.write("error: post-generate check failed — scope or size violation\n");
      return 1;
    }
    process.stdout.write("      post-generate: OK\n\n");
  }

  // 9. Append to decisions.jsonl
  const decisionsPath = path.join(cwd, ".agent/memory/decisions.jsonl");
  if (fs.existsSync(path.dirname(decisionsPath))) {
    const entry = {
      ts: new Date().toISOString(),
      role,
      task: spec.feature_name,
      provider: providerName,
      model: result.model || model || "unknown",
      checks: {
        pre_generate: role === "generator" ? "pass" : "skip",
        post_generate: "pass",
      },
      output_lines: result.output.split("\n").length,
    };
    fs.appendFileSync(decisionsPath, JSON.stringify(entry) + "\n");
  }

  // 10. Print output
  process.stdout.write(result.output + "\n");

  return 0;
}

function assemblePrompt({ role, roleContent, stackContent, conventionsContent, spec }) {
  const system = [
    "You are operating under an agent contract. Follow all role instructions exactly.",
    "Do not take actions outside the scope defined in your role. When inputs are missing or ambiguous, ask the human.",
    "",
    "## Stack",
    stackContent || "(no stack detected)",
    "",
    "## Engineering Conventions",
    conventionsContent || "(no conventions defined)",
    "",
    `## Your Role: ${role}`,
    roleContent,
  ].join("\n");

  const userLines = ["## Task Specification"];
  for (const [k, v] of Object.entries(spec)) {
    const val = Array.isArray(v) ? (v.length ? v.join(", ") : "none") : String(v);
    userLines.push(`${k}: ${val}`);
  }
  userLines.push("", "Proceed according to your role. If any field is \"unspecified\", ask the human before continuing.");

  return { system, user: userLines.join("\n") };
}

function runScript(scriptPath, args) {
  try {
    execSync(`bash ${scriptPath} ${args.map((a) => `'${a}'`).join(" ")}`, { stdio: "pipe" });
    return 0;
  } catch (e) {
    return e.status || 1;
  }
}

function cleanup(tmpPath) {
  if (tmpPath) {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

module.exports = { run };
