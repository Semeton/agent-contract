"use strict";

// Known context window sizes per model (input + output combined).
// Order matters: limitForModel matches by prefix and returns the first hit, so a
// key must never be a prefix of a differently-sized model listed below it.
const MODEL_LIMITS = {
  // Anthropic — 1M context window (current generation)
  "claude-fable-5":       1000000,
  "claude-mythos-5":      1000000,
  "claude-opus-5":        1000000,
  "claude-opus-4-8":      1000000,
  "claude-opus-4-7":      1000000,
  "claude-opus-4-6":      1000000,
  "claude-sonnet-5":      1000000,
  "claude-sonnet-4-6":    1000000,
  // Anthropic — 200K context window
  "claude-opus-4-5":       200000,
  "claude-haiku-4-5":      200000,
  "claude-3-5-sonnet":     200000,
  "claude-3-opus":         200000,
  "claude-3-sonnet":       200000,
  "claude-3-haiku":        200000,
  // OpenAI
  "gpt-4o":                128000,
  "gpt-4o-mini":           128000,
  "gpt-4-turbo":           128000,
  "gpt-4":                   8000,
  "gpt-3.5-turbo":          16000,
  // claude-code CLI — runs current-generation Claude models
  "claude-code":          1000000,
};

const WARN_THRESHOLD      = 0.70;
const HANDOFF_THRESHOLD   = 0.85;
const PREFLIGHT_THRESHOLD = 0.80;

// Rough estimate: 1 token ≈ 4 characters (standard approximation for English + code).
function estimateTokens(text) {
  return Math.ceil((text || "").length / 4);
}

const DEFAULT_LIMIT = 100000;

function limitForModel(model) {
  if (!model) return DEFAULT_LIMIT;
  // Match on prefix so "claude-opus-4-7-20250514" works
  for (const [key, limit] of Object.entries(MODEL_LIMITS)) {
    if (model.startsWith(key)) return limit;
  }
  return DEFAULT_LIMIT;
}

function checkUsage(usage, model) {
  const total = (usage.input_tokens || 0) + (usage.output_tokens || 0);
  const limit = limitForModel(model);
  const ratio = total / limit;
  return { total, limit, ratio, pct: Math.round(ratio * 100) };
}

module.exports = { estimateTokens, limitForModel, checkUsage, WARN_THRESHOLD, HANDOFF_THRESHOLD, PREFLIGHT_THRESHOLD };
