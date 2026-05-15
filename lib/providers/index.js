"use strict";

const claudeCode = require("./claude-code");

const PROVIDERS = {
  anthropic: require("./anthropic"),
  openai: require("./openai"),
  "claude-code": claudeCode,
  echo: require("./echo"),
};

function getProvider(name) {
  if (!PROVIDERS[name]) {
    throw new Error(`Unknown provider: "${name}". Valid options: ${Object.keys(PROVIDERS).join(", ")}`);
  }
  return PROVIDERS[name];
}

// Auto-detect provider from environment / installed tooling.
// Priority: ANTHROPIC_API_KEY → OPENAI_API_KEY → claude CLI → echo (dry-run).
function detectProvider() {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (claudeCode.isAvailable()) return "claude-code";
  return "echo";
}

module.exports = { getProvider, detectProvider };
