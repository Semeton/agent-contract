"use strict";

async function generate({ system, user }) {
  const { estimateTokens } = require("../util/tokens");
  process.stdout.write("\n[echo provider — dry run]\n");
  process.stdout.write("=== SYSTEM ===\n");
  process.stdout.write(system + "\n");
  process.stdout.write("=== USER ===\n");
  process.stdout.write(user + "\n");
  process.stdout.write("=== END ===\n\n");
  return {
    output: "[echo: no model output in dry-run mode]",
    model: "echo",
    usage: {
      input_tokens: estimateTokens(system + user),
      output_tokens: 0,
    },
  };
}

module.exports = { generate };
