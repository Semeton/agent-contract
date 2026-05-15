"use strict";

const https = require("https");

const DEFAULT_MODEL = "claude-opus-4-7";

async function generate({ system, user, model }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const body = JSON.stringify({
    model: model || DEFAULT_MODEL,
    max_tokens: 8192,
    system,
    messages: [{ role: "user", content: user }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
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
              reject(new Error(`Anthropic API error ${res.statusCode}: ${parsed.error?.message || data}`));
              return;
            }
            resolve({ output: parsed.content[0].text, model: parsed.model });
          } catch (e) {
            reject(new Error(`Failed to parse Anthropic response: ${e.message}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

module.exports = { generate };
