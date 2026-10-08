// The JSON Schema files published in schema/, and their exact text. Shared by the script that
// writes them and the test that checks they are current.
import { getSchema, type SchemaPart } from "./llm.ts";

export const SCHEMA_FILES: Record<string, SchemaPart> = {
  "jinglescript-1.json": "score",
  "jinglescript-timing-1.json": "timing",
};

export function schemaFileText(part: SchemaPart): string {
  return `${JSON.stringify(getSchema(part), null, 2)}\n`;
}
