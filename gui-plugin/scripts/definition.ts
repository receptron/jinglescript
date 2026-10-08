// The gui-chat-protocol ToolDefinition for manageJingleScript, built from the library's zod schema.
// Shared by the script that writes src/definition.json and the test that checks it is current.
import { MANAGE_DESCRIPTION, MANAGE_TOOL, manageInputJsonSchema } from "../../src/manage.ts";

export function definitionText(): string {
  const schema = manageInputJsonSchema();
  const given = schema.properties;
  const properties: Record<string, unknown> = typeof given === "object" && given !== null ? Object.fromEntries(Object.entries(given)) : {};
  // Function-calling hosts need a type for every argument; the score is a JSON object.
  properties.score = { type: "object", description: "checkScore, renderScore: the score (format jinglescript/1)." };
  const definition = {
    type: "function",
    name: MANAGE_TOOL,
    description: `${MANAGE_DESCRIPTION} renderScore shows a player with the waveform, cues and beats.`,
    parameters: { type: "object", properties, required: schema.required ?? ["action"] },
  };
  return `${JSON.stringify(definition, null, 2)}\n`;
}
