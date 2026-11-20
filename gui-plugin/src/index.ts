// Core entry (Node): the manageJingleScript tool for GUI Chat Protocol hosts. The host runs
// `execute` on its server; a successful renderScore returns `data` (PlayerData) that the Vue
// view in "./vue" plays. Every other action answers the LLM in text and shows no card.
// A score `path` is read through the host's `files.byPath` (as presentDocument's is): the host
// decides what a path may reach and what a relative one means. Without it, `path` is refused.
// composeScore saves the score it makes through the same files (under jinglescript/), or, without
// them, answers with the score itself. With them, every render's audio and timing map are kept
// there too, and their paths go back to the LLM for a tool that animates to the song.
// A host whose view can call back (`deferredAudio`) gets the card before a long render's audio:
// the view collects it with an AudioRequest, answered here, and asks how far it is meanwhile.
import type { FileOps, ToolContext, ToolPluginCore, ToolResult } from "gui-chat-protocol";
import {
  awaitDeferredPlayer,
  deferredRenderProgress,
  MANAGE_TOOL,
  ManageInputSchema,
  manage,
  renderFileNames,
  type PlayerData,
  type RenderFiles,
} from "jinglescript";
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

/** Where the tool's files go through the host's files: composeScore's score (a path renderScore reads back) and every render's audio and timing map. */
const COMPOSED_DIR = "jinglescript";

/** Renders kept in the host's files, for a tool that animates to the song (it is handed the two paths). */
const renderFilesIn = (files: FileOps): RenderFiles => ({
  pathOf: (name) => `${COMPOSED_DIR}/${name}`,
  exists: (name) => files.exists(`${COMPOSED_DIR}/${name}`),
  write: (name, content) => files.write(`${COMPOSED_DIR}/${name}`, content),
});

/**
 * Never overwrites: a name that is taken answers undefined, and composeScore tries another. A
 * score's name is taken too when a render is kept under it ("song-2.mp3", of an earlier song).
 */
async function saveComposed(files: FileOps, name: string, content: string): Promise<string | undefined> {
  const path = `${COMPOSED_DIR}/${name}`;
  const others = name.endsWith(".json") ? renderFileNames(name.slice(0, -".json".length)).map((file) => `${COMPOSED_DIR}/${file}`) : [];
  if ((await Promise.all([path, ...others].map((file) => files.exists(file)))).some(Boolean)) return undefined;
  await files.write(path, content);
  return path;
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
    ...(byPath
      ? {
          readScoreFile: (path: string) => byPath.read(path),
          saveFile: (name: string, content: string) => saveComposed(byPath, name, content),
          renderFiles: renderFilesIn(byPath),
        }
      : {}),
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
