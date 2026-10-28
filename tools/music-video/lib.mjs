// Shared helpers: score trimming, note extraction, Chrome discovery and a tiny static server.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Cut a score to its first `cut` seconds (notes and pedal starting before cut - 0.5 s) and add a fade-out. */
export function trimScore(score, cut, fade = 1.5) {
  const s = structuredClone(score);
  for (const t of s.tracks) {
    t.notes = (t.notes ?? []).filter((n) => n.at?.seconds === undefined || n.at.seconds < cut - 0.5);
    if (t.pedal) t.pedal = t.pedal.filter((p) => p.at?.seconds === undefined || p.at.seconds < cut - 0.5);
  }
  s.length = { seconds: cut + fade };
  s.master = { ...(s.master ?? {}), fadeOut: fade };
  return s;
}

const COMPOSERS = {
  Debussy: "Claude Debussy",
  Chopin: "Frédéric Chopin",
  Satie: "Erik Satie",
  Tchaikovsky: "Pyotr Ilyich Tchaikovsky",
  Liszt: "Franz Liszt",
  Beethoven: "Ludwig van Beethoven",
  Rachmaninoff: "Sergei Rachmaninoff",
  Schubert: "Franz Schubert",
  Joplin: "Scott Joplin",
};

/** Split "Title (Composer) [rest]" into an overlay title and composer line; the last (...) is the composer. */
export function splitTitle(title = "") {
  const m = /^(.*)\(([^()]+)\)([^()]*)$/.exec(title);
  if (!m) return { title, subtitle: "" };
  const composer = m[2].trim();
  return { title: `${m[1].trim()} ${m[3].trim()}`.trim(), subtitle: COMPOSERS[composer] ?? composer };
}

/**
 * Every note with its sounding length from the score. Onsets come from the timing map (the public
 * contract); `len` is read from the score where notes are placed in seconds, matched by onset and pitch.
 */
export function notesWithLength(score, timing) {
  const lens = new Map();
  for (const t of score.tracks)
    for (const n of t.notes ?? []) {
      if (n.at?.seconds === undefined) continue;
      const len = n.len?.seconds;
      if (len !== undefined) lens.set(`${n.at.seconds.toFixed(2)}|${n.pitch}`, len);
    }
  return timing.notes
    .filter((n) => n.pitch)
    .map((n) => ({ t: n.t, pitch: n.pitch, vel: n.vel ?? 0.5, track: n.track ?? 0, len: lens.get(`${n.t.toFixed(2)}|${n.pitch}`) ?? 0.5 }));
}

const CHROME_PATHS = {
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"],
  win32: [
    `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  ],
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
};

/** Path to an installed Chrome: $CHROME_PATH, then the usual install locations. */
export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const found = (CHROME_PATHS[process.platform] ?? []).find((p) => p && fs.existsSync(p));
  if (!found) throw new Error("Chrome not found. Install Google Chrome or set CHROME_PATH.");
  return found;
}

/** Chrome flags: hardware GPU (Metal on macOS, D3D11 on Windows) or SwiftShader software GL. */
export function chromeArgs(gpu) {
  const common = ["--ignore-gpu-blocklist", "--hide-scrollbars", "--no-sandbox"];
  if (!gpu) return [...common, "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
  const angle = { darwin: "metal", win32: "d3d11" }[process.platform] ?? "gl";
  return [...common, "--enable-gpu", `--use-angle=${angle}`];
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json" };

/** Serve a scene folder at /, the pinned three package at /vendor/three/, and the render's data dir at /data/. */
export function serve(webDir, dataDir) {
  const threeDir = path.resolve(path.dirname(require.resolve("three")), "..");
  const roots = [
    ["/vendor/three/", threeDir],
    ["/data/", dataDir],
    ["/", webDir],
  ];
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split(/[?#]/)[0]);
    const [prefix, root] = roots.find(([p]) => url.startsWith(p));
    const file = path.resolve(root, url.slice(prefix.length));
    if (!file.startsWith(path.resolve(root)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const toMidi = (p) => {
  const m = /^([A-G])([#b]?)(-?\d+)$/.exec(p);
  return m ? 12 * (Number(m[3]) + 1) + STEP[m[1]] + ({ "#": 1, b: -1 }[m[2]] ?? 0) : undefined;
};
const fromMidi = (n) => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

/** Read "<name> (instrument, C2–C7, ..." from `jinglescript instruments` output: the pitched range. */
export function instrumentRange(listing, name) {
  const line = listing.split("\n").find((l) => l.startsWith(`${name} (`));
  if (!line) throw new Error(`unknown instrument "${name}" (see: node src/cli.ts instruments)`);
  const m = /\(\w+, ([A-G][#b]?-?\d)–([A-G][#b]?-?\d)/.exec(line);
  return m ? [toMidi(m[1]), toMidi(m[2])] : undefined;
}

/** Play every track on `name`: drop pedals (only grandpiano has dampers) and fold pitches into range by octaves. */
export function swapInstrument(score, name, range) {
  for (const t of score.tracks) {
    t.instrument = name;
    if (name !== "grandpiano") delete t.pedal;
    if (!range) continue;
    for (const n of t.notes ?? []) {
      let m = toMidi(n.pitch);
      if (m === undefined) continue;
      while (m < range[0]) m += 12;
      while (m > range[1]) m -= 12;
      n.pitch = fromMidi(m);
    }
  }
  return score;
}
