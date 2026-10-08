import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkScore, parseScore, render, TimingSchema } from "../src/index.ts";

const example: unknown = JSON.parse(readFileSync(new URL("../examples/lyrics-hatena.json", import.meta.url), "utf8"));
const pcmHash = (audio: readonly Float32Array[]) => {
  const hash = createHash("sha256");
  for (const channel of audio) hash.update(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength));
  return hash.digest("hex");
};

const base = { format: "jinglescript/1", tempo: 120, length: { seconds: 4 }, cues: { hit: { seconds: 1.5 } } };
const sing = (notes: unknown[], instrument = "marimba") => ({ ...base, tracks: [{ instrument, notes }] });
const errorsOf = (input: unknown) => checkScore(input).errors;
const lyricsOf = (input: unknown) => render(parseScore(input)).timing.lyrics;

/** The score without its words: the same notes, no `lyric` or `lineEnd`. */
function withoutLyrics(score: unknown): unknown {
  return JSON.parse(JSON.stringify(score), (key: string, value: unknown) => (key === "lyric" || key === "lineEnd" ? undefined : value));
}

describe("lyrics in the timing map", () => {
  const result = render(parseScore(example));

  it("gives every syllable its note's onset, line by line", () => {
    expect(TimingSchema.parse(result.timing)).toBeTruthy();
    expect(result.timing.lyrics?.map((l) => [l.line, l.text, l.t, l.end])).toEqual([
      [0, "ハテナマルモ", 0, 1.96],
      [1, "はじまるよ！", 2, 5.1],
    ]);
    const melody = new Set(result.timing.notes.filter((n) => n.track === 0).map((n) => n.t));
    for (const syllable of result.timing.lyrics?.flatMap((l) => l.syllables) ?? []) expect(melody.has(syllable.t)).toBe(true);
  });

  it("holds a syllable over `_` notes", () => {
    const [first] = result.timing.lyrics ?? [];
    // ナ at 0.5 s is held over the `_` note at 0.75 s, up to the next syllable at 1 s.
    expect(first?.syllables[2]).toEqual({ text: "ナ", t: 0.5, end: 0.98 });
  });

  it("does not change the audio or the rest of the timing map", () => {
    const plain = render(parseScore(withoutLyrics(example)));
    expect(pcmHash(result.audio)).toBe(pcmHash(plain.audio));
    expect(plain.timing.lyrics).toBeUndefined();
    const { lyrics, ...rest } = result.timing;
    expect(lyrics).toBeDefined();
    expect(rest).toEqual(plain.timing);
  });

  it("is reported by check, line by line", () => {
    expect(checkScore(example).lyrics).toEqual([
      { track: 0, text: "ハテナマルモ", t: 0, end: 1.96 },
      { track: 0, text: "はじまるよ！", t: 2, end: 5.1 },
    ]);
    expect(checkScore(withoutLyrics(example))).not.toHaveProperty("lyrics");
  });
});

describe("joining syllables into words", () => {
  it("joins hyphenated syllables and spaces English words", () => {
    const lines = lyricsOf(
      sing([
        { at: 0, pitch: "C5", lyric: "hap-" },
        { at: 1, pitch: "D5", lyric: "py" },
        { at: 2, pitch: "E5", lyric: "day!" },
      ]),
    );
    expect(lines?.[0]?.text).toBe("happy day!");
    expect(lines?.[0]?.syllables.map((s) => s.text)).toEqual(["hap", "py ", "day!"]);
  });

  it("puts no space between Japanese syllables, but one next to a Latin word", () => {
    const lines = lyricsOf(
      sing([
        { at: 0, pitch: "C5", lyric: "は" },
        { at: 0.5, pitch: "D5", lyric: "じ" },
        { at: 1, pitch: "E5", lyric: "Go" },
        { at: 1.5, pitch: "G5", lyric: "！" },
      ]),
    );
    expect(lines?.[0]?.text).toBe("はじ Go ！");
  });

  it("splits lines at `lineEnd`, per track", () => {
    const lines = lyricsOf({
      ...base,
      tracks: [
        {
          instrument: "marimba",
          notes: [
            { at: 0, pitch: "C5", lyric: "one", lineEnd: true },
            { at: 1, pitch: "D5", lyric: "two" },
          ],
        },
        { instrument: "piano", notes: [{ at: 0.5, pitch: "E4", lyric: "echo" }] },
      ],
    });
    expect(lines?.map((l) => [l.track, l.line, l.text])).toEqual([
      [0, 0, "one"],
      [1, 0, "echo"],
      [0, 1, "two"],
    ]);
  });

  it("ends the last syllable at the end of the audio at the latest", () => {
    const lines = lyricsOf(sing([{ at: 7.5, pitch: "C5", lyric: "end" }]));
    expect(lines?.[0]?.syllables[0]).toEqual({ text: "end", t: 3.75, end: 4 });
  });
});

describe("lyric errors (written for repair)", () => {
  it("rejects lyrics on an unpitched sound", () => {
    expect(errorsOf(sing([{ at: 0, lyric: "clap" }], "clap"))).toEqual([
      { path: "tracks[0].notes[0].lyric", message: '"clap" plays no melody, so it cannot carry lyrics.', hint: "Put the lyrics on the melody's notes." },
    ]);
  });

  it("rejects a lyric on a repeated note", () => {
    expect(errorsOf(sing([{ at: 0, pitch: "C5", lyric: "la", repeat: { every: 1, count: 3 } }]))[0]?.path).toBe("tracks[0].notes[0].lyric");
  });

  it("rejects `lineEnd` without a lyric", () => {
    expect(errorsOf(sing([{ at: 0, pitch: "C5", lineEnd: true }]))).toEqual([
      {
        path: "tracks[0].notes[0].lineEnd",
        message: "`lineEnd` needs a `lyric` on the same note.",
        hint: "Put `lineEnd` on the note with the line's last syllable.",
      },
    ]);
  });

  it("rejects `_` with nothing to hold", () => {
    expect(errorsOf(sing([{ at: 0, pitch: "C5", lyric: "_" }]))[0]).toMatchObject({ path: "tracks[0].notes[0].lyric" });
  });

  it("rejects two syllables at the same time on one track", () => {
    const [error] = errorsOf(
      sing([
        { at: 0, pitch: "C5", lyric: "la" },
        { at: 0, pitch: "E5", lyric: "li" },
      ]),
    );
    expect(error).toMatchObject({ path: "tracks[0].notes[1].lyric", message: "Two syllables start at the same time on this track (this one and notes[0])." });
  });

  it("rejects an empty lyric", () => {
    expect(errorsOf(sing([{ at: 0, pitch: "C5", lyric: "" }]))[0]?.path).toBe("tracks[0].notes[0].lyric");
  });
});
