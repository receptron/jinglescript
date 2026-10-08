// The block engine: renders one note of a `blocks` definition. Sources (osc, modes, noise,
// string) are mixed; env, filter, pitchEnv and lfo shape the whole sound. Everything that keeps a
// sound clean is done here, whatever the definition says: oscillators are additive and drop every
// harmonic above the partial limit, modes near Nyquist are skipped, filter cutoffs stay below
// 0.45 × the sample rate, notes are capped in length. The onset ramp, end fade, DC blocking and
// level are applied by the caller (src/custom/instruments.ts).
import { sweptFilter, type FilterType } from "../dsp/biquad.ts";
import * as dmath from "../dsp/math.ts";
import { addDampedSine, MAX_PARTIAL_FRACTION, RING_TIME_CONSTANTS } from "../instruments/common.ts";
import type { SynthInput } from "../instruments/types.ts";
import { stringVoice } from "../instruments/ukulele.ts";
import { midiToFrequency, pitchToMidi } from "../pitch.ts";
import { MAX_NOTE_SECONDS, type Block, type BlocksDefinition, type Env, type FilterSettings } from "./schema.ts";

type OscBlock = Extract<Block, { osc: unknown }>;
type ModesBlock = Extract<Block, { modes: unknown }>;
type NoiseBlock = Extract<Block, { noise: unknown }>;
type StringBlock = Extract<Block, { string: unknown }>;
type FilterBlock = Extract<Block, { filter: unknown }>;
type PitchEnv = Extract<Block, { pitchEnv: unknown }>["pitchEnv"];
type Lfo = Extract<Block, { lfo: unknown }>;
type Source = OscBlock | ModesBlock | NoiseBlock | StringBlock;

/** Most harmonics an oscillator adds (fewer when they would pass the partial limit). */
const MAX_HARMONICS = 64;
/** Release of an oscillator that has no envelope at all (an organ-like tone), seconds. */
const BARE_RELEASE_SECONDS = 0.05;
/** Seconds a capped note takes to fade out (a damper). */
export const CAP_FADE_SECONDS = 0.3;
const DEFAULT_NOISE_DECAY = 0.1;
const MIDDLE_C_HZ = 261.63;
const TWO_PI = 2 * Math.PI;

/** The blocks of a definition, sorted by role. Validation (src/custom/instruments.ts) ensures at most one env and pitchEnv. */
export interface Plan {
  sources: Source[];
  env: Env | undefined;
  filters: FilterBlock[];
  pitchEnv: PitchEnv | undefined;
  vibrato: Lfo | undefined;
  tremolo: Lfo | undefined;
}

export function planOf(definition: BlocksDefinition): Plan {
  const plan: Plan = { sources: [], env: undefined, filters: [], pitchEnv: undefined, vibrato: undefined, tremolo: undefined };
  for (const block of definition.blocks) {
    if ("osc" in block || "modes" in block || "noise" in block || "string" in block) plan.sources.push(block);
    else if ("env" in block) plan.env = block.env;
    else if ("filter" in block) plan.filters.push(block);
    else if ("pitchEnv" in block) plan.pitchEnv = block.pitchEnv;
    else if (block.lfo === "vibrato") plan.vibrato = block;
    else plan.tremolo = block;
  }
  return plan;
}

/** Sources that follow the note's pitch. */
export const followsPitch = (source: Source): boolean => "osc" in source || "modes" in source || "string" in source;

const ownEnv = (source: Source): Env | undefined => ("osc" in source || "noise" in source ? source.env : undefined);

/** True when notes hold for their `len`: something sustains rather than ringing out. */
export function isSustained(plan: Plan): boolean {
  if (plan.env !== undefined) {
    if (plan.env.sustain > 0) return true;
    return plan.sources.some((s) => (ownEnv(s)?.sustain ?? 0) > 0);
  }
  return plan.sources.some((s) => {
    const env = ownEnv(s);
    if (env !== undefined) return env.sustain > 0;
    return "osc" in s;
  });
}

/** Seconds an envelope takes to end: to silence for a struck one, through its release for a held one. */
function envSeconds(env: Env, hold: number, scale: number): number {
  return env.sustain > 0 ? Math.max(hold, env.attack) + env.release * scale : env.attack + env.decay * scale;
}

/** Level of an envelope at `t`: linear attack, exponential decay (to silence, or to the sustain level), exponential release after `hold`. */
export function envAt(env: Env, t: number, hold: number, scale: number): number {
  if (t < env.attack) return t / env.attack;
  const fall = dmath.exp((-RING_TIME_CONSTANTS * (t - env.attack)) / (env.decay * scale));
  if (env.sustain === 0) return fall;
  const level = (u: number): number =>
    u < env.attack ? u / env.attack : env.sustain + (1 - env.sustain) * dmath.exp((-RING_TIME_CONSTANTS * (u - env.attack)) / (env.decay * scale));
  if (t <= hold) return level(t);
  return level(hold) * dmath.exp((-RING_TIME_CONSTANTS * (t - hold)) / (env.release * scale));
}

/** Lower notes ring longer: 1× at middle C and above, up to (1 + amount)× two octaves below — the marimba's rule. */
const lowFactor = (amount: number, midi: number): number => 1 + amount * Math.max(0, (60 - midi) / 24);

export interface NotePitch {
  frequency: number;
  midi: number;
}

/** The pitch a note plays: its own, or the definition's default (sound effects), or A4. */
export function pitchOf(definition: BlocksDefinition, input: SynthInput): NotePitch {
  const fallbackMidi = (definition.pitch === undefined ? undefined : pitchToMidi(definition.pitch)) ?? 69;
  return { frequency: input.frequency ?? midiToFrequency(fallbackMidi), midi: input.midi ?? fallbackMidi };
}

/** How long one source rings by itself, seconds (Infinity for a tone that never stops). */
function sourceSeconds(source: Source, plan: Plan, pitch: NotePitch, hold: number, scale: number): number {
  const env = ownEnv(source);
  if (env !== undefined) return ("noise" in source ? source.at : 0) + envSeconds(env, hold, scale);
  let natural: number;
  if ("modes" in source) natural = Math.max(...source.modes.map((m) => m.decay)) * scale * lowFactor(source.lowRingsLonger, pitch.midi);
  else if ("string" in source) natural = source.string.ring * scale * Math.sqrt(MIDDLE_C_HZ / pitch.frequency);
  else if ("noise" in source) natural = source.at + (source.burst ?? (source.decay ?? DEFAULT_NOISE_DECAY) * scale);
  else natural = plan.env === undefined ? hold + BARE_RELEASE_SECONDS : Infinity;
  return plan.env === undefined ? natural : Math.min(natural, envSeconds(plan.env, hold, scale));
}

/** Length of the note in seconds, and whether the cap cut it short. */
export function noteSeconds(definition: BlocksDefinition, plan: Plan, input: SynthInput, scale: number): { seconds: number; cut: boolean } {
  if (definition.kind === "sfx" && definition.length !== undefined) return { seconds: Math.min(MAX_NOTE_SECONDS, input.hold), cut: false };
  const pitch = pitchOf(definition, input);
  const wanted = Math.max(0.02, ...plan.sources.map((s) => sourceSeconds(s, plan, pitch, input.hold, scale)));
  return { seconds: Math.min(MAX_NOTE_SECONDS, wanted), cut: wanted > MAX_NOTE_SECONDS };
}

/** Per-sample pitch multiplier from pitchEnv and vibrato, or undefined when the pitch is constant. */
function pitchCurve(plan: Plan, length: number, sampleRate: number, noteLength: number): Float64Array | undefined {
  const { pitchEnv, vibrato } = plan;
  if (pitchEnv === undefined && vibrato === undefined) return undefined;
  const curve = new Float64Array(length);
  const glide = pitchEnv?.time ?? noteLength;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    let semitones = 0;
    if (pitchEnv !== undefined) {
      const span = pitchEnv.from - pitchEnv.to;
      semitones =
        pitchEnv.curve === "linear" ? pitchEnv.from - span * Math.min(1, t / glide) : pitchEnv.to + span * dmath.exp((-RING_TIME_CONSTANTS * t) / glide);
    }
    if (vibrato !== undefined) semitones += (vibrato.depth / 100) * lfoFade(vibrato, t) * dmath.sin(TWO_PI * vibrato.rate * t);
    curve[i] = dmath.pow(2, semitones / 12);
  }
  return curve;
}

/** 0 before an LFO's delay, rising to 1 over the same time again. */
function lfoFade(lfo: Lfo, t: number): number {
  if (lfo.delay === 0) return 1;
  return Math.min(1, Math.max(0, (t - lfo.delay) / lfo.delay));
}

/** Sine-term coefficient of harmonic k for each waveform (the pulse uses cosine terms instead). */
const SINE_TERMS: Record<Exclude<OscBlock["osc"], "pulse">, (k: number) => number> = {
  sine: (k) => (k === 1 ? 1 : 0),
  saw: (k) => ((k % 2 === 1 ? 1 : -1) * 2) / (Math.PI * k),
  square: (k) => (k % 2 === 1 ? 4 / (Math.PI * k) : 0),
  triangle: (k) => {
    if (k % 2 === 0) return 0;
    const sign = ((k - 1) / 2) % 2 === 0 ? 1 : -1;
    return (sign * 8) / (Math.PI * Math.PI * k * k);
  },
};

/** Additive coefficients of a waveform: sine terms per harmonic, and cosine terms for a pulse. */
function harmonicTable(osc: OscBlock): { sin: Float64Array; cos: Float64Array } {
  const sin = new Float64Array(MAX_HARMONICS + 1);
  const cos = new Float64Array(MAX_HARMONICS + 1);
  const shape = osc.osc;
  for (let k = 1; k <= MAX_HARMONICS; k++) {
    if (shape === "pulse") cos[k] = (2 / (Math.PI * k)) * dmath.sin(Math.PI * k * osc.width);
    else sin[k] = SINE_TERMS[shape](k);
  }
  return { sin, cos };
}

/** A band-limited oscillator: harmonics by rotation (one sin and cos per sample), none above the partial limit. */
function renderOsc(out: Float32Array, osc: OscBlock, frequency: number, curve: Float64Array | undefined, sampleRate: number): void {
  const table = harmonicTable(osc);
  const base = frequency * osc.ratio * dmath.pow(2, osc.detune / 1200);
  const limit = sampleRate * MAX_PARTIAL_FRACTION;
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const f = base * (curve?.[i] ?? 1);
    const harmonics = Math.min(MAX_HARMONICS, Math.floor(limit / f));
    let sum = 0;
    if (harmonics >= 1) {
      const s1 = dmath.sin(phase);
      const c1 = dmath.cos(phase);
      let s = s1;
      let c = c1;
      for (let k = 1; k <= harmonics; k++) {
        sum += (table.sin[k] ?? 0) * s + (table.cos[k] ?? 0) * c;
        const next = s * c1 + c * s1;
        c = c * c1 - s * s1;
        s = next;
      }
    }
    out[i] = (out[i] ?? 0) + osc.level * sum;
    phase += (TWO_PI * f) / sampleRate;
    if (phase > TWO_PI) phase -= TWO_PI;
  }
}

function renderModes(out: Float32Array, block: ModesBlock, pitch: NotePitch, curve: Float64Array | undefined, sampleRate: number, scale: number): void {
  const limit = sampleRate * MAX_PARTIAL_FRACTION;
  const highest = curve === undefined ? 1 : curve.reduce((m, v) => Math.max(m, v), 0);
  const low = lowFactor(block.lowRingsLonger, pitch.midi);
  for (const mode of block.modes) {
    const f = pitch.frequency * mode.ratio;
    if (f * highest >= limit) continue;
    const tau = ((mode.decay * scale) / RING_TIME_CONSTANTS) * low;
    if (curve === undefined) {
      addDampedSine(out, (TWO_PI * f) / sampleRate, mode.level, tau, sampleRate);
      continue;
    }
    const fall = dmath.exp(-1 / (tau * sampleRate));
    let amp = mode.level;
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      out[i] = (out[i] ?? 0) + amp * dmath.sin(phase);
      phase += (TWO_PI * f * (curve[i] ?? 1)) / sampleRate;
      if (phase > TWO_PI) phase -= TWO_PI;
      amp *= fall;
    }
  }
}

/** A filter's cutoff over time: `sweep` octaves away at the onset, gliding back to `cutoff` over `sweepTime`. */
const cutoffCurve =
  (settings: FilterSettings, scale: number) =>
  (t: number): number =>
    settings.sweep === 0 ? settings.cutoff : settings.cutoff * dmath.pow(2, settings.sweep * Math.max(0, 1 - t / (settings.sweepTime * scale)));

function renderNoise(out: Float32Array, block: NoiseBlock, input: SynthInput, scale: number): void {
  const { sampleRate, rng } = input;
  const start = Math.round(block.at * sampleRate);
  const pink = new Float64Array(3);
  if (block.burst !== undefined && block.env === undefined) {
    // A windowed burst draws only as many samples as it lasts (as the built-in mallet clicks do).
    const n = Math.min(out.length - start, Math.round(block.burst * sampleRate));
    const burst = new Float64Array(Math.max(0, n));
    for (let i = 0; i < n; i++) {
      const hann = n > 1 ? 0.5 - 0.5 * dmath.cos((TWO_PI * i) / (n - 1)) : 1;
      burst[i] = sourceNoise(block, rng, pink) * hann * block.level;
    }
    addFiltered(out, burst, start, block, sampleRate, scale);
    return;
  }
  const n = out.length - start;
  if (n <= 0) return;
  const noise = new Float64Array(n);
  const decay = (block.decay ?? DEFAULT_NOISE_DECAY) * scale;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const shape = block.env === undefined ? dmath.exp((-RING_TIME_CONSTANTS * t) / decay) : envAt(block.env, t, input.hold, scale);
    noise[i] = sourceNoise(block, rng, pink) * shape * block.level;
  }
  addFiltered(out, noise, start, block, sampleRate, scale);
}

/** One sample of seeded noise; pink through Paul Kellet's economy filter, whose state lives for one note. */
function sourceNoise(block: NoiseBlock, rng: SynthInput["rng"], state: Float64Array): number {
  const white = rng.normal();
  if (block.noise === "white") return white;
  state[0] = 0.99765 * (state[0] ?? 0) + white * 0.099046;
  state[1] = 0.963 * (state[1] ?? 0) + white * 0.2965164;
  state[2] = 0.57 * (state[2] ?? 0) + white * 1.0526913;
  return ((state[0] ?? 0) + (state[1] ?? 0) + (state[2] ?? 0) + white * 0.1848) * 0.25;
}

function addFiltered(out: Float32Array, x: Float64Array, start: number, block: NoiseBlock, sampleRate: number, scale: number): void {
  const filter = block.filter;
  const y = filter === undefined ? x : sweptFilter(x, filter.type, cutoffCurve(filter, scale), filter.q, sampleRate);
  for (let i = 0; i < y.length && start + i < out.length; i++) out[start + i] = (out[start + i] ?? 0) + (y[i] ?? 0);
}

function renderString(out: Float32Array, block: StringBlock, input: SynthInput, pitch: NotePitch, scale: number): void {
  const tone = {
    pluckHz: block.string.pluck,
    pluckPosition: block.string.position,
    damping: block.string.damping,
    ringSeconds: block.string.ring * scale,
    bodyHz: block.string.body,
  };
  const voice = stringVoice({ ...input, frequency: pitch.frequency }, tone, out.length / input.sampleRate);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) + block.level * (voice[i] ?? 0);
}

interface Voicing {
  input: SynthInput;
  pitch: NotePitch;
  curve: Float64Array | undefined;
  scale: number;
}

function renderSource(target: Float32Array, source: Source, v: Voicing): void {
  if ("osc" in source) renderOsc(target, source, v.pitch.frequency, v.curve, v.input.sampleRate);
  else if ("modes" in source) renderModes(target, source, v.pitch, v.curve, v.input.sampleRate, v.scale);
  else if ("noise" in source) renderNoise(target, source, v.input, v.scale);
  else renderString(target, source, v.input, v.pitch, v.scale);
}

/** In place: multiplies by an envelope. */
function applyEnv(x: Float32Array, env: Env, v: Voicing): void {
  for (let i = 0; i < x.length; i++) x[i] = (x[i] ?? 0) * envAt(env, i / v.input.sampleRate, v.input.hold, v.scale);
}

/** Every source mixed: those with their own envelope as shaped by it, the rest through the whole sound's envelope. */
function mixSources(plan: Plan, v: Voicing, length: number): Float32Array {
  const shared = new Float32Array(length);
  const own = new Float32Array(length);
  for (const source of plan.sources) {
    const env = ownEnv(source);
    if (env === undefined) {
      renderSource(shared, source, v);
      continue;
    }
    const part = new Float32Array(length);
    renderSource(part, source, v);
    // A noise's env is applied while it is drawn; an oscillator's here.
    if ("osc" in source) applyEnv(part, env, v);
    for (let i = 0; i < length; i++) own[i] = (own[i] ?? 0) + (part[i] ?? 0);
  }
  if (plan.env !== undefined) applyEnv(shared, plan.env, v);
  for (let i = 0; i < length; i++) shared[i] = (shared[i] ?? 0) + (own[i] ?? 0);
  return shared;
}

/** In place: the level dips by `depth` at `rate`. */
function applyTremolo(x: Float32Array, tremolo: Lfo, sampleRate: number): void {
  for (let i = 0; i < x.length; i++) {
    const t = i / sampleRate;
    x[i] = (x[i] ?? 0) * (1 - (tremolo.depth * lfoFade(tremolo, t) * (1 - dmath.cos(TWO_PI * tremolo.rate * t))) / 2);
  }
}

/** One note of a blocks definition, before the onset ramp, end fade, DC blocking and level. */
export function renderBlocks(definition: BlocksDefinition, input: SynthInput, scale = 1): { out: Float32Array; cut: boolean } {
  const { sampleRate } = input;
  const plan = planOf(definition);
  const { seconds, cut } = noteSeconds(definition, plan, input, scale);
  const length = Math.max(1, Math.round(seconds * sampleRate));
  const voicing: Voicing = { input, pitch: pitchOf(definition, input), curve: pitchCurve(plan, length, sampleRate, seconds), scale };
  let mixed: Float32Array | Float64Array = mixSources(plan, voicing, length);
  for (const filter of plan.filters) mixed = sweptFilter(mixed, filter.filter satisfies FilterType, cutoffCurve(filter, scale), filter.q, sampleRate);
  const out = mixed instanceof Float32Array ? mixed : Float32Array.from(mixed);
  if (plan.tremolo !== undefined) applyTremolo(out, plan.tremolo, sampleRate);
  return { out, cut };
}
