import { describe, expect, it } from "vitest";
import { AbcError, abcToScore, parseAbc, voiceChord } from "../src/abc.ts";

const HEADER = `X:1
T:
M:4/4
L:1/32
Q:1/4=88
V: Vocal clef=treble name="Vocal Melody" snm="Vocal"
V: Ins clef=treble name="Ins Melody" snm="Inst."
`;

const SONG = `${HEADER}K:G
% verse
V: Vocal
"Gmaj7"B8d8"Am7"c8A8|"D7"F16"G"G16-|G8z24|
V: Ins
Z3|
% chorus
V: Vocal
"C"z32|
V: Ins
"Am7"e8g8-g16|
`;

describe("parseAbc", () => {
  it("reads tempo, meter, key, notes, chords and sections", () => {
    const abc = parseAbc(SONG);
    expect(abc.tempo).toBe(88);
    expect(abc.meter).toBe("4/4");
    expect(abc.key).toBe("G");
    // F in G major is F#; the tied G across the bar line is one note of 1.5 bars' worth (2 + 1 beats).
    expect(abc.voices.Vocal).toEqual([
      { at: 0, len: 1, midi: 71, pitch: "B4" },
      { at: 1, len: 1, midi: 74, pitch: "D5" },
      { at: 2, len: 1, midi: 72, pitch: "C5" },
      { at: 3, len: 1, midi: 69, pitch: "A4" },
      { at: 4, len: 2, midi: 66, pitch: "F#4" },
      { at: 6, len: 3, midi: 67, pitch: "G4" },
    ]);
    // Ins rests for three bars (Z3), then plays in the chorus.
    expect(abc.voices.Ins).toEqual([
      { at: 12, len: 1, midi: 76, pitch: "E5" },
      { at: 13, len: 3, midi: 79, pitch: "G5" },
    ]);
    expect(abc.chords.map((c) => [c.at, c.symbol])).toEqual([
      [0, "Gmaj7"],
      [2, "Am7"],
      [4, "D7"],
      [6, "G"],
      [12, "Am7"],
    ]);
    expect(abc.sections).toEqual([
      { at: 0, label: "verse" },
      { at: 12, label: "chorus" },
    ]);
    expect(abc).toMatchObject({ length: 16 });
  });

  it("carries an accidental by letter across octaves until the bar line", () => {
    const abc = parseAbc(`${HEADER}K:C\nV: Vocal\n^F8f8F8=F8|F32|\n`);
    expect(abc.voices.Vocal?.map((n) => n.pitch)).toEqual(["F#4", "F#5", "F#4", "F4", "F4"]);
  });

  it("keeps a tied note's pitch across the bar line, then resets", () => {
    const abc = parseAbc(`${HEADER}K:C\nV: Vocal\nz8^F24-|F8F24|\n`);
    expect(abc.voices.Vocal).toEqual([
      { at: 1, len: 4, midi: 66, pitch: "F#4" },
      { at: 5, len: 3, midi: 65, pitch: "F4" },
    ]);
  });

  it("reads minor keys, octave marks and double accidentals", () => {
    const abc = parseAbc(`${HEADER}K:Bbm\nV: Vocal\nB,8d'8^^C8__B8|\n`);
    expect(abc.key).toBe("Bbm");
    expect(abc.voices.Vocal?.map((n) => n.pitch)).toEqual(["Bb3", "Db6", "D4", "A4"]);
  });

  it("names the line of anything outside the dialect", () => {
    expect(() => parseAbc(`${HEADER}K:C\nV: Vocal\n(3CDE|\n`)).toThrow(/ABC line 10: "\(" is not part/);
    expect(() => parseAbc(`${HEADER}K:C\nV: Vocal\n[CEG]8|\n`)).toThrow(AbcError);
    expect(() => parseAbc(`${HEADER}K:Dmix\n`)).toThrow(/unsupported key "Dmix"/);
    expect(() => parseAbc(`${HEADER}K:C\nV: Vocal\nC8-D8|\n`)).toThrow(/tie joins C4 to a different pitch, D4/);
    expect(() => parseAbc(`${HEADER}K:C\nV: Vocal\nC/2|\n`)).toThrow(/fractional/);
  });
});

describe("voiceChord", () => {
  it("names chords JingleScript knows and spells out the rest", () => {
    expect(voiceChord("F#m7", false)).toEqual({ chord: "F#m7", bass: "F#2" });
    expect(voiceChord("Bbmaj7/D", true)).toEqual({ chord: "Bbmaj7", bass: "D3" });
    expect(voiceChord("Bm7b5", false)).toEqual({ pitches: ["B4", "D5", "F5", "A5"], bass: "B2" });
    expect(voiceChord("G7sus4", false)).toEqual({ pitches: ["G4", "C5", "D5", "F5"], bass: "G2" });
    expect(voiceChord("Cm(maj7)", true)).toEqual({ pitches: ["C4", "Eb4", "G4", "B4"], bass: "C3" });
    expect(() => voiceChord("C13", false)).toThrow(/unsupported chord quality/);
  });
});

describe("abcToScore", () => {
  it("makes a valid score with melody, chords, bass and section cues", () => {
    const score = abcToScore(SONG, { title: "Test", melody: "vibraphone", ins: "glockenspiel" });
    expect(score.tempo).toBe(88);
    expect(score.key).toBe("G");
    expect(score).toMatchObject({ length: { beats: 18 } });
    expect(score.cues).toEqual({ verse: { beats: 0 }, chorus: { beats: 12 } });
    expect(score.tracks.map((t) => [t.name, t.instrument])).toEqual([
      ["vocal", "vibraphone"],
      ["ins", "glockenspiel"],
      ["chords", "grandpiano"],
      ["bass", "grandpiano"],
    ]);
    const chords = score.tracks[2]?.notes.map((n) => [n.at, n.chord, n.len]);
    expect(chords).toEqual([
      [0, "Gmaj7", 2],
      [2, "Am7", 2],
      [4, "D7", 2],
      [6, "G", 6],
      [12, "Am7", 4],
    ]);
  });

  it("leaves chords and bass out when asked", () => {
    const score = abcToScore(SONG, { chords: false, bass: false });
    expect(score.tracks.map((t) => t.name)).toEqual(["vocal", "ins"]);
  });

  it("numbers repeated sections", () => {
    const score = abcToScore(`${HEADER}K:C\n% Chorus\nV: Vocal\nC32|\n% Chorus\nV: Vocal\nD32|\n% 2nd verse\nV: Vocal\nE32|\n`);
    expect(score.cues).toEqual({ chorus: { beats: 0 }, chorus_2: { beats: 4 }, section_2nd_verse: { beats: 8 } });
  });
});

describe("abcToScore options", () => {
  it("cuts one section out and starts it at beat 0, carrying in the sounding chord", () => {
    const score = abcToScore(SONG, { section: "chorus" });
    expect(score).toMatchObject({ length: { beats: 6 } });
    expect(score.cues).toEqual({ chorus: { beats: 0 } });
    expect(score.tracks.find((t) => t.name === "ins")?.notes.map((n) => [n.at, n.pitch])).toEqual([
      [0, "E5"],
      [1, "G5"],
    ]);
    expect(score.tracks.find((t) => t.name === "chords")?.notes.map((n) => [n.at, n.chord])).toEqual([[0, "Am7"]]);
    expect(score.tracks.some((t) => t.name === "vocal")).toBe(false);
  });

  it("names the sections there are when the one asked for is missing", () => {
    expect(() => abcToScore(SONG, { section: "bridge" })).toThrow(/no section "bridge"; sections: verse, chorus/);
  });

  it("moves a line by octaves into its instrument's range", () => {
    const high = `${HEADER}K:C\nV: Vocal\nd''8c''8a'8z8|\n`;
    // vibraphone is C3–C7: D7 does not fit, so the whole line drops an octave.
    const score = abcToScore(high, { melody: "vibraphone" });
    expect(score.tracks[0]?.notes.map((n) => n.pitch)).toEqual(["D6", "C6", "A5"]);
  });
});
