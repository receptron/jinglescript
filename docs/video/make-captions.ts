// node docs/video/make-captions.ts <timing.json> [telops.json] [--font <name>] > captions.ass
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { TimingSchema } from "../../src/index.ts";
import { assSubtitles, TelopsSchema } from "./captions.ts";

const DEFAULT_FONT = "Hiragino Maru Gothic ProN";

const { positionals, values } = parseArgs({ allowPositionals: true, options: { font: { type: "string" } } });
const [timingFile, telopsFile] = positionals;
if (timingFile === undefined) {
  console.error("Usage: node docs/video/make-captions.ts <timing.json> [telops.json] [--font <name>] > captions.ass");
  process.exit(1);
}
const readJson = async (file: string): Promise<unknown> => JSON.parse(await readFile(file, "utf8"));
const timing = TimingSchema.parse(await readJson(timingFile));
const telops = telopsFile === undefined ? [] : TelopsSchema.parse(await readJson(telopsFile));
process.stdout.write(assSubtitles(timing, telops, { font: values.font ?? DEFAULT_FONT }));
