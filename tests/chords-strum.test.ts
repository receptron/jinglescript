import { describe, expect, it } from "vitest";
import { parseChord, voiceChord } from "../src/chords.ts";
import { expandScore } from "../src/events.ts";
import { checkScore, parseScore, render } from "../src/index.ts";
import { pitchToMidi } from "../src/pitch.ts";

const UKULELE = ["G4", "C4", "E4", "A4"];
const score = (notes: unknown[], instrument = "ukulele") => ({
  format: "jinglescript/1",
  tempo: 120,
  length: { seconds: 6 },
  cues: { hit: { seconds: 2 } },
  tracks: [{ instrument, notes }],
});

describe("chord symbols", () => {
  it("finds the standard ukulele shapes", () => {
    const shapes: Record<string, string[]> = {
      C: ["G4", "C4", "E4", "C5"], // 0003
      F: ["A4", "C4", "F4", "A4"], // 2010
      G7: ["G4", "D4", "F4", "B4"], // 0212
      Am: ["A4", "C4", "E4", "A4"], // 2000
      G: ["G4", "D4", "G4", "B4"], // 0232
      D7: ["A4", "D4", "F#4", "C5"], // 2223
      Dm: ["A4", "D4", "F4", "A4"], // 2210
      Bb: ["Bb4", "D4", "F4", "Bb4"], // 3211
    };
    for (const [symbol, shape] of Object.entries(shapes)) expect(voiceChord(symbol, UKULELE)).toEqual(shape);
  });

  it("always spells the chord on a ukulele: root and third (or the sus note) present, nothing foreign", () => {
    const roots = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
    for (const root of roots) {
      for (const quality of ["", "m", "7", "maj7", "m7", "sus4", "dim", "6"]) {
        const chord = parseChord(`${root}${quality}`);
        const pitches = voiceChord(`${root}${quality}`, UKULELE) ?? [];
        expect(chord).toBeDefined();
        const classes = pitches.map((p) => ((((pitchToMidi(p) ?? 0) - (chord?.root ?? 0)) % 12) + 12) % 12);
        expect(pitches).toHaveLength(4);
        for (const pc of classes) expect(chord?.intervals.map((i) => i % 12)).toContain(pc);
        expect(classes).toContain(0);
        expect(classes).toContain((chord?.intervals[1] ?? 0) % 12);
      }
    }
  });

  it("stacks chords in root position from octave 4 on other instruments", () => {
    expect(voiceChord("G7", undefined)).toEqual(["G4", "B4", "D5", "F5"]);
    expect(voiceChord("Fmaj7", undefined)).toEqual(["F4", "A4", "C5", "E5"]);
    expect(voiceChord("Bbm", undefined)).toEqual(["Bb4", "Db5", "F5"]);
  });

  it("explains a bad chord, a chord with a pitch, and a chord on an unpitched sound", () => {
    expect(checkScore(score([{ at: 0, chord: "Cmaj9" }])).errors[0]?.message).toContain('"G7"');
    expect(checkScore(score([{ at: 0, chord: "C", pitch: "C4" }])).errors[0]?.message).toBe("Give `pitch` or `chord`, not both.");
    expect(checkScore(score([{ at: 0, chord: "C" }], "clap")).errors[0]?.message).toContain("unpitched");
  });
});

describe("strums", () => {
  it("plays a pattern one stroke per D/U, on the eighth-note grid, repeating per bar", () => {
    const { events } = expandScore(parseScore(score([{ at: 0, chord: "C", strum: "D-DU-UDU", repeat: { every: 4, count: 2 } }])));
    expect(events).toHaveLength(12);
    expect(events.slice(0, 6).map((e) => e.strum?.direction)).toEqual(["down", "down", "up", "up", "down", "up"]);
    // Strokes sit on 0, 1, 1.5, 2.5, 3, 3.5 beats (0.5 s each at 120 BPM), give or take the 4 ms looseness.
    const beats = events.slice(0, 6).map((e) => e.seconds / 0.5);
    [0, 1, 1.5, 2.5, 3, 3.5].forEach((beat, i) => expect(Math.abs((beats[i] ?? 0) - beat)).toBeLessThan(0.01));
    expect(events[6]?.seconds).toBeGreaterThan(1.99);
  });

  it("spreads strings ~15 ms apart in string order, and reverses for an up-stroke", () => {
    const { events } = expandScore(parseScore(score([{ at: 0, chord: "C", strum: "DU" }])));
    const [down, up] = events;
    expect(down?.strum?.offsets[0]).toBe(0);
    expect(down?.strum?.offsets).toEqual([...(down?.strum?.offsets ?? [])].sort((a, b) => a - b));
    expect(up?.strum?.offsets[3]).toBe(0);
    const total = down?.strum?.offsets[3] ?? 0;
    expect(total).toBeGreaterThan(0.045 * 0.7);
    expect(total).toBeLessThan(0.045 * 1.3);
  });

  it("is loose but seeded: the same seed gives the same strum, another seed a different one", () => {
    const at = (seed: number) => expandScore(parseScore({ ...score([{ at: 1, chord: "F", strum: "down" }]), seed })).events[0];
    expect(at(1)).toEqual(at(1));
    expect(at(1)?.strum?.offsets).not.toEqual(at(2)?.strum?.offsets);
  });

  it("keeps a stroke on a cue exactly on it", () => {
    const { events } = expandScore(parseScore(score([{ at: "hit", chord: "C", strum: "down" }])));
    expect(events[0]).toMatchObject({ seconds: 2, cue: "hit" });
  });

  it("needs a chord", () => {
    expect(checkScore(score([{ at: 0, pitch: "C4", strum: "down" }])).errors[0]?.message).toBe("`strum` needs a chord.");
  });

  it("reports one timing-map entry per stroke, with its chord and direction", () => {
    const { timing } = render(parseScore(score([{ at: 0, chord: "G7", strum: "DU" }])));
    expect(timing.notes.map((n) => [n.chord, n.strum])).toEqual([
      ["G7", "down"],
      ["G7", "up"],
    ]);
  });
});
