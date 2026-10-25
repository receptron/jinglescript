// S1 demo: one score with `lyric`s, sung by an installed singer model, written as a WAV.
//   node scripts/sing-demo.ts [out.wav] [model]
// The model is not in the repo: make the placeholder with training/singing/tiny_placeholder.py.
import { writeFile } from "node:fs/promises";
import { parseScore } from "../src/score.ts";
import { renderWithSinger } from "../src/singer/index.ts";
import { toWav } from "../src/wav.ts";

const melody: [string, string][] = [
  ["C4", "か"],
  ["D4", "え"],
  ["E4", "る"],
  ["F4", "の"],
  ["E4", "う"],
  ["D4", "た"],
  ["C4", "が"],
  ["", ""],
  ["E4", "き"],
  ["F4", "こ"],
  ["G4", "え"],
  ["A4", "て"],
  ["G4", "く"],
  ["F4", "る"],
  ["E4", "よ"],
];
const score = parseScore({
  format: "jinglescript/1",
  title: "かえるのうた (singer S1 demo)",
  tempo: 100,
  meter: "4/4",
  length: { beats: 17 },
  tracks: [
    {
      instrument: "organ",
      name: "voice",
      notes: melody.flatMap(([pitch, lyric], i) => (pitch === "" ? [] : [{ at: i, pitch, len: 0.95, lyric }])),
    },
  ],
});
const out = process.argv[2] ?? "out/singer-demo.wav";
const result = await renderWithSinger(score, { track: 0, model: process.argv[3] ?? "tiny-placeholder" });
await writeFile(out, toWav(result.audio, result.sampleRate, 16));
console.log(`${out}: ${result.timing.duration ?? ""}s, ${JSON.stringify(result.stats)}`);
