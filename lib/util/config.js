"use strict";

const fs = require("fs");
const path = require("path");

function loadConfig(cwd) {
  const config = {};
  const configPath = path.join(cwd, ".agent/config.yaml");

  if (fs.existsSync(configPath)) {
    const lines = fs.readFileSync(configPath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx === -1) continue;
      const key = trimmed.slice(0, colonIdx).trim();
      const val = trimmed.slice(colonIdx + 1).trim();
      if (key && val) config[key] = val;
    }
  }

  // Env vars take precedence over config file
  if (process.env.AGENT_PROVIDER) config.provider = process.env.AGENT_PROVIDER;
  if (process.env.AGENT_MODEL) config.model = process.env.AGENT_MODEL;

  return config;
}

module.exports = { loadConfig };
