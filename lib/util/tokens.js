"use strict";

// Known context window sizes per model (input + output combined).
const MODEL_LIMITS = {
  // Anthropic
  "claude-opus-4-7":       200000,
  "claude-opus-4-5":       200000,
  "claude-sonnet-4-6":     200000,
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
  // claude-code CLI — tracks same models as Anthropic; use conservative default
  "claude-code":           200000,
};

const WARN_THRESHOLD      = 0.70;
const HANDOFF_THRESHOLD   = 0.85;
const PREFLIGHT_THRESHOLD = 0.80;

// Rough estimate: 1 token ≈ 4 characters (standard approximation for English + code).
function estimateTokens(text) {
  return Math.ceil((text || "").length / 4);
}

function limitForModel(model) {
  if (!model) return MODEL_LIMITS.default || 100000;
  // Match on prefix so "claude-opus-4-7-20250514" works
  for (const [key, limit] of Object.entries(MODEL_LIMITS)) {
    if (model.startsWith(key)) return limit;
  }
  return MODEL_LIMITS.default || 100000;
}

function checkUsage(usage, model) {
  const total = (usage.input_tokens || 0) + (usage.output_tokens || 0);
  const limit = limitForModel(model);
  const ratio = total / limit;
  return { total, limit, ratio, pct: Math.round(ratio * 100) };
}

module.exports = { estimateTokens, limitForModel, checkUsage, WARN_THRESHOLD, HANDOFF_THRESHOLD, PREFLIGHT_THRESHOLD };
