import { describe, expect, it } from "vitest";
import { describeFit, fitLyrics, parseLyrics, phrasesIn, placeLyrics, splitMorae } from "../src/abc-lyrics.ts";
import { abcToScore, parseAbc } from "../src/abc.ts";

const HEADER = `X:1\nM:4/4\nL:1/8\nQ:1/4=120\nV: Vocal\nV: Ins\n`;

describe("splitMorae", () => {
  it("splits kana into morae, joining small kana and keeping っ, ん and ー", () => {
    expect(splitMorae("ハテナマルモ")).toEqual(["ハ", "テ", "ナ", "マ", "ル", "モ"]);
    expect(splitMorae("きょうもいっしょ")).toEqual(["きょ", "う", "も", "い", "っ", "しょ"]);
    expect(splitMorae("らーめん")).toEqual(["ら", "ー", "め", "ん"]);
  });

  it("asks for kana when the words are not", () => {
    expect(() => splitMorae("朝の光")).toThrow(/"朝" in the lyrics "朝の光" is not kana/);
    expect(() => splitMorae("hello")).toThrow(/hiragana or katakana/);
  });
});

describe("parseLyrics", () => {
  it("reads YuE2's section tags, lines and chunks", () => {
    const sections = parseLyrics("[Verse]\nあさの ひかり\n\n[Pre-Chorus]\nうたおう、よ");
    expect(sections.map((s) => s.label)).toEqual(["verse", "pre_chorus"]);
    expect(sections[0]?.chunks.map((c) => [c.text, c.morae.length, c.lineEnd])).toEqual([
      ["あさの", 3, false],
      ["ひかり", 3, true],
    ]);
    expect(sections[1]?.chunks.map((c) => c.text)).toEqual(["うたおう", "よ"]);
  });
});

// Verse: a 3-note and a 2-note phrase; chorus: a 4-note phrase. One bar (8 eighths) each.
const SONG = `${HEADER}K:C
% verse
V: Vocal
CDEz z4|GAz2 z4|
% chorus
V: Vocal
cdec z4|
`;

describe("fitLyrics", () => {
  it("puts one mora on each note, phrase by phrase, matching sections by name", () => {
    const { parsed, phrases } = fitLyrics(parseAbc(SONG), "[Chorus]\nらららら\n[Verse]\nあさの\nひる");
    expect(parsed.voices.Vocal?.map((n) => n.lyric)).toEqual(["あ", "さ", "の", "ひ", "る", "ら", "ら", "ら", "ら"]);
    expect(parsed.voices.Vocal?.filter((n) => n.lineEnd).map((n) => n.at)).toEqual([1, 4.5, 9.5]);
    expect(phrases.map((p) => p.fit)).toEqual(["exact", "exact", "exact"]);
  });

  it("tells which section each phrase is in, to report only the section kept", () => {
    const parsed = parseAbc(SONG);
    const { phrases } = fitLyrics(parsed, "[Chorus]\nらららら\n[Verse]\nあさの\nひる");
    expect(phrases.map((p) => p.section)).toEqual([0, 0, 1]);
    expect(phrasesIn(phrases, parsed, "chorus").map((p) => p.text)).toEqual(["らららら"]);
    expect(phrasesIn(phrases, parsed, undefined)).toHaveLength(3);
  });

  it("holds the last mora over extra notes", () => {
    const { parsed, phrases } = fitLyrics(parseAbc(SONG), "[Verse]\nあ\nひ\n[Chorus]\nら");
    expect(parsed.voices.Vocal?.map((n) => n.lyric)).toEqual(["あ", "_", "_", "ひ", "_", "ら", "_", "_", "_"]);
    expect(phrases.map((p) => p.fit)).toEqual(["held", "held", "held"]);
  });

  it("splits the longest notes when there are more morae than notes", () => {
    const abc = `${HEADER}K:C\nV: Vocal\nC4D2z2|\n`;
    const { parsed, phrases } = fitLyrics(parseAbc(abc), "あいう");
    expect(parsed.voices.Vocal?.map((n) => [n.at, n.len, n.pitch, n.lyric])).toEqual([
      [0, 1, "C4", "あ"],
      [1, 1, "C4", "い"],
      [2, 1, "D4", "う"],
    ]);
    expect(phrases[0]?.fit).toBe("split");
    expect(describeFit(phrases)).toBe("lyrics on 1 phrases: 1 split\n  beat 0: 2 notes ← あいう (3 morae) [split]");
  });

  it("joins chunks to fill a long phrase, and repeats the words when the song does", () => {
    const abc = `${HEADER}K:C\nV: Vocal\nCDEF z4|CDEF z4|\n`;
    const { parsed } = fitLyrics(parseAbc(abc), "はて なも");
    expect(parsed.voices.Vocal?.map((n) => n.lyric).join("")).toBe("はてなもはてなも");
  });
});

describe("placeLyrics", () => {
  it("leaves words that are not kana off a played score, and refuses them for a sung one", () => {
    expect(placeLyrics(parseAbc(SONG), "[Verse]\nhello", false).skipped).toMatch(/not kana/);
    expect(() => placeLyrics(parseAbc(SONG), "[Verse]\nhello", true)).toThrow(/not kana/);
    expect(() => placeLyrics(parseAbc(SONG), undefined, true)).toThrow(/singing needs lyrics/);
  });
});

describe("sung scores", () => {
  it("leave out the tail of a word held over from the section before", () => {
    const abc = `${HEADER}K:C\n% verse\nV: Vocal\nz4CDE2-|\n% chorus\nV: Vocal\nE2z2GAB2|\n`;
    const placed = fitLyrics(parseAbc(abc), "[Verse]\nあいう\n[Chorus]\nかきく");
    const score = abcToScore(placed.parsed, { section: "chorus", melody: "organ" });
    expect(score.tracks[0]?.notes.map((n) => n.lyric)).toEqual(["か", "き", "く"]);
    expect(abcToScore(abc, { section: "chorus", melody: "organ" }).tracks[0]?.notes).toHaveLength(4);
  });

  // A pickup (G A) runs into the chorus; YuE2 writes the line around A5.
  const HIGH = `${HEADER}K:C\n% intro\nV: Vocal\nz6ga|\n% chorus\nV: Vocal\nc'2b2a4|\n`;

  it("keep the pickup, sit around A4, and start a bar in", () => {
    const placed = fitLyrics(parseAbc(HIGH), "[Chorus]\nはてなまる");
    const score = abcToScore(placed.parsed, { section: "chorus", sing: { voice: "reina" }, melody: "organ" });
    const vocal = score.tracks[0];
    expect(vocal?.sing).toEqual({ engine: "neutrino", voice: "reina" });
    expect(vocal?.notes.map((n) => [n.at, n.pitch, n.lyric])).toEqual([
      [4, "G4", "は"],
      [4.5, "A4", "て"],
      [5, "C5", "な"],
      [6, "B4", "ま"],
      [7, "A4", "る"],
    ]);
    expect(score.pickup).toBe(1);
    expect(score.cues).toEqual({ chorus: { beats: 5 } });
  });
});
