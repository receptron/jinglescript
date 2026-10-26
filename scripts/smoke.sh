#!/usr/bin/env bash
# Package smoke test: pack the exact tarball (prepack builds dist/), install it into an empty
# folder, and render through the CLI, the library and the MCP server. Then check the outputs are
# real: a WAV of the score's length with sound in it, the timing map's cue, an MP3 when ffmpeg is
# present, and an MCP server that lists manageJingleScript.
#
# Usage: scripts/smoke.sh
# SMOKE_TARBALL=<path to a packed .tgz> skips packing, so the tarball can be packed with one Node
# and installed and run with another (CI runs it on the oldest Node the package supports).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ -n "${SMOKE_TARBALL:-}" ]; then
  cp "$SMOKE_TARBALL" "$WORK/"
  TGZ="$(basename "$SMOKE_TARBALL")"
else
  TGZ="$(cd "$REPO" && npm pack --silent --pack-destination "$WORK" | tail -1)"
fi
echo "packed: $TGZ (running on node $(node -v))"
cd "$WORK"
npm init -y >/dev/null
npm pkg set type=module
npm install --no-audit --no-fund "$WORK/$TGZ" >/dev/null
cp "$REPO/examples/hatena-marumo-a.json" score.json
cp "$REPO/examples/lyrics-hatena.json" lyrics.json

# CLI
WANT="$(node -p 'require("./node_modules/jinglescript/package.json").version')"
GOT="$(node_modules/.bin/jinglescript --version)"
[ "$GOT" = "$WANT" ] || { echo "--version printed '$GOT', expected '$WANT'"; exit 1; }
echo "--version: ok ($GOT)"
node_modules/.bin/jinglescript check score.json
node_modules/.bin/jinglescript render score.json -o out/cli.wav
if command -v ffmpeg >/dev/null; then
  node_modules/.bin/jinglescript render score.json -o out/cli.mp3
  ffprobe -v error -show_entries stream=codec_name -of csv=p=0 out/cli.mp3 | grep -q mp3 || { echo "out/cli.mp3 is not an MP3"; exit 1; }
  echo "out/cli.mp3: ok"
fi

# Library
cat > lib.mjs <<'JS'
import { readFile, writeFile } from "node:fs/promises";
import { parseScore, render, toWav, getSchema, checkScore, loadSamples } from "jinglescript";
const score = parseScore(JSON.parse(await readFile("score.json", "utf8")));
const { audio, sampleRate, timing } = await render(score);
await writeFile("out/lib.wav", toWav(audio, sampleRate));
await writeFile("out/lib.timing.json", JSON.stringify(timing));
if (!checkScore(score).ok || getSchema().$schema === undefined) throw new Error("API for LLMs is broken");
console.log("library rendered", timing.duration, "s");
// Without its grand-piano chord, whose recordings would need the network; the lyrics are on the melody.
const sung = JSON.parse(await readFile("lyrics.json", "utf8"));
sung.tracks = sung.tracks.filter((track) => track.instrument !== "grandpiano");
const lyrics = (await render(parseScore(sung))).timing.lyrics;
if (lyrics?.map((l) => l.text).join("/") !== "ハテナマルモ/はじまるよ！") throw new Error("lyrics missing from the timing map");
console.log("library lyrics", lyrics.length, "lines");
// The recorded sound effects are read from the installed package (samples/sfx/), never downloaded.
const sfx = parseScore({ format: "jinglescript/1", tempo: 120, length: { seconds: 2 }, tracks: [{ instrument: "door", notes: [{ at: 0 }] }] });
const sfxAudio = (await render(sfx, { samples: await loadSamples(sfx, { download: false }) })).audio[0];
if (!sfxAudio.some((v) => Math.abs(v) > 0.01)) throw new Error("recorded effect is silent");
console.log("library recorded effect: ok");
JS
node lib.mjs

# The browser entry resolves from the installed package and renders the same audio.
cat > browser.mjs <<'JS'
import { readFile } from "node:fs/promises";
import * as browser from "jinglescript/browser";
import * as node from "jinglescript";
const input = JSON.parse(await readFile("score.json", "utf8"));
// The Node entry renders on a worker thread (dist/render-worker.js); the browser's in place.
const a = (await browser.render(browser.parseScore(input))).audio[0];
const b = (await node.render(node.parseScore(input))).audio[0];
if (a.length !== b.length || a.some((v, i) => v !== b[i])) throw new Error("jinglescript/browser renders differently");
if ("loadSamples" in browser && browser.loadSamples === node.loadSamples) throw new Error("jinglescript/browser exports the Node loader");
console.log("browser entry: ok");
JS
node browser.mjs

# MCP: initialize, list tools, render — over stdio, as a client would.
cat > mcp.mjs <<'JS'
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
const server = spawn("node_modules/.bin/jinglescript", ["mcp", "--out", "out/mcp"], { stdio: ["pipe", "pipe", "inherit"] });
const replies = new Map();
let buffer = "";
server.stdout.on("data", (chunk) => {
  buffer += chunk;
  for (let i; (i = buffer.indexOf("\n")) >= 0; buffer = buffer.slice(i + 1)) {
    const message = JSON.parse(buffer.slice(0, i));
    replies.get(message.id)?.(message);
  }
});
let id = 0;
const call = (method, params) => new Promise((resolve) => {
  replies.set(++id, resolve);
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
});
await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
const tools = await call("tools/list", {});
if (tools.result.tools.map((t) => t.name).join() !== "manageJingleScript") throw new Error("unexpected tools");
const score = JSON.parse(readFileSync("score.json", "utf8"));
const rendered = await call("tools/call", { name: "manageJingleScript", arguments: { action: "renderScore", score, fileName: "mcp" } });
if (rendered.result.isError) throw new Error(rendered.result.content[0].text);
console.log("mcp rendered", JSON.parse(rendered.result.content[0].text).audio);
server.kill();
JS
node mcp.mjs

check() {
  local wav="$1" timing="$2"
  node -e "
    const fs = require('fs');
    const b = fs.readFileSync('$wav');
    if (b.toString('ascii', 0, 4) !== 'RIFF') throw new Error('$wav: not a WAV');
    const seconds = (b.length - 44) / (b.readUInt32LE(28));
    if (Math.abs(seconds - 4.6) > 0.01) throw new Error('$wav: ' + seconds + ' s, expected 4.6');
    let peak = 0; for (let i = 44; i + 2 < b.length; i += 3) peak = Math.max(peak, Math.abs(b.readIntLE(i, 3)));
    if (peak < 1000) throw new Error('$wav: silent');
    const t = JSON.parse(fs.readFileSync('$timing', 'utf8'));
    if (t.cues.hit !== 1.5) throw new Error('$timing: hit cue ' + t.cues.hit);
    console.log('$wav: ok (' + seconds + ' s, hit at ' + t.cues.hit + ' s)');
  "
}
check out/cli.wav out/cli.timing.json
check out/lib.wav out/lib.timing.json
check out/mcp/mcp.wav out/mcp/mcp.timing.json
echo "package smoke passed"
