"use strict";

/**
 * Tiny YAML emitter. Handles strings, numbers, booleans, null, arrays of
 * primitives or simple objects, and nested objects. No anchors, no tags.
 * Good enough for the contract files; not a general-purpose YAML lib.
 */
function stringify(value, indent = 0) {
  const lines = [];
  emit(value, indent, lines, false);
  return lines.join("\n") + "\n";
}

function emit(value, indent, lines, inline) {
  const pad = " ".repeat(indent);

  if (value === null || value === undefined) {
    lines.push(pad + "null");
    return;
  }

  if (typeof value === "string") {
    lines.push(pad + formatScalar(value));
    return;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    lines.push(pad + String(value));
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(pad + "[]");
      return;
    }
    for (const item of value) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const keys = Object.keys(item);
        if (keys.length === 0) {
          lines.push(pad + "- {}");
          continue;
        }
        lines.push(pad + "- " + keyLine(keys[0], item[keys[0]]));
        for (const k of keys.slice(1)) {
          appendKey(k, item[k], indent + 2, lines);
        }
      } else {
        if (typeof item === "string") lines.push(pad + "- " + formatScalar(item));
        else lines.push(pad + "- " + String(item));
      }
    }
    return;
  }

  if (typeof value === "object") {
    for (const k of Object.keys(value)) {
      appendKey(k, value[k], indent, lines);
    }
    return;
  }
}

function appendKey(key, value, indent, lines) {
  const pad = " ".repeat(indent);

  if (value === null || value === undefined) {
    lines.push(pad + key + ": null");
    return;
  }

  if (typeof value === "string") {
    lines.push(pad + key + ": " + formatScalar(value));
    return;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    lines.push(pad + key + ": " + String(value));
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(pad + key + ": []");
      return;
    }
    lines.push(pad + key + ":");
    emit(value, indent, lines, false);
    return;
  }

  if (typeof value === "object") {
    if (Object.keys(value).length === 0) {
      lines.push(pad + key + ": {}");
      return;
    }
    lines.push(pad + key + ":");
    emit(value, indent + 2, lines, false);
  }
}

function keyLine(key, value) {
  if (value === null || value === undefined) return key + ": null";
  if (typeof value === "string") return key + ": " + formatScalar(value);
  if (typeof value === "number" || typeof value === "boolean") return key + ": " + String(value);
  // For complex values inline in an array item, fall back to a key with no value
  // on this line and let appendKey handle the rest.
  return key + ":";
}

function formatScalar(s) {
  if (s === "") return '""';
  // Quote if contains chars that would otherwise be interpreted, or starts with special chars.
  if (/^[\s\-?:,\[\]{}#&*!|>'"%@`]/.test(s) || /[:#]\s/.test(s) || /[\n\t]/.test(s)) {
    return JSON.stringify(s);
  }
  if (/^(true|false|null|yes|no|on|off)$/i.test(s)) return JSON.stringify(s);
  if (/^-?\d/.test(s) && !isNaN(Number(s))) return JSON.stringify(s);
  return s;
}

module.exports = { stringify };
