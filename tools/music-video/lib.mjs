// Shared helpers: score trimming, note extraction, Chrome discovery and a tiny static server.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

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
