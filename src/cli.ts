#!/usr/bin/env node
// The jinglescript CLI: a thin wrapper over the library.
import { readFile } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import { parseArgs } from "node:util";
import { demoScore } from "./demo.ts";
import { isInstrumentName } from "./instruments/index.ts";
import { checkScore, formatProblem, getAuthoringGuide, getInstrument, getSchema, listInstruments, parseScore, SCHEMA_PARTS } from "./index.ts";
import { isSchemaPart } from "./llm.ts";
import { renderToFiles } from "./output.ts";
import { SAMPLE_RATES, type SampleRate } from "./render.ts";
import { WAV_BITS } from "./wav.ts";

const USAGE = `Usage:
  jinglescript render <score.json> -o <out.wav> [--seed <n>] [--rate 48000|44100] [--bits 24|16]
                       writes the audio and <out>.timing.json next to it
  jinglescript check <score.json> [--json]   validate; print errors with hints and the resolved cue times
  jinglescript schema [${SCHEMA_PARTS.join("|")}]   print the JSON Schema (for LLM prompts)
  jinglescript guide                          print the authoring guide for LLMs
  jinglescript instruments [name] [--json]    list instruments and sound effects
  jinglescript demo <instrument> [-o <dir>]   render a sound across its range (or its variants)
  jinglescript mcp [--out <dir>]              MCP server over stdio: one tool, manageJingleScript
                                              (renders go to <dir>, default out/jinglescript)`;

const { positionals, values: args } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", short: "o" },
    seed: { type: "string" },
    rate: { type: "string" },
    bits: { type: "string" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function readJson(file: string | undefined): Promise<unknown> {
  if (file === undefined) fail(`Missing score file.\n\n${USAGE}`);
  const text = await readFile(file, "utf8");
  try {
    const data: unknown = JSON.parse(text);
    return data;
  } catch (error) {
    return fail(`${file}: not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
}

function sampleRateArg(): SampleRate | undefined {
  if (args.rate === undefined) return undefined;
  const rate = SAMPLE_RATES.find((r) => String(r) === args.rate);
  return rate ?? fail(`--rate must be one of ${SAMPLE_RATES.join(", ")}`);
}

function intArg(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fail(`${name} must be a non-negative integer`);
}

function report(files: Awaited<ReturnType<typeof renderToFiles>>, target: number): void {
  const { loudness, truePeak, limitingDb, limitedByPeak } = files.result.stats;
  console.log(`wrote ${files.audio} and ${files.timing}`);
  console.log(
    `  ${files.result.timing.duration} s, ${loudness.toFixed(1)} LUFS, true peak ${truePeak.toFixed(1)} dBTP, limiting ${limitingDb.toFixed(1)} dB, audible until ${files.result.timing.audibleUntil} s`,
  );
  if (limitedByPeak) console.log(`  note: the peak ceiling kept the loudness below the target (${target} LUFS)`);
}

async function renderCommand(file: string | undefined): Promise<void> {
  const out = args.out ?? fail(`render needs -o <out.wav>\n\n${USAGE}`);
  if (extname(out).toLowerCase() !== ".wav") fail("Only .wav output for now (MP3/OGG come with M4).");
  const bits = WAV_BITS.find((b) => String(b) === (args.bits ?? "24")) ?? fail("--bits must be 16 or 24");
  const score = parseScore(await readJson(file));
  const files = await renderToFiles(score, dirname(out), basename(out, extname(out)), { sampleRate: sampleRateArg(), seed: intArg(args.seed, "--seed"), bits });
  report(files, score.master.loudness);
}

async function demoCommand(name: string | undefined): Promise<void> {
  if (name === undefined || !isInstrumentName(name))
    fail(
      `demo needs an instrument: ${listInstruments()
        .map((i) => i.name)
        .join(", ")}`,
    );
  const score = parseScore(demoScore(name));
  report(await renderToFiles(score, args.out ?? "out", `demo-${name}`, { sampleRate: sampleRateArg() }), score.master.loudness);
}

async function checkCommand(file: string | undefined): Promise<void> {
  const result = checkScore(await readJson(file));
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`ok: ${result.duration} s, ${result.notes} notes`);
    for (const [name, cue] of Object.entries(result.cues)) console.log(`  cue ${name}: ${cue.seconds} s (beat ${cue.beat})`);
    for (const warning of result.warnings) console.log(`warning:${formatProblem(warning)}`);
  } else {
    console.log(`${result.errors.length} error${result.errors.length > 1 ? "s" : ""}:\n${result.errors.map(formatProblem).join("\n")}`);
  }
  if (!result.ok) process.exitCode = 1;
}

function instrumentsCommand(name: string | undefined): void {
  if (name !== undefined) {
    const info =
      getInstrument(name) ??
      fail(
        `Unknown instrument "${name}". Available: ${listInstruments()
          .map((i) => i.name)
          .join(", ")}`,
      );
    console.log(JSON.stringify(info, null, 2));
    return;
  }
  const all = listInstruments();
  if (args.json) {
    console.log(JSON.stringify(all, null, 2));
    return;
  }
  for (const i of all) {
    const range = i.range ? `${i.range.low}–${i.range.high}` : "unpitched";
    const traits = [i.kind, range, i.sustained ? "sustained" : "rings out", i.synthetic ? "synthetic-sounding" : ""].filter(Boolean).join(", ");
    console.log(`${i.name} (${traits})\n  ${i.description}`);
  }
}

const [command, target] = positionals;
if (args.help || command === undefined) {
  console.log(USAGE);
} else if (command === "render") {
  await renderCommand(target);
} else if (command === "check") {
  await checkCommand(target);
} else if (command === "schema") {
  const part = target ?? "score";
  if (!isSchemaPart(part)) fail(`Unknown schema part "${part}". Parts: ${SCHEMA_PARTS.join(", ")}`);
  console.log(JSON.stringify(getSchema(part), null, 2));
} else if (command === "guide") {
  console.log(getAuthoringGuide());
} else if (command === "instruments") {
  instrumentsCommand(target);
} else if (command === "demo") {
  await demoCommand(target);
} else if (command === "mcp") {
  // Loaded only here, so the library itself does not pull in the MCP SDK.
  const { runMcpServer } = await import("./mcp.ts");
  await runMcpServer(args.out);
} else {
  fail(`Unknown command "${command}".\n\n${USAGE}`);
}
