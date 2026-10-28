// One command for the whole pipeline: score -> WAV + timing map -> frames -> MP4.
//
//   node render.mjs list                                         pieces in examples/piano
//   node render.mjs still <score.json> [--t 8,30,58]            stills only (look check)
//   node render.mjs clip  <score.json> [--seconds 15]            short clip from t=0
//   node render.mjs full  <score.json> [--cut 60]                the whole (optionally cut) piece
//
// Options: --cut <s> (trim the score first), --w 1920 --h 1080 --fps 30, --cpu (SwiftShader, no GPU),
// --scene <name> (a folder in scenes/, default crystal-stair), --workers <n> (parallel Chrome instances; useful with --cpu), --cfg '<json>' (look parameters),
// --instrument <name> (replace every track's instrument; `node src/cli.ts instruments` lists them), --title/--subtitle, --out <dir> (default out/music-video).
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { trimScore, notesWithLength, splitTitle, swapInstrument, instrumentRange } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    t: { type: "string", default: "8,30,58" },
    seconds: { type: "string", default: "15" },
    cut: { type: "string" },
    w: { type: "string", default: "1920" },
    h: { type: "string", default: "1080" },
    fps: { type: "string", default: "30" },
    cpu: { type: "boolean", default: false },
    workers: { type: "string" },
    cfg: { type: "string" },
    instrument: { type: "string" },
    scene: { type: "string", default: "crystal-stair" },
    title: { type: "string" },
    subtitle: { type: "string" },
    out: { type: "string", default: path.join(repo, "out/music-video") },
  },
});
const [mode, scorePath] = positionals;
if (mode === "list") {
  const dir = path.join(repo, "examples/piano");
  for (const f of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const s = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const n = splitTitle(s.title);
    console.log(`${`examples/piano/${f}`.padEnd(48)} ${String(s.length?.seconds ?? "?").padStart(6)} s  ${n.title} — ${n.subtitle}`);
  }
  process.exit(0);
}
if (!["still", "clip", "full"].includes(mode) || !scorePath) {
  console.error("usage: node render.mjs <still|clip|full> <score.json> [options]  (see README.md)");
  process.exit(1);
}

const started = Date.now();
const out = path.resolve(o.out);
const data = path.join(out, "data");
fs.mkdirSync(data, { recursive: true });

// 1. Score -> audio + timing map (the JingleScript CLI of this repo).
let score = JSON.parse(fs.readFileSync(scorePath, "utf8"));
if (o.cut) score = trimScore(score, Number(o.cut));
if (o.instrument) {
  const listing = execFileSync(process.execPath, [path.join(repo, "src/cli.ts"), "instruments"], { encoding: "utf8" });
  swapInstrument(score, o.instrument, instrumentRange(listing, o.instrument));
}
fs.writeFileSync(path.join(data, "score.json"), JSON.stringify(score, null, 1));
execFileSync(process.execPath, [path.join(repo, "src/cli.ts"), "render", path.join(data, "score.json"), "-o", path.join(data, "music.wav")], {
  stdio: "inherit",
});
const timing = JSON.parse(fs.readFileSync(path.join(data, "music.timing.json"), "utf8"));
fs.copyFileSync(path.join(data, "music.timing.json"), path.join(data, "timing.json"));
const names = splitTitle(score.title);
fs.writeFileSync(
  path.join(data, "notes.json"),
  JSON.stringify({ title: o.title ?? names.title, subtitle: o.subtitle ?? names.subtitle, notes: notesWithLength(score, timing) }),
);

const fps = Number(o.fps);
const common = [`data=${data}`, `scene=${o.scene}`, `w=${o.w}`, `h=${o.h}`, `fps=${fps}`, `gpu=${o.cpu ? 0 : 1}`, ...(o.cfg ? [`cfg=${o.cfg}`] : [])];
const run = (args) =>
  new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(here, "capture.mjs"), ...args], { stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`capture exited ${code}`))));
  });

// 2. Stills: one Chrome per time.
if (mode === "still") {
  for (const t of o.t.split(",")) await run([...common, `still=${t}`, `png=${path.join(out, `still-${t}.png`)}`]);
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  process.exit(0);
}

// 3. Frames, split across workers, then ffmpeg with the audio.
const seconds = mode === "clip" ? Number(o.seconds) : timing.duration;
const total = Math.round(seconds * fps);
const workers = Number(o.workers ?? (o.cpu ? 4 : 1));
const frames = path.join(out, "frames");
fs.rmSync(frames, { recursive: true, force: true });
const chunk = Math.ceil(total / workers);
const fadeEnd = mode === "clip" ? [`fadeEnd=${seconds}`] : [];
await Promise.all(
  Array.from({ length: workers }, (_, i) => run([...common, ...fadeEnd, `out=${frames}`, `from=${i * chunk}`, `to=${Math.min(total, (i + 1) * chunk)}`])),
);
const mp4 = path.join(out, mode === "clip" ? `clip-${seconds}s.mp4` : "music-video.mp4");
const afade = mode === "clip" ? ["-af", `afade=t=out:st=${Math.max(0, seconds - 1.2)}:d=1.2`] : [];
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-loglevel",
    "error",
    "-framerate",
    String(fps),
    "-i",
    path.join(frames, "f%05d.jpg"),
    "-t",
    String(seconds),
    "-i",
    path.join(data, "music.wav"),
    ...afade,
    "-vf",
    "scale=in_range=pc:out_range=tv,format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "16",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "256k",
    "-shortest",
    "-movflags",
    "+faststart",
    mp4,
  ],
  { stdio: "inherit" },
);
console.log(`wrote ${mp4} (${total} frames) in ${((Date.now() - started) / 1000).toFixed(0)} s`);
