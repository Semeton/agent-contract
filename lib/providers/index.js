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
// Priority: claude CLI (free, no key needed) → ANTHROPIC_API_KEY → OPENAI_API_KEY → echo (dry-run).
// API keys override only when set explicitly via --provider or .agent/config.yaml.
function detectProvider() {
  if (claudeCode.isAvailable()) return "claude-code";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "echo";
}

module.exports = { getProvider, detectProvider };
