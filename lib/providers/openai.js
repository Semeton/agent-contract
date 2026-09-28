"use strict";

const https = require("https");

// Deliberately left at gpt-4o rather than bumped to a guessed newer id. OpenAI's
// current lineup is not something this project tracks, and a wrong model string fails
// at request time with an unhelpful 404 — worse than a knowingly conservative default.
// Override per-repo with `model:` in .agent/config.yaml, or per-run:
//   OPENAI_MODEL=<id> agent-contract run ...   |   --model is not a flag; use the env var
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

async function generate({ system, user, model }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const body = JSON.stringify({
    model: model || DEFAULT_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.openai.com",
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode !== 200) {
              reject(new Error(`OpenAI API error ${res.statusCode}: ${parsed.error?.message || data}`));
              return;
            }
            const choice = (parsed.choices || [])[0];
            const output = choice?.message?.content;
            if (typeof output !== "string" || output.trim() === "") {
              reject(new Error(
                `OpenAI returned no text content (finish_reason: ${choice?.finish_reason || "unknown"})` +
                (choice?.finish_reason === "length" ? " — the response hit the token limit." : ".")
              ));
              return;
            }
            resolve({
              output,
              model: parsed.model,
              usage: {
                input_tokens: parsed.usage?.prompt_tokens || 0,
                output_tokens: parsed.usage?.completion_tokens || 0,
              },
            });
          } catch (e) {
            reject(new Error(`Failed to parse OpenAI response: ${e.message}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

module.exports = { generate, DEFAULT_MODEL };
