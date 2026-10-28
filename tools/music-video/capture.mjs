// Frame-step the scene in headless Chrome: renderFrame(t) then a screenshot, for frames [from, to).
// Usage: node capture.mjs data=<dir> [scene=crystal-stair] out=<dir> [from=0] [to=N] [fps=30] [w=1920] [h=1080] [gpu=1]
//                         [start=<s>] [fadeEnd=<s>] [cfg=<json>] [still=<t> png=<file>]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { serve, findChrome, chromeArgs } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const a = Object.fromEntries(process.argv.slice(2).map((s) => [s.slice(0, s.indexOf("=")), s.slice(s.indexOf("=") + 1)]));
const fps = Number(a.fps ?? 30);
const W = Number(a.w ?? 1920);
const H = Number(a.h ?? 1080);
const gpu = a.gpu !== "0";

const server = await serve(path.join(here, "scenes", a.scene ?? "crystal-stair"), path.resolve(a.data));
const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, protocolTimeout: 600000, args: chromeArgs(gpu) });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
const q = new URLSearchParams({ w: String(W), h: String(H) });
if (a.fadeEnd) q.set("fadeEnd", a.fadeEnd);
if (a.start) q.set("fadeStart", a.start);
if (a.cfg) q.set("cfg", a.cfg);
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?${q}`);
await page.waitForFunction("window.ready === true", { timeout: 120000 });
const renderer = await page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
});
console.log(`WebGL renderer: ${renderer}`);

if (a.still !== undefined) {
  await page.evaluate((t) => window.renderFrame(t), Number(a.still));
  await page.screenshot({ path: a.png });
  console.log(`still t=${a.still} -> ${a.png}`);
} else {
  const start = Number(a.start ?? 0);
  const total = Math.round(((Number(a.fadeEnd) || (await page.evaluate("window.DURATION"))) - start) * fps);
  const from = Number(a.from ?? 0);
  const to = Math.min(total, Number(a.to ?? total));
  fs.mkdirSync(a.out, { recursive: true });
  const t0 = Date.now();
  for (let f = from; f < to; f++) {
    await page.evaluate((t) => window.renderFrame(t), start + f / fps);
    await page.screenshot({ path: path.join(a.out, `f${String(f).padStart(5, "0")}.jpg`), type: "jpeg", quality: 95 });
    if ((f - from) % 90 === 0) console.log(`frame ${f} (${from}..${to})`);
  }
  const s = (Date.now() - t0) / 1000;
  console.log(`captured ${to - from} frames in ${s.toFixed(1)} s (${((to - from) / s).toFixed(2)} fps)`);
}
await browser.close();
server.close();
