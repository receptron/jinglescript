// Sampled grand piano: a Steinway B recorded for the VCSL (CC0), sampled every whole tone in three
// velocity layers. A note plays the nearest sample, moved at most a semitone by band-limited
// resampling (src/dsp/resample.ts) and retuned to equal temperament, in the layer its velocity
// falls in. Like `piano` it rings
// about 3 s whatever the note length, then a short damper fade. The recordings are stereo; they
// are played mono, placed by the track's pan like every other instrument.
import { buffer, finish, MAX_PARTIAL_FRACTION } from "./common.ts";
import type { Instrument, SynthInput } from "./types.ts";
import { biquadFilter, highpass } from "../dsp/biquad.ts";
import { kWeighting } from "../dsp/loudness.ts";
import { resample, TRANSITION } from "../dsp/resample.ts";
import * as dmath from "../dsp/math.ts";
import { midiToFrequency, pitchToMidi } from "../pitch.ts";
import { PIANO_CATALOG } from "../samples/piano-catalog.ts";
import { NO_SAMPLES, sampleKey, SamplesNotLoadedError } from "../samples/source.ts";
import { PIANO_SET, pianoFile } from "../samples/vcsl.ts";

const RING_SECONDS = 3.2;
const DAMPER_SECONDS = 0.4;
/**
 * Velocity layers: the highest velocity each plays. VCSL normalized the layers (and the pitches
 * vary by up to 10 dB), so a layer sets the timbre only: every sample is brought to the same
 * level over its first NORMALIZE_SECONDS, and the velocity sets the gain, as for every other
 * instrument.
 */
const LAYERS = [
  { layer: 2, top: 0.45 },
  { layer: 3, top: 0.75 },
  { layer: 4, top: 1 },
] as const;
const NORMALIZE_SECONDS = 0.3;
/** Loudness of a C5 at full velocity matched to the marimba's. */
const LEVEL = dmath.dbToGain(-3.9);
/** Below the lowest A: rumble and any DC offset in the recordings. */
const HIGHPASS_HZ = 18;

/** Sampled pitches as MIDI numbers, ascending. */
const SAMPLED = [...new Set(PIANO_CATALOG.map(([pitch]) => pitchToMidi(pitch) ?? 0))].sort((a, b) => a - b);

/** The sample to play for a sounding MIDI pitch (fractional when detuned): the nearest, the lower on a tie. */
export function nearestSampled(midi: number): number {
  let best = SAMPLED[0] ?? 60;
  for (const m of SAMPLED) if (Math.abs(m - midi) < Math.abs(best - midi)) best = m;
  return best;
}

export function layerFor(velocity: number): number {
  return (LAYERS.find((l) => velocity <= l.top) ?? LAYERS[2]).layer;
}

/** K-weighted RMS of the attack, as loudness meters hear it: what a sample is normalized by (0 for silence). */
function attackLevel(data: Float32Array, sampleRate: number): number {
  const { shelf, highpass: kHighpass } = kWeighting(sampleRate);
  const weighted = biquadFilter(biquadFilter(data.subarray(0, Math.round(NORMALIZE_SECONDS * sampleRate)), shelf), kHighpass);
  let sum = 0;
  for (const v of weighted) sum += v * v;
  return weighted.length === 0 ? 0 : Math.sqrt(sum / weighted.length);
}

/** Each sample's key (for SampleSource.get) and its distance from equal temperament, by sampled MIDI pitch and layer. */
const SAMPLES = new Map(
  PIANO_CATALOG.map(([pitch, layer, , , cents]) => [`${pitchToMidi(pitch) ?? 0}/${layer}`, { key: sampleKey(PIANO_SET, pianoFile(pitch, layer)), cents }]),
);

/** The sample a note plays: its key and how many cents it is from equal temperament. */
export function grandPianoSample(sampleMidi: number, layer: number): { key: string; cents: number } {
  return SAMPLES.get(`${sampleMidi}/${layer}`) ?? { key: sampleKey(PIANO_SET, pianoFile("C4", layer)), cents: 0 };
}

function synthesize(input: SynthInput): Float32Array {
  const { sampleRate } = input;
  const f = input.frequency ?? 261.63;
  const sampleMidi = nearestSampled(69 + 12 * dmath.log2(f / 440));
  const layer = layerFor(input.velocity);
  const { key, cents } = grandPianoSample(sampleMidi, layer);
  const sample = (input.samples ?? NO_SAMPLES).get(key);
  if (sample === undefined) throw new SamplesNotLoadedError("grandpiano", key);
  // Played in equal temperament: the recording's own tuning (stretched, as pianos are) is taken
  // out, so it agrees with the other instruments. Moving the pitch up moves the recording's top
  // octave up too: low-pass it so nothing lands near the output's Nyquist.
  const shift = f / (midiToFrequency(sampleMidi) * dmath.pow(2, cents / 1200));
  const limitHz = sampleRate * MAX_PARTIAL_FRACTION - (TRANSITION * sample.sampleRate) / 2;
  const cutoff = Math.min(0.5, limitHz / shift / sample.sampleRate);
  const length = buffer(RING_SECONDS + DAMPER_SECONDS, sampleRate).length;
  const out = resample(sample.data, (shift * sample.sampleRate) / sampleRate, cutoff, length);
  const clean = Float32Array.from(biquadFilter(out, highpass(HIGHPASS_HZ, Math.SQRT1_2, sampleRate)));
  const level = attackLevel(sample.data, sample.sampleRate);
  return finish(clean, { attack: 0.002, endFade: DAMPER_SECONDS, gain: level === 0 ? 0 : (input.velocity * LEVEL) / level }, sampleRate);
}

export const grandpiano: Instrument = {
  descriptor: {
    kind: "instrument",
    description:
      "Recorded grand piano (a Steinway B): the real sound, for anything that should sound like a real piano. Rings about 3 s per note. Its samples download on first use (about 1.2 MB per note).",
    pitched: true,
    sustained: false,
    range: { low: "A0", high: "A7" },
    variants: [],
    transpose: 0,
    synthetic: false,
    sampled: { source: "Versilian Community Sample Library (VCSL), github.com/sgossner/VCSL", licence: "CC0 1.0 (public domain)" },
  },
  synthesize,
};
