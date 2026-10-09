// Stand-ins for the recorded grand piano, so tests run without the network: the synthesized piano
// at each sampled pitch, off equal temperament by the cents the catalog measured on the recording,
// at the recordings' 44.1 kHz, built on first use. They exercise everything
// a recording goes through (choice of sample and layer, resampling, normalization) and, being
// synthesized deterministically, give golden hashes that hold on every machine.
import { INSTRUMENTS } from "../src/instruments/index.ts";
import { midiToFrequency, pitchToMidi } from "../src/pitch.ts";
import { createRng } from "../src/rng.ts";
import { PIANO_CATALOG } from "../src/samples/piano-catalog.ts";
import { sampleKey, type SampleData, type SampleSource } from "../src/samples/source.ts";
import { PIANO_SET, pianoFile } from "../src/samples/vcsl.ts";

const RATE = 44100;
const rows = new Map(PIANO_CATALOG.map(([pitch, layer, , , cents]) => [sampleKey(PIANO_SET, pianoFile(pitch, layer)), { pitch, layer, cents }]));
const made = new Map<string, SampleData>();

export const pianoFixture: SampleSource = {
  get(key) {
    const row = rows.get(key);
    if (row === undefined) return undefined;
    let data = made.get(key);
    if (data === undefined) {
      const midi = pitchToMidi(row.pitch) ?? 60;
      const x = INSTRUMENTS.piano.synthesize({
        midi,
        frequency: midiToFrequency(midi + row.cents / 100),
        velocity: row.layer / 4,
        hold: 1,
        variant: undefined,
        sampleRate: RATE,
        rng: createRng(midi * 10 + row.layer),
      });
      data = { sampleRate: RATE, data: x };
      made.set(key, data);
    }
    return data;
  },
};
