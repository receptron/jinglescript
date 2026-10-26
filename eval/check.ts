// Scores the evaluation: for each request in eval/requests.json, reads the score an LLM wrote at
// out/eval/<run>/<id>.json and checks it mechanically — valid, the requested times exist as cues,
// renders cleanly at the loudness target, and — for requests that give `words` — the lyrics contain
// those words in order; for requests marked `custom`, a track plays an instrument the score defines;
// for requests with `notation`, the score has the asked meter (and key, pickup, chord symbols) and
// writes as sheet music with nothing rounded or shortened. Usage: node eval/check.ts <run> [requests file, default requests.json]
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { checkScore, loadSamples, parseScore, render, scoreToMusicXml } from "../src/index.ts";

const RequestsSchema = z.array(
  z.strictObject({
    id: z.string(),
    request: z.string(),
    cues: z.array(z.number()),
    words: z.array(z.string()).optional().describe('Words the lyrics must contain, in order (spaces and case ignored); "a|b" accepts either spelling.'),
    custom: z.boolean().optional().describe("The request needs a custom instrument: a track must play one the score defines."),
    notation: z
      .strictObject({
        meter: z.string(),
        key: z.string().optional(),
        pickup: z.number().optional(),
        harmonies: z.int().optional().describe("At least this many chord symbols on the page."),
      })
      .optional()
      .describe("A request for sheet music: what the page must show."),
  }),
);

const run = process.argv[2] ?? "default";
const dir = join("out", "eval", run);
const requestsFile = process.argv[3] ?? "requests.json";
const requests = RequestsSchema.parse(JSON.parse(await readFile(new URL(requestsFile, import.meta.url), "utf8")));

interface Row {
  id: string;
  valid: boolean;
  cues: boolean;
  clean: boolean;
  detail: string;
}

const squash = (text: string): string => text.replace(/\s+/g, "").toLowerCase();

/** The requested words missing from the lyrics (all lines in order), in order. */
function missingWords(lyrics: readonly { text: string }[] | undefined, words: readonly string[]): string[] {
  const text = squash((lyrics ?? []).map((line) => line.text).join(""));
  let from = 0;
  const missing: string[] = [];
  for (const word of words) {
    // "Happy|ハッピー": any one of the spellings.
    const found = word
      .split("|")
      .map((spelling) => ({ at: text.indexOf(squash(spelling), from), length: squash(spelling).length }))
      .find((hit) => hit.at >= 0);
    if (found === undefined) missing.push(word);
    else from = found.at + found.length;
  }
  return missing;
}

/** True when a track plays an instrument defined under the score's `instruments`. */
function playsCustom(input: unknown): boolean {
  const parsed = parseScore(input);
  const defined = new Set(Object.keys(parsed.instruments ?? {}));
  return parsed.tracks.some((t) => defined.has(t.instrument));
}

type Request = z.infer<typeof RequestsSchema>[number];

/** What a sheet-music request's page lacks; empty when it is right. */
function notationProblems(input: unknown, want: NonNullable<Request["notation"]>): string[] {
  const parsed = parseScore(input);
  const problems: string[] = [];
  if ((parsed.meter ?? "4/4") !== want.meter) problems.push(`meter ${parsed.meter ?? "(none)"}, not ${want.meter}`);
  if (want.key !== undefined && parsed.key !== want.key) problems.push(`key ${parsed.key ?? "(none)"}, not ${want.key}`);
  if (want.pickup !== undefined && parsed.pickup !== want.pickup) problems.push(`pickup ${parsed.pickup ?? "(none)"}, not ${want.pickup}`);
  const warnings = checkScore(input, { notation: true }).warnings;
  const listed = warnings.map((w) => `${w.path} ${w.message}`).join(" / ");
  if (warnings.length > 0) problems.push(`sheet music: ${listed}`);
  const harmonies = (scoreToMusicXml(parsed)?.match(/<harmony>/g) ?? []).length;
  if (want.harmonies !== undefined && harmonies < want.harmonies) problems.push(`${harmonies} chord symbols, not ${want.harmonies}`);
  return problems;
}

async function score({ id, cues: expected, words = [], custom = false, notation }: Request): Promise<Row> {
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
  const wordsMissing = missingWords(check.lyrics, words);
  const customMissing = custom && !playsCustom(input);
  const pageProblems = notation === undefined ? [] : notationProblems(input, notation);
  // A grand piano needs its recordings (downloaded once, then cached).
  const parsed = parseScore(input);
  const { audio, stats } = await render(parsed, { samples: await loadSamples(parsed) });
  const finite = audio.every((channel) => channel.every(Number.isFinite));
  const clean = finite && stats.truePeak <= -1.5 && (Math.abs(stats.loudness - parseScore(input).master.loudness) <= 0.5 || stats.limitedByPeak);
  const detail = [
    missing.length > 0 ? `missing cues at ${missing.join(", ")} s` : "",
    wordsMissing.length > 0 ? `lyrics lack ${wordsMissing.join(", ")}` : "",
    customMissing ? "no track plays a custom instrument" : "",
    ...pageProblems,
    `${stats.loudness.toFixed(1)} LUFS, limiting ${stats.limitingDb.toFixed(1)} dB`,
  ]
    .filter(Boolean)
    .join("; ");
  return { id, valid: true, cues: missing.length === 0 && wordsMissing.length === 0 && !customMissing && pageProblems.length === 0, clean, detail };
}

const rows = await Promise.all(requests.map(score));
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
