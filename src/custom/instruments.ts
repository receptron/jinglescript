// A score's instrument table: the built-ins plus the score's own definitions, checked and turned
// into instruments the renderer plays like any other. Whatever a definition says, every custom
// note leaves here finite, DC-blocked, with an onset ramp and an end fade, and at a level balanced
// against the marimba (by loudness, or by peak for very short sounds) and capped.
import { biquadFilter, highShelf, lowpass } from "../dsp/biquad.ts";
import { integratedLoudness } from "../dsp/loudness.ts";
import * as dmath from "../dsp/math.ts";
import type { Issue, IssuePath } from "../events.ts";
import { finish, MIN_ATTACK_SECONDS } from "../instruments/common.ts";
import { INSTRUMENT_NAMES, INSTRUMENTS, isInstrumentName, type InstrumentName } from "../instruments/index.ts";
import type { Instrument, InstrumentDescriptor, SynthInput } from "../instruments/types.ts";
import { midiToFrequency, pitchToMidi } from "../pitch.ts";
import { createRng, streamRng } from "../rng.ts";
import { BUILTIN_DEFINITIONS } from "./builtins.ts";
import { CAP_FADE_SECONDS, followsPitch, isSustained, planOf, renderBlocks } from "./engine.ts";
import { blockForm, BlocksDefinitionSchema, MAX_NOTE_SECONDS, type BlocksDefinition, type Definition, type Layer, type TweakParams } from "./schema.ts";

export type InstrumentTable = ReadonlyMap<string, Instrument>;

/** The rate levels are measured at; a level does not depend on the output rate. */
const LEVEL_RATE = 48000;
/** A note may peak at most this many times a C5 marimba note at full velocity (+12 dB). */
const PEAK_CAP = 4;
/** Sounds shorter than this (from their peak to −20 dB) are balanced by peak, like the built-in impulses. */
const TRANSIENT_SECONDS = 0.1;
/** DC blocker corner, Hz: also removes sub-audio content (a pitch glide that sinks below hearing). */
const DC_HZ = 20;
const END_FADE_SECONDS = 0.01;
/** A delayed layer with a length plays only if this much of it is left. */
const MIN_LAYER_SECONDS = 0.02;

// ---- Levels -----------------------------------------------------------------------------------

interface Reference {
  loudness: number;
  peak: number;
}

const peakOf = (x: ArrayLike<number>): number => {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i] ?? 0));
  return peak;
};

let marimbaReference: Reference | undefined;

/** A C5 marimba note at full velocity: what every instrument is balanced against (as the built-ins' tests do). */
function marimba(): Reference {
  if (marimbaReference === undefined) {
    const x = INSTRUMENTS.marimba.synthesize({
      midi: 72,
      frequency: midiToFrequency(72),
      velocity: 1,
      hold: 1,
      variant: undefined,
      sampleRate: LEVEL_RATE,
      rng: createRng(7),
    });
    marimbaReference = { loudness: integratedLoudness([x, x], LEVEL_RATE), peak: peakOf(x) };
  }
  return marimbaReference;
}

/** The gain that balances a sound against the marimba, from reference notes of it (one per seed). */
function balance(notes: readonly Float32Array[]): number {
  const x = notes[0] ?? new Float32Array(1);
  const peak = peakOf(x);
  if (peak === 0) return 1;
  let peakAt = 0;
  let lastLoud = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i] ?? 0);
    if (v === peak) peakAt = i;
    if (v >= 0.1 * peak) lastLoud = i;
  }
  // A short sound's peak depends on its noise: average it over the seeds.
  if ((lastLoud - peakAt) / LEVEL_RATE < TRANSIENT_SECONDS) return marimba().peak / (notes.reduce((sum, n) => sum + peakOf(n), 0) / notes.length);
  const loudness = integratedLoudness([x, x], LEVEL_RATE);
  return Number.isFinite(loudness) ? dmath.dbToGain(marimba().loudness - loudness) : marimba().peak / peak;
}

// ---- Finishing --------------------------------------------------------------------------------

/** In place: non-finite samples are a bug, but never reach the mix. */
function sanitize(x: Float32Array): void {
  if (!x.every(Number.isFinite)) x.fill(0);
}

/** In place: a one-pole DC blocker. */
function blockDc(x: Float32Array, sampleRate: number): void {
  const r = dmath.exp((-2 * Math.PI * DC_HZ) / sampleRate);
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i] ?? 0;
    const y0 = x0 - x1 + r * y1;
    x[i] = y0;
    x1 = x0;
    y1 = y0;
  }
}

/** In place: scales a note down if it peaks above the cap. */
function capPeak(x: Float32Array): void {
  const peak = peakOf(x);
  const cap = PEAK_CAP * marimba().peak;
  if (peak > cap) for (let i = 0; i < x.length; i++) x[i] = (x[i] ?? 0) * (cap / peak);
}

// ---- Blocks -----------------------------------------------------------------------------------

/** Balancing gains per definition and decay scale; the same definition always gets the same gain. */
const levelCache = new Map<string, number>();
const LEVEL_CACHE_SIZE = 512;

/** Seeds of the reference notes a level is measured on. */
const REFERENCE_SEEDS = [7, 1, 2, 3, 4];

function referenceInput(definition: BlocksDefinition, pitched: boolean, seed: number): SynthInput {
  return {
    midi: pitched ? 72 : undefined,
    frequency: pitched ? midiToFrequency(72) : undefined,
    velocity: 1,
    hold: definition.length ?? 1,
    variant: undefined,
    sampleRate: LEVEL_RATE,
    rng: createRng(seed),
  };
}

/** One finished note of a blocks definition at unit gain (before velocity and level). */
function rawBlocksNote(definition: BlocksDefinition, input: SynthInput, scale: number, gain: number): Float32Array {
  const { out, cut } = renderBlocks(definition, input, scale);
  sanitize(out);
  blockDc(out, input.sampleRate);
  return finish(out, { attack: MIN_ATTACK_SECONDS, endFade: cut ? CAP_FADE_SECONDS : END_FADE_SECONDS, gain }, input.sampleRate);
}

function blocksLevel(definition: BlocksDefinition, pitched: boolean, scale: number): number {
  const key = `${scale}|${JSON.stringify(definition)}`;
  const cached = levelCache.get(key);
  if (cached !== undefined) return cached;
  const gain = balance(REFERENCE_SEEDS.map((seed) => rawBlocksNote(definition, referenceInput(definition, pitched, seed), scale, 1)));
  if (levelCache.size >= LEVEL_CACHE_SIZE) levelCache.clear();
  levelCache.set(key, gain);
  return gain;
}

/** The descriptor a blocks definition implies. */
export function blocksDescriptor(definition: BlocksDefinition): InstrumentDescriptor {
  const plan = planOf(definition);
  const pitchFollowing = plan.sources.some(followsPitch);
  const sfx = definition.kind === "sfx";
  const withLength = sfx && definition.length !== undefined;
  return {
    kind: definition.kind,
    description: definition.description ?? (sfx ? "Custom sound effect built from blocks." : "Custom instrument built from blocks."),
    pitched: pitchFollowing && !sfx,
    ...(pitchFollowing && sfx ? { pitchOptional: true, defaultFrequency: midiToFrequency(pitchToMidi(definition.pitch ?? "A4") ?? 69) } : {}),
    ...(withLength ? { duration: { defaultSeconds: definition.length ?? 1, maxSeconds: MAX_NOTE_SECONDS } } : {}),
    sustained: !withLength && isSustained(plan),
    range: pitchFollowing ? { low: "C1", high: "C8" } : null,
    variants: [],
    transpose: 0,
    synthetic: false,
  };
}

/** A blocks definition as an instrument, its notes rendered at `scale` × every decay time. */
export function blocksInstrument(definition: BlocksDefinition, scale = 1): Instrument {
  const descriptor = blocksDescriptor(definition);
  const pitched = descriptor.pitched || descriptor.pitchOptional === true;
  return {
    descriptor,
    synthesize(input) {
      const x = rawBlocksNote(definition, input, scale, input.velocity * blocksLevel(definition, pitched && descriptor.pitched, scale));
      capPeak(x);
      return x;
    },
  };
}

// ---- Tweaks and layers --------------------------------------------------------------------------

interface Tweak {
  params: TweakParams | undefined;
  variant: string | undefined;
  transpose: number;
  detune: number;
  gain: number;
}

/** Brightness as a filter: a low-pass closing to ~600 Hz at -1, a high shelf up to +12 dB above 3 kHz at +1. */
function brighten(x: Float32Array, brightness: number, sampleRate: number): Float32Array {
  if (brightness === 0) return x;
  const filter =
    brightness < 0
      ? lowpass(Math.min(sampleRate * 0.45, 16000 * dmath.pow(2, 4.7 * brightness)), Math.SQRT1_2, sampleRate)
      : highShelf(3000, 12 * brightness, sampleRate);
  return Float32Array.from(biquadFilter(x, filter));
}

/** Shortens a ring: an extra exponential decay reaching −60 dB at `decay` × the note's length, then cut there. */
function damp(x: Float32Array, decay: number, sampleRate: number): Float32Array {
  const length = Math.max(Math.round(0.05 * sampleRate), Math.round(x.length * decay));
  const out = x.slice(0, Math.min(x.length, length));
  const fall = dmath.exp(-6.9 / length);
  let g = 1;
  for (let i = 0; i < out.length; i++) {
    out[i] = (out[i] ?? 0) * g;
    g *= fall;
  }
  return out;
}

/** Sounds that follow a note's pitch (always, or when given one). */
const takesPitch = (d: InstrumentDescriptor): boolean => d.pitched || d.pitchOptional === true;

/**
 * A note's pitch moved by `shift` semitones and `detune` cents. A note without a pitch plays the
 * base's default pitch, so a transpose or detune moves that one.
 */
function retune(
  input: SynthInput,
  base: InstrumentDescriptor,
  shift: number,
  detune: number,
): { frequency: number | undefined; midi: number | undefined; retune: number | undefined } {
  if (input.frequency !== undefined) {
    return { frequency: input.frequency * dmath.pow(2, (shift * 100 + detune) / 1200), midi: (input.midi ?? 69) + shift, retune: undefined };
  }
  const cents = shift * 100 + detune + (input.retune ?? 0);
  if (cents === 0) return { frequency: undefined, midi: input.midi, retune: undefined };
  // A stack of layers has no one default: pass the move on to each layer.
  if (base.defaultFrequency === undefined) return { frequency: undefined, midi: input.midi, retune: cents };
  const frequency = base.defaultFrequency * dmath.pow(2, cents / 1200);
  return { frequency, midi: 69 + 12 * dmath.log2(frequency / 440), retune: undefined };
}

/** The base's notes with a tweak applied. `ownTranspose`: apply the base's written-to-sounding transpose here (inside layers). */
function tweaked(base: Instrument, definition: BlocksDefinition | undefined, tweak: Tweak, ownTranspose: boolean): Instrument {
  const decay = tweak.params?.decay ?? 1;
  const viaBlocks = definition !== undefined && decay !== 1 ? blocksInstrument(definition, decay) : undefined;
  const pitchable = takesPitch(base.descriptor);
  return {
    descriptor: base.descriptor,
    synthesize(input) {
      const shift = (ownTranspose ? base.descriptor.transpose : 0) + tweak.transpose;
      const pitch = pitchable ? retune(input, base.descriptor, shift, tweak.detune) : { frequency: undefined, midi: undefined, retune: undefined };
      const note: SynthInput = { ...input, ...pitch, variant: tweak.variant ?? input.variant };
      let x = viaBlocks === undefined ? base.synthesize(note) : viaBlocks.synthesize(note);
      if (viaBlocks === undefined && decay < 1) x = damp(x, decay, input.sampleRate);
      x = brighten(x, tweak.params?.brightness ?? 0, input.sampleRate);
      sanitize(x);
      finish(x, { attack: tweak.params?.attack ?? MIN_ATTACK_SECONDS, endFade: END_FADE_SECONDS, gain: dmath.dbToGain(tweak.gain) }, input.sampleRate);
      capPeak(x);
      return x;
    },
  };
}

function layered(layers: readonly { instrument: Instrument; delay: number }[]): Instrument["synthesize"] {
  return (input) => {
    const seed = Math.floor(input.rng.next() * 4294967296);
    // In a chord, a layer without pitch (an impact, a clap) plays with the first pitch only.
    const firstOfChord = (input.chordVoice ?? 0) === 0;
    const parts = layers
      .map((layer, k) => ({ layer, k }))
      .filter(({ layer }) => firstOfChord || takesPitch(layer.instrument.descriptor))
      // A layer with a length that starts late is shortened by its delay, so the stack still ends at `len`.
      .map(({ layer, k }) => ({ layer, k, hold: layer.instrument.descriptor.duration === undefined ? input.hold : input.hold - layer.delay }))
      .filter(({ layer, hold }) => layer.instrument.descriptor.duration === undefined || hold >= MIN_LAYER_SECONDS)
      .map(({ layer, k, hold }) => ({
        offset: Math.round(layer.delay * input.sampleRate),
        x: layer.instrument.synthesize({ ...input, hold, rng: streamRng(seed, "layer", k) }),
      }));
    if (parts.length === 0) return new Float32Array(1);
    const out = new Float32Array(Math.max(...parts.map((p) => p.offset + p.x.length)));
    for (const { offset, x } of parts) for (let i = 0; i < x.length; i++) out[offset + i] = (out[offset + i] ?? 0) + (x[i] ?? 0);
    capPeak(out);
    return out;
  };
}

/** What a stack of layers is, from what its layers are. */
function layeredDescriptor(parts: readonly Instrument[], description: string | undefined): InstrumentDescriptor {
  const descriptors = parts.map((p) => p.descriptor);
  const pitchedOnes = descriptors.filter((d) => d.pitched);
  const pitched = pitchedOnes.length > 0;
  const lows = pitchedOnes.map((d) => pitchToMidi(d.range?.low ?? "C0") ?? 0);
  const highs = pitchedOnes.map((d) => pitchToMidi(d.range?.high ?? "C8") ?? 127);
  const low = Math.max(...lows);
  const high = Math.min(...highs);
  const duration = descriptors.find((d) => d.duration !== undefined)?.duration;
  const tuning = pitchedOnes.find((d) => d.tuning !== undefined)?.tuning;
  return {
    kind: descriptors.every((d) => d.kind === "sfx") ? "sfx" : "instrument",
    description: description ?? "Custom: several sounds layered.",
    pitched,
    ...(!pitched && descriptors.some((d) => d.pitchOptional === true) ? { pitchOptional: true } : {}),
    ...(duration === undefined ? {} : { duration }),
    ...(descriptors.every((d) => d.transient === true) ? { transient: true } : {}),
    sustained: descriptors.some((d) => d.sustained),
    range: pitched ? { low: NOTE_NAMES_BY_MIDI(low), high: NOTE_NAMES_BY_MIDI(high) } : null,
    variants: [],
    ...(tuning === undefined ? {} : { tuning }),
    transpose: 0,
    synthetic: descriptors.some((d) => d.synthetic),
  };
}

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function NOTE_NAMES_BY_MIDI(midi: number): string {
  return `${SHARP_NAMES[((midi % 12) + 12) % 12] ?? "C"}${Math.floor(midi / 12) - 1}`;
}

/** Range of a tweaked base: written pitches that sound inside the base's range. */
function shiftedRange(range: InstrumentDescriptor["range"], transpose: number): InstrumentDescriptor["range"] {
  if (range === null || transpose === 0) return range;
  return { low: NOTE_NAMES_BY_MIDI((pitchToMidi(range.low) ?? 0) - transpose), high: NOTE_NAMES_BY_MIDI((pitchToMidi(range.high) ?? 127) - transpose) };
}

// ---- Building the table ---------------------------------------------------------------------

/** Placeholder for a definition with errors: the score is invalid anyway, and its notes should not add more errors. */
const BROKEN: Instrument = {
  descriptor: {
    kind: "instrument",
    description: "",
    pitched: false,
    pitchOptional: true,
    sustained: false,
    range: null,
    variants: [],
    transpose: 0,
    synthetic: false,
  },
  synthesize: (input) => new Float32Array(Math.max(1, Math.round(0.01 * input.sampleRate))),
};

const builtinList = INSTRUMENT_NAMES.join(", ");

class Builder {
  readonly table = new Map<string, Instrument>();
  readonly issues: Issue[] = [];
  private readonly resolving = new Set<string>();
  private readonly definitions: Readonly<Record<string, Definition>>;

  constructor(definitions: Readonly<Record<string, Definition>>) {
    this.definitions = definitions;
    for (const name of INSTRUMENT_NAMES) this.table.set(name, INSTRUMENTS[name]);
  }

  build(): void {
    for (const name of Object.keys(this.definitions)) {
      if (isInstrumentName(name)) {
        this.issues.push({
          path: ["instruments", name],
          message: `"${name}" is a built-in instrument.`,
          hint: `Give yours another name, e.g. "my${name.charAt(0).toUpperCase()}${name.slice(1)}".`,
        });
        continue;
      }
      this.resolve(name, ["instruments", name]);
    }
  }

  /** The instrument a name stands for (built-in or custom), building custom ones on first use. */
  private resolve(name: string, path: IssuePath): Instrument | undefined {
    const known = this.table.get(name);
    if (known !== undefined) return known;
    const definition = this.definitions[name];
    if (definition === undefined || isInstrumentName(name)) return undefined;
    if (this.resolving.has(name)) {
      this.issues.push({ path, message: `A loop of bases: "${name}" leads back to itself.`, hint: "Base one of them on a built-in instead." });
      return undefined;
    }
    this.resolving.add(name);
    const before = this.issues.length;
    const instrument = this.define(name, definition);
    this.resolving.delete(name);
    const result = this.issues.length > before || instrument === undefined ? BROKEN : instrument;
    this.table.set(name, result);
    return result;
  }

  private define(name: string, definition: Definition): Instrument | undefined {
    const path: IssuePath = ["instruments", name];
    if ("blocks" in definition) return this.defineBlocks(definition, path);
    if ("layers" in definition) {
      const parts = definition.layers.map((layer, k) => this.layer(layer, [...path, "layers", k]));
      const ready = parts.filter((p) => p !== undefined);
      if (ready.length !== parts.length) return undefined;
      // Each layer's range as written: a layer transposed up an octave takes notes an octave lower.
      const written = ready.map((p, k) => ({
        ...p.instrument,
        descriptor: { ...p.instrument.descriptor, range: shiftedRange(p.instrument.descriptor.range, definition.layers[k]?.transpose ?? 0) },
      }));
      const descriptor = layeredDescriptor(written, definition.description);
      const range = descriptor.range;
      if (range !== null && (pitchToMidi(range.low) ?? 0) > (pitchToMidi(range.high) ?? 0)) {
        const ranges = written
          .map((w, k) => (w.descriptor.pitched && w.descriptor.range !== null ? `layers[${k}] ${w.descriptor.range.low}–${w.descriptor.range.high}` : ""))
          .filter(Boolean);
        this.issues.push({
          path: [...path, "layers"],
          message: `The pitched layers share no note they can all play (written ranges: ${ranges.join(", ")}).`,
          hint: "Transpose the layers so their ranges overlap.",
        });
        return undefined;
      }
      return { descriptor, synthesize: layered(ready) };
    }
    const part = this.layer({ ...definition, delay: 0 }, path, false);
    if (part === undefined) return undefined;
    const base = part.base.descriptor;
    const descriptor: InstrumentDescriptor = {
      ...base,
      description: definition.description ?? `Custom: ${definition.base} with adjustments.`,
      range: shiftedRange(base.range, definition.transpose ?? 0),
      variants: definition.variant === undefined ? base.variants : [],
    };
    return { descriptor, synthesize: part.instrument.synthesize };
  }

  /** One base with its tweak; inside layers the base's own transpose is applied here. */
  private layer(layer: Layer, path: IssuePath, inLayers = true): { instrument: Instrument; base: Instrument; delay: number } | undefined {
    const base = this.resolve(layer.base, [...path, "base"]);
    if (base === undefined) {
      this.unknownBase(layer.base, [...path, "base"]);
      return undefined;
    }
    if (base === BROKEN) return undefined;
    const definition = isInstrumentName(layer.base) ? builtinDefinition(layer.base) : this.blocksOf(layer.base);
    const problems = layerIssues(layer, base.descriptor, definition !== undefined, path);
    if (problems.length > 0) {
      this.issues.push(...problems);
      return undefined;
    }
    const tweak: Tweak = { params: layer.params, variant: layer.variant, transpose: layer.transpose ?? 0, detune: layer.detune ?? 0, gain: layer.gain ?? 0 };
    return { instrument: tweaked(base, definition, tweak, inLayers), base, delay: layer.delay ?? 0 };
  }

  private unknownBase(name: string, path: IssuePath): void {
    // A loop of bases has already been reported here.
    if (this.issues.some((i) => i.path.join(".") === path.join("."))) return;
    const custom = Object.keys(this.definitions).filter((n) => !isInstrumentName(n));
    this.issues.push({
      path,
      message: `Unknown base "${name}".`,
      hint: [`Built-in: ${builtinList}.`, custom.length > 0 ? `Custom: ${custom.join(", ")}.` : ""].join(" ").trim(),
    });
  }

  /** A custom blocks definition by name (for tweaking a custom instrument's decay). */
  private blocksOf(name: string): BlocksDefinition | undefined {
    const definition = this.definitions[name];
    return definition !== undefined && "blocks" in definition ? definition : undefined;
  }

  private defineBlocks(definition: BlocksDefinition, path: IssuePath): Instrument | undefined {
    const problems = [...blockIssues(definition, path), ...kindIssues(definition, path)];
    if (problems.length > 0) {
      this.issues.push(...problems);
      return undefined;
    }
    return blocksInstrument(definition);
  }
}

/** What is wrong with a base's adjustments. */
function layerIssues(layer: Layer, d: InstrumentDescriptor, hasDefinition: boolean, path: IssuePath): Issue[] {
  const issues: Issue[] = [];
  if (layer.variant !== undefined && !d.variants.includes(layer.variant)) {
    issues.push({
      path: [...path, "variant"],
      message: `"${layer.base}" has no variant "${layer.variant}".`,
      hint: d.variants.length > 0 ? `Variants: ${d.variants.join(", ")}.` : `"${layer.base}" has no variants; remove \`variant\`.`,
    });
  }
  if ((layer.transpose ?? 0) !== 0 && !d.pitched && d.pitchOptional !== true) {
    issues.push({ path: [...path, "transpose"], message: `"${layer.base}" has no pitch to transpose.`, hint: "Remove `transpose`." });
  }
  const decay = layer.params?.decay;
  if (decay === undefined || hasDefinition) return issues;
  if (decay > 1) {
    issues.push({
      path: [...path, "params", "decay"],
      message: `"${layer.base}"'s ring can only be shortened (decay up to 1).`,
      hint: "Use a base that has a block definition (getInstrument shows `definition`), or build the sound from blocks.",
    });
  } else if (d.sustained || d.duration !== undefined) {
    issues.push({
      path: [...path, "params", "decay"],
      message: `"${layer.base}" holds for its \`len\`; \`decay\` applies to sounds that ring out.`,
      hint: "Make its notes shorter with `len` instead.",
    });
  }
  return issues;
}

/** What is wrong with the blocks themselves: no source, repeated shapers, contradictory settings. */
function blockIssues(definition: BlocksDefinition, path: IssuePath): Issue[] {
  const issues: Issue[] = [];
  const count = (test: (block: BlocksDefinition["blocks"][number]) => boolean): number => definition.blocks.filter(test).length;
  const plan = planOf(definition);
  if (plan.sources.length === 0) {
    issues.push({ path: [...path, "blocks"], message: "No sound source.", hint: 'Add at least one of osc, modes, noise or string, e.g. { "osc": "sine" }.' });
  }
  const repeated: [string, number][] = [
    // A source's own `env` is part of that source, not an `env` block.
    ["`env` block", count((b) => blockForm(b) === "env")],
    ["`pitchEnv` block", count((b) => blockForm(b) === "pitchEnv")],
    ["vibrato", count((b) => "lfo" in b && b.lfo === "vibrato")],
    ["tremolo", count((b) => "lfo" in b && b.lfo === "tremolo")],
  ];
  for (const [what, n] of repeated) {
    if (n > 1)
      issues.push({ path: [...path, "blocks"], message: `More than one ${what}.`, hint: "Keep one; give a source its own `env` to shape it separately." });
  }
  if (plan.sources.some((s) => "string" in s) && (plan.pitchEnv !== undefined || plan.vibrato !== undefined)) {
    issues.push({
      path: [...path, "blocks"],
      message: "A plucked `string` keeps its pitch: `pitchEnv` and vibrato do not apply to it.",
      hint: "Use osc or modes for a gliding or wobbling pitch, or make the string a separate instrument and layer the two.",
    });
  }
  definition.blocks.forEach((block, k) => {
    const at: IssuePath = [...path, "blocks", k];
    if ("lfo" in block && block.lfo === "tremolo" && (block.depth ?? 0) > 1) {
      issues.push({ path: [...at, "depth"], message: "A tremolo's depth is 0–1 (how far the level dips).", hint: "e.g. 0.25." });
    }
    if ("noise" in block && [block.burst, block.decay, block.env].filter((v) => v !== undefined).length > 1) {
      issues.push({
        path: at,
        message: "Give a noise one of `burst`, `decay` or `env`.",
        hint: "burst: a click at the start; decay: fades from the onset; env: an envelope.",
      });
    }
  });
  return issues;
}

/** `pitch` and `length` belong to sound effects, and a pitched effect needs a default pitch. */
function kindIssues(definition: BlocksDefinition, path: IssuePath): Issue[] {
  if (definition.kind === "instrument") {
    return (["pitch", "length"] as const)
      .filter((field) => definition[field] !== undefined)
      .map((field) => ({ path: [...path, field], message: `\`${field}\` is for sound effects.`, hint: 'Add "kind": "sfx", or remove it.' }));
  }
  if (planOf(definition).sources.some(followsPitch) && definition.pitch === undefined) {
    return [
      {
        path: [...path, "pitch"],
        message: "This effect has pitched blocks but no default `pitch`.",
        hint: 'Add "pitch": "C6" (notes may still give their own).',
      },
    ];
  }
  return [];
}

/** A built-in's definition in the block vocabulary, parsed (defaults filled in), if it has one. */
const parsedBuiltins = new Map<InstrumentName, BlocksDefinition>();
export function builtinDefinition(name: InstrumentName): BlocksDefinition | undefined {
  const cached = parsedBuiltins.get(name);
  if (cached !== undefined) return cached;
  const source = BUILTIN_DEFINITIONS[name];
  if (source === undefined) return undefined;
  const parsed = BlocksDefinitionSchema.parse(source);
  parsedBuiltins.set(name, parsed);
  return parsed;
}

/** The score's instruments: built-ins and its own definitions, and what is wrong with the definitions. */
export function buildInstruments(definitions: Readonly<Record<string, Definition>> | undefined): { table: InstrumentTable; issues: Issue[] } {
  const builder = new Builder(definitions ?? {});
  builder.build();
  return { table: builder.table, issues: builder.issues };
}
