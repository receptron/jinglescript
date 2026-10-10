// The text tags a score writes into its audio and MIDI files. Shared by the WAV writer, the ffmpeg
// encoder and the MIDI writer, so all three carry the same fields.
import type { Score } from "./score.ts";

export const TAG_KEYS = ["title", "author", "copyright"] as const;
export type TagKey = (typeof TAG_KEYS)[number];
export type AudioTags = Partial<Record<TagKey, string>>;

/** The score's tags, without the ones it leaves out or leaves empty. */
export function tagsOf(score: Pick<Score, TagKey>): AudioTags {
  const tags: AudioTags = {};
  for (const key of TAG_KEYS) {
    const value = score[key];
    if (value) tags[key] = value;
  }
  return tags;
}
