// Core entry (Node): the manageJingleScript tool for GUI Chat Protocol hosts. The host runs
// `execute` on its server; a successful renderScore returns `data` (PlayerData) that the Vue
// view in "./vue" plays. Every other action answers the LLM in text and shows no card.
// A score `path` is read through the host's `files.byPath` (as presentDocument's is): the host
// decides what a path may reach and what a relative one means. Without it, `path` is refused.
import type { FileOps, ToolContext, ToolPluginCore, ToolResult } from "gui-chat-protocol";
import { MANAGE_TOOL, ManageInputSchema, manage, type PlayerData } from "jinglescript";
import { TOOL_DEFINITION } from "./definition.ts";

export { TOOL_DEFINITION };
export type { PlayerData };

/** What a host may hand `execute` beyond the protocol's ToolContext: file access by path. */
export interface ManageContext extends ToolContext {
  files?: { byPath?: FileOps };
}

export async function executeManage(context: ManageContext, args: object): Promise<ToolResult<PlayerData, never>> {
  const input = ManageInputSchema.safeParse(args);
  if (!input.success) {
    const problems = input.error.issues.map((issue) => `${issue.path.join(".") || "(arguments)"}: ${issue.message}`);
    return { toolName: MANAGE_TOOL, message: `Invalid arguments:\n${problems.join("\n")}` };
  }
  const byPath = context.files?.byPath;
  const result = await manage(input.data, { player: true, ...(byPath ? { readScoreFile: (path: string) => byPath.read(path) } : {}) });
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
