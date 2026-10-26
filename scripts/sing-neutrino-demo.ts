// かえるのうた sung by the user's own NEUTRINO install over a piano and bass, through render().
//   node scripts/sing-neutrino-demo.ts [out.wav] [voice]
// NEUTRINO is not bundled: install it yourself (https://studio-neutrino.com/downloads/).
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseScore } from "../src/score.ts";
import { renderWithNeutrino } from "../src/singer/index.ts";
import { toWav } from "../src/wav.ts";

const melody: [string, string, number][] = [
  ["C4", "か", 1],
  ["D4", "え", 1],
  ["E4", "る", 1],
  ["F4", "の", 1],
  ["E4", "う", 1],
  ["D4", "た", 1],
  ["C4", "が", 1.5],
  ["", "", 0.5],
  ["E4", "き", 1],
  ["F4", "こ", 1],
  ["G4", "え", 1],
  ["A4", "て", 1],
  ["G4", "く", 1],
  ["F4", "る", 1],
  ["E4", "よ", 1.5],
  ["", "", 0.5],
  ["C4", "ぐぁ", 1],
  ["", "", 1],
  ["C4", "ぐぁ", 1],
  ["", "", 1],
  ["C4", "ぐぁ", 1],
  ["", "", 1],
  ["C4", "ぐぁ", 1],
  ["", "", 1],
  ["C4", "け", 0.5],
  ["C4", "け", 0.5],
  ["D4", "け", 0.5],
  ["D4", "け", 0.5],
  ["E4", "け", 0.5],
  ["E4", "け", 0.5],
  ["F4", "け", 0.5],
  ["F4", "け", 0.5],
  ["E4", "く", 1],
  ["D4", "わ", 1],
  ["C4", "っ", 0.5],
  ["C4", "く", 1.5],
];
// One beat of rest first, so the first consonant (sung before the beat) is not cut at time 0.
let at = 1;
const voice = melody.flatMap(([pitch, lyric, len]) => {
  const start = at;
  at += len;
  return pitch === "" ? [] : [{ at: start, pitch, len: len * 0.95, lyric }];
});
const chords: [number, string[]][] = [
  [0, ["C4", "E4", "G4"]],
  [4, ["G3", "B3", "D4"]],
  [8, ["C4", "E4", "G4"]],
  [12, ["F3", "A3", "C4"]],
  [16, ["C4", "E4", "G4"]],
  [20, ["C4", "E4", "G4"]],
  [24, ["G3", "B3", "D4"]],
  [28, ["C4", "E4", "G4"]],
  [32, ["C4", "G4", "C5"]],
];
const score = parseScore({
  format: "jinglescript/1",
  title: "かえるのうた (NEUTRINO demo)",
  tempo: 100,
  meter: "4/4",
  length: { beats: at + 2 },
  tracks: [
    { instrument: "organ", name: "voice", notes: voice },
    { instrument: "vibraphone", name: "vibes", gain: 0.5, notes: chords.map(([t, pitch]) => ({ at: t + 1, pitch, len: 3.8 })) },
  ],
});
const out = process.argv[2] ?? join(homedir(), "Desktop", "neutrino_demo2.wav");
const started = performance.now();
const result = await renderWithNeutrino(score, { track: 0, voice: process.argv[3] ?? "reina", fallbackModel: "tiny-placeholder" });
await writeFile(out, toWav(result.audio, result.sampleRate, 16));
console.log(`${out}: ${((performance.now() - started) / 1000).toFixed(1)}s to render, ${JSON.stringify(result.stats)}`);
