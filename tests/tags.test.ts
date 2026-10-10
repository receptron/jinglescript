import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkScore, parseScore, tagsOf, toWav } from "../src/index.ts";
import { renderToFiles } from "../src/output.ts";

const dir = mkdtempSync(join(tmpdir(), "jinglescript-tags-"));

const base = {
  format: "jinglescript/1",
  tempo: 120,
  length: { seconds: 1 },
  tracks: [{ instrument: "marimba", notes: [{ at: 0, pitch: "C5" }] }],
};
const tagged = { ...base, title: "Tag test", author: "Jingle Co.", copyright: "© 2026 Jingle Co." };

/** The chunks of a RIFF/WAVE file, by id, and the INFO entries of its LIST chunk. */
function readWav(bytes: Uint8Array): { chunks: string[]; info: Record<string, string> } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const id = (at: number): string => String.fromCharCode(...bytes.subarray(at, at + 4));
  expect(view.getUint32(4, true)).toBe(bytes.length - 8);
  const chunks: string[] = [];
  const info: Record<string, string> = {};
  for (let at = 12; at < bytes.length;) {
    const size = view.getUint32(at + 4, true);
    chunks.push(id(at));
    if (id(at) === "LIST" && id(at + 8) === "INFO") {
      for (let sub = at + 12; sub < at + 8 + size;) {
        const length = view.getUint32(sub + 4, true);
        info[id(sub)] = new TextDecoder().decode(bytes.subarray(sub + 8, sub + 8 + length - 1));
        sub += 8 + length + (length % 2);
      }
    }
    at += 8 + size + (size % 2);
  }
  return { chunks, info };
}

describe("title, author and copyright", () => {
  it("are optional strings in the score; unknown metadata keys are still rejected", () => {
    expect(checkScore(tagged).ok).toBe(true);
    expect(checkScore(base).ok).toBe(true);
    expect(checkScore({ ...base, composer: "x" }).ok).toBe(false);
    expect(checkScore({ ...base, copyright: 2026 }).ok).toBe(false);
  });

  it("tagsOf keeps only the fields the score fills in", () => {
    expect(tagsOf(parseScore(tagged))).toEqual({ title: "Tag test", author: "Jingle Co.", copyright: "© 2026 Jingle Co." });
    expect(tagsOf(parseScore({ ...base, author: "" }))).toEqual({});
  });

  it("go into a WAV LIST/INFO chunk before the audio; without tags the file is the plain 44-byte-header WAV", () => {
    const audio = [new Float32Array([0, 0.5, -0.5]), new Float32Array([0, 0.25, -0.25])];
    const plain = toWav(audio, 48000);
    expect(readWav(plain).chunks).toEqual(["fmt ", "data"]);
    expect(plain).toHaveLength(44 + 3 * 2 * 3);
    const wav = toWav(audio, 48000, 24, tagsOf(parseScore(tagged)));
    expect(readWav(wav)).toEqual({ chunks: ["fmt ", "LIST", "data"], info: { INAM: "Tag test", IART: "Jingle Co.", ICOP: "© 2026 Jingle Co." } });
    // Same PCM either way.
    expect(wav.subarray(wav.length - 18)).toEqual(plain.subarray(plain.length - 18));
  });

  it("are written by renderToFiles to WAV", async () => {
    const files = await renderToFiles(parseScore(tagged), dir, "tagged", { format: "wav" });
    expect(readWav(new Uint8Array(readFileSync(files.audio))).info).toEqual({ INAM: "Tag test", IART: "Jingle Co.", ICOP: "© 2026 Jingle Co." });
  });
});
