// The prototype's generic struck-bar voice (`modal` in instruments.py): damped modes, a short
// Hann-windowed noise click, a 1 ms onset. Used by xylophone, glockenspiel, vibraphone and music box.
// The prototype cut every note at 2.5 s; here a note rings until its longest mode is ~60 dB down,
// capped at MAX_SECONDS, and a cut note ends in a damper fade instead of a click.
import { addModes, addNoiseBurst, buffer, finish, ringSeconds, type Mode } from "./common.ts";
import type { SynthInput } from "./types.ts";

const MIN_SECONDS = 2.5;
const MAX_SECONDS = 6;
export const CLICK_SECONDS = 0.004;
const DAMPER_SECONDS = 0.3;
const END_FADE_SECONDS = 0.01;

export interface ModalVoice {
  modes: readonly Mode[];
  click: number;
  clickSeconds?: number;
  /** Hann-window the click (default) or leave it raw. */
  clickWindowed?: boolean;
  attack?: number;
  /** Linear trim so instruments sit at a similar loudness. */
  level: number;
  /** Per-sample gain applied before finishing (the vibraphone's tremolo). */
  shape?: (t: number) => number;
}

export function modalNote(input: SynthInput, voice: ModalVoice): Float32Array {
  const { sampleRate } = input;
  const seconds = ringSeconds(voice.modes, MIN_SECONDS, MAX_SECONDS);
  const out = buffer(seconds, sampleRate);
  addModes(out, input.frequency ?? 440, voice.modes, sampleRate);
  addNoiseBurst(out, voice.clickSeconds ?? CLICK_SECONDS, voice.click, input.rng, sampleRate, voice.clickWindowed ?? true);
  const shape = voice.shape;
  if (shape) for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) * shape(i / sampleRate);
  const cut = seconds >= MAX_SECONDS;
  return finish(out, { attack: voice.attack ?? 0.001, endFade: cut ? DAMPER_SECONDS : END_FADE_SECONDS, gain: input.velocity * voice.level }, sampleRate);
}
