// WAV writer: stereo PCM, 24-bit by default (no dither needed at that depth), 16-bit on request.
// Tags go in a LIST/INFO chunk before the audio.
import { TAG_KEYS, type AudioTags, type TagKey } from "./tags.ts";

export const WAV_BITS = [16, 24] as const;
export type WavBits = (typeof WAV_BITS)[number];

const INFO_IDS: Record<TagKey, string> = { title: "INAM", author: "IART", copyright: "ICOP" };

/** A LIST/INFO chunk (empty when there are no tags): each value UTF-8, NUL-terminated, padded to an even length. */
function infoChunk(tags: AudioTags): Uint8Array {
  const encoder = new TextEncoder();
  const parts: number[] = [];
  const u32 = (value: number): number[] => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
  for (const key of TAG_KEYS) {
    const value = tags[key];
    if (value === undefined) continue;
    const text = [...encoder.encode(value), 0];
    parts.push(...encoder.encode(INFO_IDS[key]), ...u32(text.length), ...text);
    if (text.length % 2 === 1) parts.push(0);
  }
  if (parts.length === 0) return new Uint8Array();
  return new Uint8Array([...encoder.encode("LIST"), ...u32(4 + parts.length), ...encoder.encode("INFO"), ...parts]);
}

export function toWav(audio: readonly Float32Array[], sampleRate: number, bits: WavBits = 24, tags: AudioTags = {}): Uint8Array {
  const channels = audio.length;
  const frames = audio[0]?.length ?? 0;
  const bytesPerSample = bits / 8;
  const dataSize = frames * channels * bytesPerSample;
  const info = infoChunk(tags);
  const buffer = new ArrayBuffer(44 + info.length + dataSize);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + info.length + dataSize, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bits, true);
  new Uint8Array(buffer, 36, info.length).set(info);
  ascii(36 + info.length, "data");
  view.setUint32(40 + info.length, dataSize, true);
  const full = (1 << (bits - 1)) - 1;
  let offset = 44 + info.length;
  for (let i = 0; i < frames; i++) {
    for (const channel of audio) {
      const value = Math.round(Math.max(-1, Math.min(1, channel[i] ?? 0)) * full);
      if (bits === 16) view.setInt16(offset, value, true);
      else {
        view.setUint8(offset, value & 0xff);
        view.setUint8(offset + 1, (value >> 8) & 0xff);
        view.setInt8(offset + 2, value >> 16);
      }
      offset += bytesPerSample;
    }
  }
  return new Uint8Array(buffer);
}
