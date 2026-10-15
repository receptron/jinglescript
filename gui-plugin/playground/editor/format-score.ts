// A score as JSON the way the examples are written: an object or list that fits on one line stays on
// one line ({ "at": 0, "pitch": "G4", "vel": 0.8 }), anything longer opens up, two spaces per level.

const LINE_WIDTH = 120;
const INDENT = "  ";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function isJsonObject(value: Json): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inline(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(", ")}]`;
  if (isJsonObject(value)) {
    const entries = Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${inline(item)}`);
    return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
  }
  return JSON.stringify(value);
}

function block(value: Json, depth: number): string {
  const one = inline(value);
  if (depth > 0 && INDENT.repeat(depth).length + one.length <= LINE_WIDTH) return one;
  const inner = INDENT.repeat(depth + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((item) => inner + block(item, depth + 1)).join(",\n")}\n${INDENT.repeat(depth)}]`;
  }
  if (isJsonObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    const lines = entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${block(item, depth + 1)}`);
    return `{\n${lines.join(",\n")}\n${INDENT.repeat(depth)}}`;
  }
  return one;
}

/** `value` as formatted JSON text; it parses back to the same value. */
export function formatScore(value: unknown): string {
  // A round trip through JSON drops what JSON cannot hold (undefined fields) and types the rest.
  const json: Json = JSON.parse(JSON.stringify(value));
  return `${block(json, 0)}\n`;
}
