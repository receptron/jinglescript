// Core entry (Node): the manageJingleScript tool for GUI Chat Protocol hosts. The host runs
// `execute` on its server; a successful renderScore returns `data` (PlayerData) that the Vue
// view in "./vue" plays. Every other action answers the LLM in text and shows no card.
import type { ToolContext, ToolPluginCore, ToolResult } from "gui-chat-protocol";
import { MANAGE_TOOL, ManageInputSchema, manage, type PlayerData } from "jinglescript";
import { TOOL_DEFINITION } from "./definition.ts";

export { TOOL_DEFINITION };
export type { PlayerData };

export async function executeManage(_context: ToolContext, args: object): Promise<ToolResult<PlayerData, never>> {
  const input = ManageInputSchema.safeParse(args);
  if (!input.success) {
    const problems = input.error.issues.map((issue) => `${issue.path.join(".") || "(arguments)"}: ${issue.message}`);
    return { toolName: MANAGE_TOOL, message: `Invalid arguments:\n${problems.join("\n")}` };
  }
  const result = await manage(input.data, { player: true });
  if (result.player === undefined) return { toolName: MANAGE_TOOL, message: result.text };
  return {
    toolName: MANAGE_TOOL,
    title: result.player.title,
    message: result.text,
    data: result.player,
    instructions: "The jingle is shown to the user in a player with its waveform, cues and beats. Ask whether it fits, and offer changes.",
  };
}

export const pluginCore: ToolPluginCore<PlayerData, never, object> = {
  toolDefinition: TOOL_DEFINITION,
  execute: executeManage,
  generatingMessage: "Rendering the jingle…",
  isEnabled: () => true,
};
