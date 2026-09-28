"use strict";

const https = require("https");

const DEFAULT_MODEL = "claude-opus-5";
// Thinking tokens count against max_tokens, so this has to be well clear of the
// visible-output size or an adaptive-thinking turn gets truncated mid-answer. Requests
// stream, which is what makes a ceiling this high safe: a non-streaming call at these
// sizes risks an HTTP timeout before the model is done.
const DEFAULT_MAX_TOKENS = 64000;

const VALID_EFFORT = new Set(["low", "medium", "high", "xhigh", "max"]);

function apiRequest(path, body) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (e) {
            reject(new Error(`Failed to parse Anthropic response: ${e.message}`));
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Anthropic API error ${res.statusCode}: ${parsed.error?.message || data}`));
            return;
          }
          resolve(parsed);
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// The contract prefix (stack + conventions + role) is byte-identical across every run
// of the same role, so it goes in `system` behind a cache breakpoint and the volatile
// task spec stays in `messages`. Prefixes under ~1024 tokens simply won't cache — that
// is a silent no-op, not an error, so small repos lose nothing by leaving this on.
function buildRequest({ system, user, model, effort, maxTokens }) {
  const body = {
    model: model || DEFAULT_MODEL,
    max_tokens: maxTokens || DEFAULT_MAX_TOKENS,
    // Adaptive thinking: the model decides its own depth. `budget_tokens` is rejected
    // outright on current models, and omitting `thinking` means no thinking at all on
    // Opus 4.8/4.7 — so this is set explicitly rather than left to the default.
    thinking: { type: "adaptive" },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  };
  if (effort) {
    if (!VALID_EFFORT.has(effort)) {
      throw new Error(
        `invalid effort "${effort}" — expected one of: ${[...VALID_EFFORT].join(", ")}`
      );
    }
    body.output_config = { effort };
  }
  return body;
}

// Pure: turns a Messages API response into { output, model, usage } or throws.
// Split out from generate() so the block-handling rules are testable without HTTP.
function parseResponse(parsed) {
  // A safety decline arrives as HTTP 200 with stop_reason "refusal" — check before
  // reading content, or it reads as an empty response with no explanation.
  if (parsed.stop_reason === "refusal") {
    const d = parsed.stop_details || {};
    throw new Error(
      `Anthropic declined this request (category: ${d.category || "unspecified"})` +
      (d.explanation ? `: ${d.explanation}` : "")
    );
  }

  // Never index content[0] blindly. With thinking on, the first block is a thinking
  // block, so the old `content[0].text` read returned undefined.
  const blocks = Array.isArray(parsed.content) ? parsed.content : [];
  const output = blocks
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!output) {
    throw new Error(
      `Anthropic returned no text content (stop_reason: ${parsed.stop_reason || "unknown"}). ` +
      (parsed.stop_reason === "max_tokens"
        ? "The response hit max_tokens — raise it or lower effort."
        : `Block types received: ${blocks.map((b) => b && b.type).join(", ") || "none"}.`)
    );
  }

  const u = parsed.usage || {};
  return {
    output,
    model: parsed.model,
    usage: {
      input_tokens: u.input_tokens || 0,
      output_tokens: u.output_tokens || 0,
      cache_read_input_tokens: u.cache_read_input_tokens || 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
    },
  };
}

// Exact token count for the assembled prompt. Callers must treat a rejection as
// non-fatal and fall back to the chars/4 heuristic — this is only ever used to decide
// whether to print a pre-flight warning, so it must never block a run.
async function countTokens({ system, user, model }) {
  const parsed = await apiRequest("/v1/messages/count_tokens", {
    model: model || DEFAULT_MODEL,
    system: [{ type: "text", text: system }],
    messages: [{ role: "user", content: user }],
  });
  if (typeof parsed.input_tokens !== "number") {
    throw new Error("count_tokens response had no input_tokens");
  }
  return parsed.input_tokens;
}

// ─── streaming ────────────────────────────────────────────────────────────────
// Everything below accumulates an SSE stream back into the same object shape a
// non-streaming response has, so parseResponse stays the single place that decides
// what counts as valid output. The pieces are pure and exported for that reason —
// the refusal, no-text and thinking-block rules are testable without a socket.

// Pull complete SSE frames out of a rolling buffer. Frames are blank-line delimited,
// and a chunk boundary lands mid-frame often enough that anything less than this
// silently drops events.
function extractSseEvents(buffer) {
  const events = [];
  let rest = String(buffer).replace(/\r\n/g, "\n");
  let idx;
  while ((idx = rest.indexOf("\n\n")) !== -1) {
    const frame = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    for (const line of frame.split("\n")) {
      const m = line.match(/^data:\s?(.*)$/);
      if (!m) continue;
      const payload = m[1].trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        events.push(JSON.parse(payload));
      } catch {
        // A frame we can't parse is not worth failing the run over; the terminal
        // message_delta carries the state that matters.
      }
    }
  }
  return { events, rest };
}

function createStreamMessage() {
  return { content: [], usage: {}, model: undefined, stop_reason: undefined, stop_details: undefined };
}

function applyStreamEvent(msg, ev) {
  if (!ev || typeof ev !== "object") return msg;
  switch (ev.type) {
    case "message_start": {
      const m = ev.message || {};
      if (m.model) msg.model = m.model;
      if (m.stop_reason !== undefined && m.stop_reason !== null) msg.stop_reason = m.stop_reason;
      Object.assign(msg.usage, m.usage || {});
      break;
    }
    case "content_block_start": {
      const block = Object.assign({}, ev.content_block || {});
      if (block.type === "text" && typeof block.text !== "string") block.text = "";
      if (block.type === "thinking" && typeof block.thinking !== "string") block.thinking = "";
      msg.content[ev.index] = block;
      break;
    }
    case "content_block_delta": {
      let block = msg.content[ev.index];
      if (!block) block = msg.content[ev.index] = { type: "text", text: "" };
      const d = ev.delta || {};
      if (d.type === "text_delta") block.text = (block.text || "") + (d.text || "");
      else if (d.type === "thinking_delta") block.thinking = (block.thinking || "") + (d.thinking || "");
      break;
    }
    case "message_delta": {
      const d = ev.delta || {};
      if (d.stop_reason !== undefined) msg.stop_reason = d.stop_reason;
      if (d.stop_details !== undefined) msg.stop_details = d.stop_details;
      Object.assign(msg.usage, ev.usage || {});
      break;
    }
    case "error": {
      const e = ev.error || {};
      throw new Error(`Anthropic stream error${e.type ? ` (${e.type})` : ""}: ${e.message || "unknown"}`);
    }
    default:
      break; // ping, content_block_stop, message_stop carry nothing we need
  }
  return msg;
}

// content is index-addressed, so a skipped index leaves a hole. parseResponse filters
// by block type anyway, but an array with holes serialises badly in error messages.
function finalizeStreamMessage(msg) {
  return Object.assign({}, msg, { content: msg.content.filter(Boolean) });
}

function streamRequest(path, body) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Promise.reject(new Error("ANTHROPIC_API_KEY is not set"));

  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          Accept: "text/event-stream",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        // An error response is JSON, not SSE. Collect it whole and report it properly
        // instead of trying to read frames that will never arrive.
        if (res.statusCode !== 200) {
          let errBody = "";
          res.on("data", (c) => { errBody += c; });
          res.on("end", () => {
            let msg = errBody;
            try { msg = JSON.parse(errBody).error?.message || errBody; } catch {}
            reject(new Error(`Anthropic API error ${res.statusCode}: ${msg}`));
          });
          return;
        }

        const msg = createStreamMessage();
        let buffer = "";
        let failed = false;
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          if (failed) return;
          buffer += chunk;
          const { events, rest } = extractSseEvents(buffer);
          buffer = rest;
          for (const ev of events) {
            try {
              applyStreamEvent(msg, ev);
            } catch (e) {
              failed = true;
              req.destroy();
              reject(e);
              return;
            }
          }
        });
        res.on("end", () => { if (!failed) resolve(finalizeStreamMessage(msg)); });
        res.on("error", (e) => { if (!failed) { failed = true; reject(e); } });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function generate({ system, user, model, effort, maxTokens }) {
  const body = buildRequest({ system, user, model, effort, maxTokens });
  body.stream = true;
  return parseResponse(await streamRequest("/v1/messages", body));
}

module.exports = {
  generate,
  countTokens,
  buildRequest,
  parseResponse,
  extractSseEvents,
  createStreamMessage,
  applyStreamEvent,
  finalizeStreamMessage,
  DEFAULT_MODEL,
  DEFAULT_MAX_TOKENS,
  VALID_EFFORT,
};
