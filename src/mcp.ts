// The MCP server: one tool, `manageJingleScript` (src/manage.ts), carried over MCP. Rendering
// writes only inside the output directory fixed when the server starts. A score `path` is read
// relative to the directory the server runs in (the client's project), or as given when absolute.
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MANAGE_TOOL, ManageInputSchema, manage, type ManageInput } from "./manage.ts";

export const MCP_TOOL = MANAGE_TOOL;
export const DEFAULT_MCP_OUT_DIR = "out/jinglescript";

interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export async function handleManage(input: ManageInput, outDir: string): Promise<ToolResult> {
  const result = await manage(input, { outDir, readScoreFile: (path) => readFile(resolve(path), "utf8") });
  return { content: [{ type: "text", text: result.text }], ...(result.isError ? { isError: true } : {}) };
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
      description: `Write and render jingles: learn the format, list sounds, check a score, render it to audio + timing map (files go to ${dir}).`,
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
