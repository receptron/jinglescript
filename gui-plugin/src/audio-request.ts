// The view's request for audio that was still rendering when its card appeared (a `pending`
// PlayerData), and the answer. The view sends it through the host's runtime dispatch, which reaches
// the same execute as the LLM's tool calls; execute answers it before reading the call as a tool
// call. Shared by both entries, so the two sides cannot drift apart.
import type { PlayerData } from "jinglescript";

/** `kind` of the view's request; not a manageJingleScript action, so the LLM never sends it. */
export const AUDIO_REQUEST = "collectRenderedAudio";

export interface AudioRequest {
  kind: typeof AUDIO_REQUEST;
  /** The pending PlayerData's `pending` id. */
  id: string;
}

/** What execute answers: the finished PlayerData, why the render failed, or that it is not on the server (any more). */
export type AudioReply = { outcome: "ready"; data: PlayerData; message: string } | { outcome: "failed" | "gone"; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export function isAudioRequest(args: unknown): args is AudioRequest {
  return isRecord(args) && args["kind"] === AUDIO_REQUEST && typeof args["id"] === "string";
}

/** Enough of PlayerData to play it; the rest came from the same server as the pending one. */
function isPlayerData(value: unknown): value is PlayerData {
  return (
    isRecord(value) &&
    typeof value["audio"] === "string" &&
    value["audio"] !== "" &&
    typeof value["title"] === "string" &&
    Array.isArray(value["peaks"]) &&
    isRecord(value["timing"])
  );
}

/** The reply as the view receives it (JSON from the host), checked; undefined when it is not one. */
export function parseAudioReply(raw: unknown): AudioReply | undefined {
  if (!isRecord(raw) || typeof raw["message"] !== "string") return undefined;
  const message = raw["message"];
  if (raw["outcome"] === "ready") return isPlayerData(raw["data"]) ? { outcome: "ready", data: raw["data"], message } : undefined;
  if (raw["outcome"] === "failed" || raw["outcome"] === "gone") return { outcome: raw["outcome"], message };
  return undefined;
}
