// Scores the evaluation: for each request in eval/requests.json, reads the score an LLM wrote at
// out/eval/<run>/<id>.json and checks it mechanically — valid, the requested times exist as cues,
// renders cleanly at the loudness target. Usage: node eval/check.ts <run>
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { checkScore, parseScore, render } from "../src/index.ts";

const RequestsSchema = z.array(z.strictObject({ id: z.string(), request: z.string(), cues: z.array(z.number()) }));

const run = process.argv[2] ?? "default";
const dir = join("out", "eval", run);
const requests = RequestsSchema.parse(JSON.parse(await readFile(new URL("requests.json", import.meta.url), "utf8")));

interface Row {
  id: string;
  valid: boolean;
  cues: boolean;
  clean: boolean;
  detail: string;
}

async function score(id: string, expected: readonly number[]): Promise<Row> {
  let input: unknown;
  try {
    input = JSON.parse(await readFile(join(dir, `${id}.json`), "utf8"));
  } catch (error) {
    return { id, valid: false, cues: false, clean: false, detail: `no readable score (${error instanceof Error ? error.message : String(error)})` };
  }
  const check = checkScore(input);
  if (!check.ok) return { id, valid: false, cues: false, clean: false, detail: check.errors.map((e) => `${e.path}: ${e.message}`).join("; ") };
  const times = Object.values(check.cues).map((c) => c.seconds);
  const missing = expected.filter((t) => !times.some((s) => Math.abs(s - t) < 0.0015));
  const { audio, stats } = render(parseScore(input));
  const finite = audio.every((channel) => channel.every(Number.isFinite));
  const clean = finite && stats.truePeak <= -1.5 && (Math.abs(stats.loudness - parseScore(input).master.loudness) <= 0.5 || stats.limitedByPeak);
  const detail = [
    missing.length > 0 ? `missing cues at ${missing.join(", ")} s` : "",
    `${stats.loudness.toFixed(1)} LUFS, limiting ${stats.limitingDb.toFixed(1)} dB`,
  ]
    .filter(Boolean)
    .join("; ");
  return { id, valid: true, cues: missing.length === 0, clean, detail };
}

const rows = await Promise.all(requests.map((r) => score(r.id, r.cues)));
const mark = (ok: boolean): string => (ok ? "yes" : "NO");
const table = [
  `| request | valid | cues | clean | detail |`,
  `|---|---|---|---|---|`,
  ...rows.map((r) => `| ${r.id} | ${mark(r.valid)} | ${mark(r.cues)} | ${mark(r.clean)} | ${r.detail} |`),
].join("\n");
const passed = rows.filter((r) => r.valid && r.cues && r.clean).length;
const summary = `${run}: ${passed}/${rows.length} pass (valid ${rows.filter((r) => r.valid).length}, cues ${rows.filter((r) => r.cues).length}, clean ${rows.filter((r) => r.clean).length})`;
await writeFile(join(dir, "results.md"), `${summary}\n\n${table}\n`);
console.log(`${summary}\n\n${table}`);
