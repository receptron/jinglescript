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

  it("plays a pistol shot on Gunshot, leaves silent notes out, and counts tracks past 255", () => {
    const shots = parseScore({
      format: "jinglescript/1",
      tempo: 120,
      length: { beats: 2 },
      instruments: { bang: { base: "pistol" } },
      tracks: [
        { instrument: "pistol", notes: [{ at: 0 }] },
        { instrument: "bang", notes: [{ at: 1 }] },
        {
          instrument: "marimba",
          notes: [
            { at: 0, pitch: "C5", vel: 0 },
            { at: 1, pitch: "D5" },
          ],
        },
      ],
    });
    const [, pistol, bang, marimba] = readMidi(scoreToMidi(shots)).tracks;
    expect(pistol?.find((e) => (e.status & 0xf0) === 0xc0)?.data).toEqual([127]);
    expect(notesOn(pistol ?? []).map((e) => [e.tick, e.data[0]])).toEqual([[0, 60]]);
    expect(notesOn(bang ?? []).map((e) => [e.tick, e.data[0]])).toEqual([[480, 60]]);
    expect(notesOn(marimba ?? []).map((e) => e.data[0])).toEqual([74]);
    const many = parseScore({
      format: "jinglescript/1",
      tempo: 120,
      length: { beats: 1 },
      tracks: Array.from({ length: 300 }, () => ({ instrument: "marimba", notes: [{ at: 0, pitch: "C5" }] })),
    });
    expect(readMidi(scoreToMidi(many)).tracks).toHaveLength(301);
  });

  it("transposes through nested bases and a stack's first layer, and starts after its delay", () => {
    const nested = parseScore({
      format: "jinglescript/1",
      tempo: 120,
      length: { beats: 1 },
      instruments: {
        high: { base: "piano", transpose: 12 },
        higher: { base: "high" },
        stack: { layers: [{ base: "piano", transpose: -12, delay: 0.25 }, { base: "impact" }] },
      },
      tracks: [
        { instrument: "higher", notes: [{ at: 0, pitch: "C4" }] },
        { instrument: "stack", notes: [{ at: 0, pitch: "C4" }] },
      ],
    });
    const [, higher, stack] = readMidi(scoreToMidi(nested)).tracks;
    expect(notesOn(higher ?? [])[0]?.data[0]).toBe(72);
    expect(notesOn(stack ?? []).map((e) => [e.tick, e.data[0]])).toEqual([[240, 48]]);
  });

  it("shares channels by sound past 15 melodic tracks, and ends a key before another track strikes it", () => {
    const wide = parseScore({
      format: "jinglescript/1",
      tempo: 120,
      length: { beats: 4 },
      tracks: Array.from({ length: 20 }, (_, i) => ({
        instrument: i % 2 === 0 ? "marimba" : "vibraphone",
        notes: [{ at: i * 0.125, pitch: "C5", len: 3 }],
      })),
    });
    const tracks = readMidi(scoreToMidi(wide)).tracks.slice(1);
    const programs = new Map<number, number>();
    for (const track of tracks) {
      const change = track.find((e) => (e.status & 0xf0) === 0xc0);
      const channel = (change?.status ?? 0) & 0x0f;
      expect(programs.get(channel) ?? change?.data[0]).toBe(change?.data[0]);
      programs.set(channel, change?.data[0] ?? -1);
    }
    expect([...programs.values()].sort((a, b) => a - b)).toEqual([11, 12]);
    const marimba = tracks.filter((_, i) => i % 2 === 0);
    const ons = marimba.flatMap((track) => notesOn(track).map((e) => e.tick));
    const offs = marimba.flatMap((track) => notesOff(track).map((e) => e.tick));
    expect(ons).toEqual([0, 120, 240, 360, 480, 600, 720, 840, 960, 1080]);
    expect(offs.slice(0, -1)).toEqual(ons.slice(1).map((tick) => tick - 1));
  });

  it("ends a shared key struck together at the later end, and plays nothing past the score's length", () => {
    const together = parseScore({
      format: "jinglescript/1",
      tempo: 120,
      length: { beats: 4 },
      instruments: {
        late: { layers: [{ base: "piano", delay: 1 }, { base: "impact" }] },
        lateSwoosh: { layers: [{ base: "whoosh", delay: 1 }, { base: "pop" }] },
      },
      tracks: [
        { instrument: "organ", notes: [{ at: 0, pitch: "C5", len: 1 }] },
        { instrument: "organ", notes: [{ at: 0, pitch: "C5", len: 3 }] },
        { instrument: "organ", notes: [{ at: 3, pitch: "E5", len: 4 }] },
        { instrument: "late", notes: [{ at: 3, pitch: "A4" }] },
        { instrument: "lateSwoosh", notes: [{ at: 0 }, { at: 3 }] },
        ...Array.from({ length: 14 }, () => ({ instrument: "organ", notes: [{ at: 0, pitch: "G4", len: 1 }] })),
      ],
    });
    const midi = readMidi(scoreToMidi(together));
    const [timing, short, long, late, delayed, swoosh] = midi.tracks;
    expect(notesOff(short ?? []).map((e) => e.tick)).toEqual([1440]);
    expect(notesOff(long ?? []).map((e) => e.tick)).toEqual([1440]);
    expect(notesOff(late ?? []).map((e) => e.tick)).toEqual([1920]);
    expect(notesOn(delayed ?? [])).toHaveLength(0);
    expect(metas(swoosh ?? [], 0x06).map((e) => e.tick)).toEqual([960]);
    expect(midi.tracks.map((track) => track.at(-1)?.tick)).toEqual(midi.tracks.map(() => timing?.at(-1)?.tick));
  });

  it("ends notes of a shared key struck a tick apart together, after the last of them", () => {
    const close = parseScore({
      format: "jinglescript/1",
      tempo: 120,
      length: { beats: 4 },
      tracks: Array.from({ length: 16 }, (_, i) => ({
        instrument: "organ",
        notes: [{ at: i < 3 ? { seconds: (i * 1) / 960 } : 2, pitch: i < 3 ? "C5" : "G4", len: 1 }],
      })),
    });
    const tracks = readMidi(scoreToMidi(close)).tracks.slice(1, 4);
    expect(tracks.map((track) => notesOn(track)[0]?.tick)).toEqual([0, 1, 2]);
    expect(tracks.map((track) => notesOff(track)[0]?.tick)).toEqual([482, 482, 482]);
  });

  it("is the same for the same score, and reads every example", () => {
    expect(scoreToMidi(score)).toEqual(scoreToMidi(score));
    for (const name of ["a-ukulele.json", "lyrics-hatena.json", "custom-zap.json", "riser-reveal.json"]) {
      const example = parseScore(JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8")));
      expect(readMidi(scoreToMidi(example)).tracks).toHaveLength(example.tracks.length + 1);
    }
  });
});
