"use strict";

// Shells out to the `claude` CLI (Claude Code) which uses your existing
// subscription auth — no API key required. Falls back to this automatically
// when no ANTHROPIC_API_KEY or OPENAI_API_KEY is found but `claude` is in PATH.

const { spawnSync } = require("child_process");

function isAvailable() {
  const result = spawnSync("claude", ["--version"], { stdio: "pipe" });
  return !result.error && result.status === 0;
}

async function generate({ system, user }) {
  const combined = system + "\n\n---\n\n" + user;

  const result = spawnSync("claude", ["--print"], {
    input: combined,
    encoding: "utf8",
    timeout: 120000,
  });

  if (result.error) {
    throw new Error(
      `claude CLI not found or failed to start: ${result.error.message}\n` +
      "Install Claude Code or set ANTHROPIC_API_KEY / OPENAI_API_KEY."
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `claude CLI exited with status ${result.status}: ${(result.stderr || "").trim()}`
    );
  }

  return { output: result.stdout.trim(), model: "claude-code" };
}

module.exports = { generate, isAvailable };
