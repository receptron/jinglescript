// Score → Standard MIDI File (type 1), for editing the jingle in a DAW or notation program. Built
// from the same expanded events as the audio, so every note sits where it sounds: one MIDI track
// per score track, General MIDI sounds for the built-ins, cues as markers and lyrics as lyric
// events. Sound effects with no General MIDI equivalent (a whoosh, a laser) become markers named
// after the effect, so their place is kept.
import type { Expanded, NoteEvent } from "./events.ts";
import { isInstrumentName, type InstrumentName } from "./instruments/index.ts";
import { pitchToMidi } from "./pitch.ts";
import { expandOrThrow } from "./render.ts";
import { JingleScriptError, type Score } from "./score.ts";
import { secondsToBeats } from "./time.ts";

export const MIDI_MIME_TYPE = "audio/midi";

/** Ticks per quarter note. */
const PPQ = 480;
const DRUM_CHANNEL = 9;
/** A MIDI file counts its tracks in 16 bits. */
const MAX_TRACKS = 0xffff;
const TIMING_TRACK_NAME = "cues";

/**
 * A General MIDI program (0-based) on a melodic channel (`key`: the key an unpitched sound plays),
 * a key on the drum channel, or only a marker.
 */
type GmSound = { program: number; key?: number } | { drum: number } | { marker: true };

const GM: Record<InstrumentName, GmSound> = {
  marimba: { program: 12 },
  xylophone: { program: 13 },
  glockenspiel: { program: 9 },
  vibraphone: { program: 11 },
  musicbox: { program: 10 },
  piano: { program: 0 },
  grandpiano: { program: 0 },
  organ: { program: 16 },
  ukulele: { program: 24 },
  piccolo: { program: 72 },
  trumpet: { program: 56 },
  clap: { drum: 39 },
  clock: { drum: 76 },
  knock: { drum: 77 },
  impact: { drum: 49 },
  pistol: { program: 127, key: 60 },
  footsteps: { marker: true },
  heels: { marker: true },
  tapdance: { marker: true },
  laser: { marker: true },
  whoosh: { marker: true },
  riser: { marker: true },
  pop: { marker: true },
};

interface Resolved {
  sound: GmSound;
  /** Semitones from the written pitch to the sounding one. */
  shift: number;
}

/**
 * What a track's instrument is in General MIDI, and how far it transposes: a custom instrument
 * sounds like the built-in it is based on (the first layer's, for a stack), adding each tweak's
 * transpose on the way; one built from blocks sounds like a piano, or is a marker when unpitched.
 */
function resolveSound(name: string, score: Score, expanded: Expanded, seen: ReadonlySet<string> = new Set()): Resolved {
  if (isInstrumentName(name)) return { sound: GM[name], shift: expanded.instruments.get(name)?.descriptor.transpose ?? 0 };
  const definition = score.instruments?.[name];
  let step: { base: string; transpose?: number } | undefined;
  if (definition !== undefined && "base" in definition) step = definition;
  else if (definition !== undefined && "layers" in definition) step = definition.layers[0];
  if (step !== undefined && !seen.has(step.base)) {
    const base = resolveSound(step.base, score, expanded, new Set([...seen, name]));
    return { sound: base.sound, shift: base.shift + (step.transpose ?? 0) };
  }
  const descriptor = expanded.instruments.get(name)?.descriptor;
  return { sound: descriptor?.pitched === true ? { program: 0 } : { marker: true }, shift: descriptor?.transpose ?? 0 };
}

interface MidiEvent {
  tick: number;
  /** Order among events on one tick: meta first, then note-offs, then note-ons. */
  order: number;
  bytes: number[];
}

const encoder = new TextEncoder();

function varLength(value: number): number[] {
  const bytes = [value & 0x7f];
  for (let rest = value >>> 7; rest > 0; rest >>>= 7) bytes.unshift((rest & 0x7f) | 0x80);
  return bytes;
}

function meta(tick: number, type: number, data: readonly number[]): MidiEvent {
  return { tick, order: 0, bytes: [0xff, type, ...varLength(data.length), ...data] };
}

const text = (tick: number, type: number, value: string): MidiEvent => meta(tick, type, [...encoder.encode(value)]);

function chunk(type: string, data: readonly number[]): number[] {
  const length = data.length;
  return [...encoder.encode(type), (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff, ...data];
}

/** A track chunk; it ends at `end` or at its last event, whichever is later. */
function trackChunk(events: MidiEvent[], end: number): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const data: number[] = [];
  let last = 0;
  for (const event of sorted) {
    data.push(...varLength(event.tick - last), ...event.bytes);
    last = event.tick;
  }
  data.push(...varLength(Math.max(end, last) - last), 0xff, 0x2f, 0x00);
  return chunk("MTrk", data);
}

const velocity = (vel: number): number => Math.min(127, Math.max(1, Math.round(vel * 127)));

interface Played {
  key: number;
  on: number;
  off: number;
  velocity: number;
}

/** Drum hits are a sixteenth note long: a drum channel ignores note-offs, but editors draw them. */
const DRUM_TICKS = PPQ / 4;

/** Each pitch of each event as a key held from its onset for its hold (`ticks` instead, when given). */
function playedKeys(
  events: readonly NoteEvent[],
  toTick: (seconds: number) => number,
  keyOf: (pitch: string | undefined) => number | undefined,
  ticks: number | undefined,
): Played[] {
  const played: Played[] = [];
  for (const event of events) {
    const pitches: (string | undefined)[] = event.pitches.length > 0 ? event.pitches : [undefined];
    pitches.forEach((pitch, voice) => {
      const level = event.vel * (event.strum?.weights[voice] ?? 1);
      const key = keyOf(pitch);
      // A silent note (vel 0) is left out: velocity 0 would be a note-off.
      if (level <= 0 || key === undefined || key < 0 || key > 127) return;
      const start = event.seconds + (event.strum?.offsets[voice] ?? 0);
      const on = toTick(start);
      const off = ticks === undefined ? toTick(start + event.hold) : on + ticks;
      played.push({ key, on, off: Math.max(on + 1, off), velocity: velocity(level) });
    });
  }
  return played;
}

/**
 * On one channel a key sounds once, whichever track plays it: notes struck together end together
 * (at the later end, or the first note-off would stop both), a key ends where it starts again, and
 * nothing sounds past `end`, where the audio stops.
 */
function fitChannel(notes: readonly Played[], end: number): void {
  const sorted = [...notes].sort((a, b) => a.on - b.on);
  for (const note of sorted) {
    const together = sorted.filter((other) => other.key === note.key && other.on === note.on);
    const next = sorted.find((other) => other.key === note.key && other.on > note.on);
    const off = Math.min(Math.max(...together.map((other) => other.off)), next?.on ?? end, end);
    note.off = Math.max(note.on + 1, off);
  }
}

const MELODIC_CHANNELS = Array.from({ length: 16 }, (_, channel) => channel).filter((channel) => channel !== DRUM_CHANNEL);

/**
 * A channel per melodic track while they last. With more tracks than channels, tracks share by
 * program, since a program change holds for the whole channel; the built-ins use fewer programs
 * than there are channels.
 */
function assignChannels(sounds: readonly GmSound[]): (number | undefined)[] {
  const melodic = sounds.flatMap((sound, track) => ("program" in sound ? [{ track, program: sound.program }] : []));
  const channels: (number | undefined)[] = sounds.map((sound) => ("drum" in sound ? DRUM_CHANNEL : undefined));
  if (melodic.length <= MELODIC_CHANNELS.length) {
    melodic.forEach(({ track }, i) => (channels[track] = MELODIC_CHANNELS[i]));
    return channels;
  }
  const programs = [...new Set(melodic.map(({ program }) => program))];
  if (programs.length > MELODIC_CHANNELS.length) {
    throw new JingleScriptError([
      {
        path: "tracks",
        message: `MIDI has ${MELODIC_CHANNELS.length} melodic channels; this score needs ${programs.length} different sounds.`,
        hint: "Use fewer instruments.",
      },
    ]);
  }
  for (const { track, program } of melodic) channels[track] = MELODIC_CHANNELS[programs.indexOf(program)];
  return channels;
}

/** The score as a Standard MIDI File (type 1). Throws JingleScriptError for a score that does not render. */
export function scoreToMidi(score: Score): Uint8Array {
  const expanded = expandOrThrow(score);
  const toTick = (seconds: number): number => Math.max(0, Math.round(secondsToBeats(seconds, expanded.tempo) * PPQ));
  const tempo = Math.round(60_000_000 / expanded.tempo);
  const timingTrack: MidiEvent[] = [
    text(0, 0x03, score.title ?? TIMING_TRACK_NAME),
    meta(0, 0x51, [(tempo >>> 16) & 0xff, (tempo >>> 8) & 0xff, tempo & 0xff]),
    ...Object.entries(expanded.cues).map(([name, seconds]) => text(toTick(seconds), 0x06, name)),
  ];
  const end = toTick(expanded.duration);
  const syllables = expanded.lyrics.flatMap((line) => line.syllables.map((syllable) => ({ track: line.track, ...syllable })));
  const resolved = score.tracks.map((track) => resolveSound(track.instrument, score, expanded));
  const channels = assignChannels(resolved.map(({ sound }) => sound));
  const played = score.tracks.map((_, index): Played[] => {
    const { sound, shift } = resolved[index] ?? { sound: { marker: true }, shift: 0 };
    if ("marker" in sound) return [];
    const keyOf = (pitch: string | undefined): number | undefined => {
      if ("drum" in sound) return sound.drum;
      if (sound.key !== undefined) return sound.key;
      const written = pitch === undefined ? undefined : pitchToMidi(pitch);
      return written === undefined ? undefined : written + shift;
    };
    const own = expanded.events.filter((event) => event.track === index);
    return playedKeys(own, toTick, keyOf, "drum" in sound ? DRUM_TICKS : undefined);
  });
  for (const channel of new Set(channels)) {
    if (channel !== undefined) fitChannel(played.filter((_, index) => channels[index] === channel).flat(), end);
  }
  const tracks = score.tracks.map((track, index) => {
    const sound = resolved[index]?.sound;
    const channel = channels[index];
    const events: MidiEvent[] = [text(0, 0x03, track.name ?? track.instrument)];
    if (channel === undefined) {
      const own = expanded.events.filter((event) => event.track === index);
      events.push(...own.map((event) => text(toTick(event.seconds), 0x06, track.instrument)));
    } else {
      if (sound !== undefined && "program" in sound) events.push({ tick: 0, order: 0, bytes: [0xc0 | channel, sound.program] });
      for (const note of played[index] ?? []) {
        events.push({ tick: note.on, order: 2, bytes: [0x90 | channel, note.key, note.velocity] });
        events.push({ tick: note.off, order: 1, bytes: [0x80 | channel, note.key, 0] });
      }
    }
    events.push(...syllables.filter((syllable) => syllable.track === index).map((syllable) => text(toTick(syllable.seconds), 0x05, syllable.text)));
    return trackChunk(events, end);
  });
  const count = tracks.length + 1;
  if (count > MAX_TRACKS) {
    throw new JingleScriptError([
      {
        path: "tracks",
        message: `MIDI holds at most ${MAX_TRACKS - 1} tracks; this score has ${tracks.length}.`,
        hint: "Merge tracks that play the same instrument.",
      },
    ]);
  }
  const header = chunk("MThd", [0, 1, count >>> 8, count & 0xff, PPQ >>> 8, PPQ & 0xff]);
  return Uint8Array.from([...header, ...trackChunk(timingTrack, end), ...tracks.flat()]);
}
