// Core entry (Node): the manageJingleScript tool for GUI Chat Protocol hosts. The host runs
// `execute` on its server; a successful renderScore returns `data` (PlayerData) that the Vue
// view in "./vue" plays. Every other action answers the LLM in text and shows no card.
// A score `path` is read through the host's `files.byPath` (as presentDocument's is): the host
// decides what a path may reach and what a relative one means. Without it, `path` is refused.
// A host whose view can call back (`deferredAudio`) gets the card before a long render's audio:
// the view collects it with an AudioRequest, answered here, and asks how far it is meanwhile.
import type { FileOps, ToolContext, ToolPluginCore, ToolResult } from "gui-chat-protocol";
import { awaitDeferredPlayer, deferredRenderProgress, MANAGE_TOOL, ManageInputSchema, manage, type PlayerData } from "jinglescript";
import { isAudioRequest, isProgressRequest, type AudioReply, type AudioRequest, type ProgressReply, type ProgressRequest } from "./audio-request.ts";
import { TOOL_DEFINITION } from "./definition.ts";

export { TOOL_DEFINITION };
export type { PlayerData };

/** What a host may hand `execute` beyond the protocol's ToolContext. */
export interface ManageContext extends ToolContext {
  /** File access by path, for a score given as `path`. */
  files?: { byPath?: FileOps };
  /**
   * The host's view can call back (it gives the view a runtime with `dispatch` to this execute):
   * a render that takes more than a moment then shows its card at once, and the view collects the
   * audio when it is ready. Without it, renderScore answers when the audio is ready, as before.
   */
  deferredAudio?: boolean;
}

/** The answer to a view's AudioRequest: waits for the render it names. */
export async function collectAudio(request: AudioRequest): Promise<AudioReply> {
  const outcome = await awaitDeferredPlayer(request.id);
  switch (outcome.kind) {
    case "ready":
      return { outcome: "ready", data: outcome.player, message: "The audio is ready." };
    case "failed":
      return { outcome: "failed", message: outcome.message };
    case "gone":
      return { outcome: "gone", message: "This render's audio is no longer on the server (it was restarted, or the render is too old)." };
  }
}

/** The answer to a view's ProgressRequest: how far the render it names is, at once. */
export function renderProgress(request: ProgressRequest): Promise<ProgressReply> {
  const progress = deferredRenderProgress(request.id);
  return Promise.resolve(progress === undefined ? { message: "No progress to tell." } : { progress, message: `Rendering: ${progress.stage}.` });
}

export async function executeManage(context: ManageContext, args: object): Promise<ToolResult<PlayerData, never>> {
  const input = ManageInputSchema.safeParse(args);
  if (!input.success) {
    const problems = input.error.issues.map((issue) => `${issue.path.join(".") || "(arguments)"}: ${issue.message}`);
    return { toolName: MANAGE_TOOL, message: `Invalid arguments:\n${problems.join("\n")}` };
  }
  const byPath = context.files?.byPath;
  const result = await manage(input.data, {
    player: true,
    deferAudio: context.deferredAudio === true,
    ...(byPath ? { readScoreFile: (path: string) => byPath.read(path) } : {}),
  });
  if (result.player === undefined) return { toolName: MANAGE_TOOL, message: result.text };
  return {
    toolName: MANAGE_TOOL,
    title: result.player.title,
    message: result.text,
    data: result.player,
    instructions: instructionsFor(result.player),
  };
}

/** What the LLM is told the user now sees, and what happens next. */
export function instructionsFor(player: PlayerData): string {
  const presentation = player.presentation;
  const shown =
    presentation?.view === "notation"
      ? "The music is shown to the user as sheet music, with a cursor that follows playback."
      : "The jingle is shown to the user in a player with its waveform, cues and beats.";
  const rendering = player.pending === undefined ? "" : " Its audio is still rendering; the player shows it now and can play it in a moment.";
  const playing = presentation?.autoplay ? ` It starts playing by itself${player.pending === undefined ? "" : " when the audio is ready"}.` : "";
  const next = presentation?.notifyWhenDone
    ? " Say only a few words, in the language you speak with the user, that it is about to play; then nothing until a message saying it finished playing arrives, then go on."
    : " Ask whether it fits, and offer changes.";
  return `${shown}${rendering}${playing}${next}`;
}

export const pluginCore: ToolPluginCore<PlayerData, never, object> = {
  toolDefinition: TOOL_DEFINITION,
  // The view's requests come through the same execute (the host's dispatch route) as the tool calls.
  execute: (context, args) => (isAudioRequest(args) ? collectAudio(args) : isProgressRequest(args) ? renderProgress(args) : executeManage(context, args)),
  generatingMessage: "Rendering the jingle…",
  isEnabled: () => true,
};
