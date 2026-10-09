import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getInstrument } from "../src/llm.ts";
import { scoreToMidi } from "../src/midi.ts";
import { parseScore } from "../src/score.ts";

interface Event {
  tick: number;
  status: number;
  data: number[];
  /** Meta events: their type and text. */
  meta?: number;
  text?: string;
}

/** A minimal Standard MIDI File reader: the header, and each track's events with absolute ticks. */
function readMidi(bytes: Uint8Array): { format: number; ppq: number; tracks: Event[][] } {
  let pos = 0;
  const u8 = (): number => bytes[pos++] ?? Number.NaN;
  const u16 = (): number => (u8() << 8) | u8();
  const u32 = (): number => ((u16() << 16) | u16()) >>> 0;
  const vlq = (): number => {
    let value = 0;
    for (;;) {
      const byte = u8();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
  };
  const tag = (): string => String.fromCharCode(u8(), u8(), u8(), u8());
  expect(tag()).toBe("MThd");
  expect(u32()).toBe(6);
  const format = u16();
  const count = u16();
  const ppq = u16();
  const tracks: Event[][] = [];
  for (let t = 0; t < count; t++) {
    expect(tag()).toBe("MTrk");
    const end = u32() + pos;
    const events: Event[] = [];
    let tick = 0;
    while (pos < end) {
      tick += vlq();
      const status = u8();
      if (status === 0xff) {
        const meta = u8();
        const data = Array.from(bytes.subarray(pos + 1, pos + 1 + (bytes[pos] ?? 0)));
        pos += 1 + data.length;
        events.push({ tick, status, data, meta, text: new TextDecoder().decode(Uint8Array.from(data)) });
      } else {
        const data = (status & 0xf0) === 0xc0 ? [u8()] : [u8(), u8()];
        events.push({ tick, status, data });
      }
    }
    expect(pos).toBe(end);
    expect(events.at(-1)?.meta).toBe(0x2f);
    tracks.push(events);
  }
  expect(pos).toBe(bytes.length);
  return { format, ppq, tracks };
}

const notesOn = (events: Event[]): Event[] => events.filter((e) => (e.status & 0xf0) === 0x90);
const notesOff = (events: Event[]): Event[] => events.filter((e) => (e.status & 0xf0) === 0x80);
const metas = (events: Event[], type: number): Event[] => events.filter((e) => e.meta === type);

const score = parseScore({
  format: "jinglescript/1",
  title: "Midi test",
  tempo: 120,
  length: { beats: 8 },
  cues: { hit: { beats: 4 } },
  tracks: [
    {
      name: "melody",
      instrument: "marimba",
      notes: [
        { at: 0, pitch: "C5", lyric: "ha" },
        { at: 1, pitch: "C5", lyric: "ro" },
        { at: "hit", chord: "C", vel: 1 },
      ],
    },
    { instrument: "glockenspiel", notes: [{ at: 2, pitch: "C5" }] },
    { instrument: "clap", notes: [{ at: 1, repeat: { every: 1, count: 3 } }] },
    { instrument: "whoosh", notes: [{ end: "hit" }] },
  ],
});

describe("scoreToMidi", () => {
  const midi = readMidi(scoreToMidi(score));
  const [timing, melody, glocken, clap, whoosh] = midi.tracks;

  it("writes a type 1 file: a timing track with the tempo and cues, then a track per score track", () => {
    expect(midi.format).toBe(1);
    expect(midi.ppq).toBe(480);
    expect(midi.tracks).toHaveLength(5);
    expect(metas(timing ?? [], 0x03)[0]?.text).toBe("Midi test");
    expect(metas(timing ?? [], 0x51)[0]?.data).toEqual([0x07, 0xa1, 0x20]);
    expect(metas(timing ?? [], 0x06)).toMatchObject([{ tick: 4 * 480, text: "hit" }]);
    expect(timing?.at(-1)?.tick).toBe(8 * 480);
    expect(metas(melody ?? [], 0x03)[0]?.text).toBe("melody");
  });

  it("plays each note on its beat with its velocity, General MIDI sounds and the drum channel", () => {
    expect(melody?.find((e) => (e.status & 0xf0) === 0xc0)?.data).toEqual([12]);
    expect(notesOn(melody ?? []).map((e) => [e.tick, e.data[0]])).toEqual([
      [0, 72],
      [480, 72],
      [1920, 60],
      [1920, 64],
      [1920, 67],
    ]);
    expect(notesOn(melody ?? []).at(-1)?.data[1]).toBe(127);
    expect(notesOn(clap ?? []).map((e) => [e.status, e.tick, e.data[0]])).toEqual([
      [0x99, 480, 39],
      [0x99, 960, 39],
      [0x99, 1440, 39],
    ]);
    expect(notesOff(clap ?? []).map((e) => e.tick)).toEqual([600, 1080, 1560]);
  });

  it("ends a held key before the same key starts again", () => {
    const [first] = notesOff(melody ?? []);
    expect(first?.data[0]).toBe(72);
    expect(first?.tick).toBeLessThanOrEqual(480);
  });

  it("writes sounding pitches", () => {
    const shift = getInstrument("glockenspiel")?.transpose ?? 0;
    expect(notesOn(glocken ?? [])[0]?.data[0]).toBe(72 + shift);
  });

  it("keeps effects without a General MIDI sound as markers, and lyrics as lyric events", () => {
    expect(notesOn(whoosh ?? [])).toHaveLength(0);
    expect(metas(whoosh ?? [], 0x06).map((e) => e.text)).toEqual(["whoosh"]);
    expect(metas(melody ?? [], 0x05).map((e) => [e.tick, e.text])).toEqual([
      [0, "ha "],
      [480, "ro"],
    ]);
  });

  it("gives a custom instrument its base's sound", () => {
    const custom = parseScore({
      format: "jinglescript/1",
      tempo: 100,
      length: { beats: 2 },
      instruments: { bell: { base: "vibraphone", transpose: 12 }, stack: { layers: [{ base: "piano" }, { base: "impact" }] } },
      tracks: [
        { instrument: "bell", notes: [{ at: 0, pitch: "C4" }] },
        { instrument: "stack", notes: [{ at: 0, pitch: "C4" }] },
      ],
    });
    const [, bell, stack] = readMidi(scoreToMidi(custom)).tracks;
    expect(bell?.find((e) => (e.status & 0xf0) === 0xc0)?.data).toEqual([11]);
    expect(notesOn(bell ?? [])[0]?.data[0]).toBe(72);
    expect(stack?.find((e) => (e.status & 0xf0) === 0xc0)?.data).toEqual([0]);
  });

  it("is the same for the same score, and reads every example", () => {
    expect(scoreToMidi(score)).toEqual(scoreToMidi(score));
    for (const name of ["a-ukulele.json", "lyrics-hatena.json", "custom-zap.json", "riser-reveal.json"]) {
      const example = parseScore(JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8")));
      expect(readMidi(scoreToMidi(example)).tracks).toHaveLength(example.tracks.length + 1);
    }
  });
});
