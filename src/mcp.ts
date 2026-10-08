// The MCP server: one tool, `manageJingleScript`, whose `action` says what to do. Each action calls
// one library function, so an MCP client gets exactly what the library and the CLI give. Rendering
// writes only inside the output directory fixed when the server starts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getAuthoringGuide, getInstrument, getSchema, listInstruments, SCHEMA_PARTS } from "./llm.ts";
import { renderToFiles } from "./output.ts";
import { checkScore, parseScore } from "./score.ts";

export const MCP_TOOL = "manageJingleScript";
export const MCP_ACTIONS = ["getGuide", "getSchema", "listInstruments", "getInstrument", "checkScore", "renderScore"] as const;
export type McpAction = (typeof MCP_ACTIONS)[number];
export const DEFAULT_MCP_OUT_DIR = "out/jinglescript";

/** A file stem: letters, digits, dot, dash, underscore — never a path. */
const FILE_STEM = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/;

const REQUIRED: Record<McpAction, readonly ("instrument" | "score")[]> = {
  getGuide: [],
  getSchema: [],
  listInstruments: [],
  getInstrument: ["instrument"],
  checkScore: ["score"],
  renderScore: ["score"],
};

export const ManageInputSchema = z
  .object({
    action: z
      .enum(MCP_ACTIONS)
      .describe(
        "What to do. The loop: getGuide (how to write a jingle) → getSchema (the exact format) → write a score → checkScore → fix every error → renderScore. listInstruments / getInstrument show the sounds.",
      ),
    part: z.enum(SCHEMA_PARTS).optional().describe('getSchema: one part only ("score" is the whole format, "timing" the timing map\'s).'),
    instrument: z.string().optional().describe("getInstrument: the instrument or sound effect's name."),
    score: z.unknown().optional().describe("checkScore, renderScore: the score as a JSON object (format jinglescript/1). A JSON string is accepted too."),
    fileName: z
      .string()
      .regex(FILE_STEM, { error: 'fileName is a plain file stem such as "opening" — no folders, no extension.' })
      .optional()
      .describe('renderScore: file stem for the outputs (default "jingle"): writes <stem>.wav and <stem>.timing.json in the server\'s output folder.'),
  })
  .superRefine((input, ctx) => {
    for (const field of REQUIRED[input.action]) {
      if (input[field] === undefined) ctx.addIssue({ code: "custom", path: [field], message: `${input.action} needs \`${field}\`.` });
    }
  });

type ManageInput = z.infer<typeof ManageInputSchema>;

interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

const text = (value: unknown, isError = false): ToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  ...(isError ? { isError } : {}),
});

function scoreInput(score: unknown): unknown {
  if (typeof score !== "string") return score;
  try {
    const parsed: unknown = JSON.parse(score);
    return parsed;
  } catch {
    return score;
  }
}

async function renderAction(input: ManageInput, outDir: string): Promise<ToolResult> {
  const score = scoreInput(input.score);
  const check = checkScore(score);
  if (!check.ok) return text({ ok: false, errors: check.errors }, true);
  const { audio, timing, result } = await renderToFiles(parseScore(score), outDir, input.fileName ?? "jingle");
  return text({
    ok: true,
    audio,
    timingFile: timing,
    loudness: Math.round(result.stats.loudness * 10) / 10,
    truePeak: Math.round(result.stats.truePeak * 10) / 10,
    limitingDb: Math.round(result.stats.limitingDb * 10) / 10,
    belowLoudnessTarget: result.stats.limitedByPeak,
    warnings: check.warnings,
    timing: result.timing,
  });
}

export async function handleManage(input: ManageInput, outDir: string): Promise<ToolResult> {
  switch (input.action) {
    case "getGuide":
      return text(getAuthoringGuide());
    case "getSchema":
      return text(getSchema(input.part));
    case "listInstruments":
      return text(listInstruments());
    case "getInstrument": {
      const info = getInstrument(input.instrument ?? "");
      return info
        ? text(info)
        : text(
            `Unknown instrument "${input.instrument ?? ""}". Available: ${listInstruments()
              .map((i) => i.name)
              .join(", ")}.`,
            true,
          );
    }
    case "checkScore":
      return text(checkScore(scoreInput(input.score)));
    case "renderScore":
      return renderAction(input, outDir);
  }
}

const PackageSchema = z.object({ version: z.string() });

function packageVersion(): string {
  const parsed = PackageSchema.safeParse(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")));
  return parsed.success ? parsed.data.version : "0.0.0";
}

const INSTRUCTIONS = `JingleScript turns a small JSON score into a short jingle with sound effects (WAV) plus a timing map an animation can sync to. Use the single tool ${MCP_TOOL}: first action "getGuide", then "getSchema", write a score, "checkScore" and fix every error it lists, then "renderScore". Times the animation needs (a landing, a logo, a cut) become cues in seconds.`;

export function createMcpServer(outDir: string): McpServer {
  const server = new McpServer({ name: "jinglescript", version: packageVersion() }, { instructions: INSTRUCTIONS });
  const dir = resolve(outDir);
  server.registerTool(
    MCP_TOOL,
    {
      description: `Write and render jingles: learn the format, list sounds, check a score, render it to WAV + timing map (files go to ${dir}).`,
      inputSchema: ManageInputSchema,
    },
    (input) => handleManage(input, dir),
  );
  return server;
}

/** Serves MCP over stdio until the client disconnects. */
export async function runMcpServer(outDir: string = DEFAULT_MCP_OUT_DIR): Promise<void> {
  await createMcpServer(outDir).connect(new StdioServerTransport());
}
