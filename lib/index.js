"use strict";

/**
 * Programmatic API for @agent-contract/cli.
 *
 * Usage:
 *   const { detectStack, init } = require('@your-scope/agent-contract');
 *   const result = await detectStack(process.cwd());
 *   await init({ cwd: process.cwd(), flags: { dryRun: true } });
 */

const { detectStack } = require("./detect");
const { init } = require("./commands/init");
const { detect } = require("./commands/detect");
const { run } = require("./commands/run");

module.exports = {
  detectStack,
  init,
  detect,
  run,
};
