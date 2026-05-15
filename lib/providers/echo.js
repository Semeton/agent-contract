"use strict";

async function generate({ system, user }) {
  process.stdout.write("\n[echo provider — dry run]\n");
  process.stdout.write("=== SYSTEM ===\n");
  process.stdout.write(system + "\n");
  process.stdout.write("=== USER ===\n");
  process.stdout.write(user + "\n");
  process.stdout.write("=== END ===\n\n");
  return { output: "[echo: no model output in dry-run mode]", model: "echo" };
}

module.exports = { generate };
