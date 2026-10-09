import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMcpServer, MCP_TOOL } from "../src/mcp.ts";

const outDir = mkdtempSync(join(tmpdir(), "jinglescript-mcp-"));
const client = new Client({ name: "test", version: "0" });
const score = {
  format: "jinglescript/1",
  tempo: 120,
  length: { seconds: 3 },
  cues: { hit: { seconds: 1 } },
  tracks: [
    {
      instrument: "marimba",
      notes: [
        { at: 0, pitch: "G4" },
        { at: "hit", chord: "C" },
      ],
    },
  ],
};

beforeAll(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(outDir).connect(serverSide);
  await client.connect(clientSide);
});
afterAll(async () => {
  await client.close();
});

async function call(args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const result = await client.callTool({ name: MCP_TOOL, arguments: args });
  const content = result.content as { type: string; text: string }[];
  return { text: content[0]?.text ?? "", isError: result.isError === true };
}

describe("MCP server", () => {
  it("offers exactly one tool, manageJingleScript, with an object input schema", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([MCP_TOOL]);
    expect(tools[0]?.inputSchema.type).toBe("object");
    expect(JSON.stringify(tools[0]?.inputSchema)).toContain("renderScore");
    expect(client.getInstructions()).toContain("getGuide");
  });

  it("getGuide and getSchema return the guide and the JSON Schema", async () => {
    expect((await call({ action: "getGuide" })).text).toContain("# Writing a JingleScript score");
    const schema = JSON.parse((await call({ action: "getSchema", part: "timing" })).text) as { title: string };
    expect(schema.title).toBe("jinglescript-timing/1");
  });

  it("lists and describes instruments", async () => {
    const list = JSON.parse((await call({ action: "listInstruments" })).text) as { name: string }[];
    expect(list.map((i) => i.name)).toContain("ukulele");
    expect(JSON.parse((await call({ action: "getInstrument", instrument: "laser" })).text)).toMatchObject({ kind: "sfx", pitchOptional: true });
    expect(await call({ action: "getInstrument", instrument: "kazoo" })).toMatchObject({ isError: true });
  });

  it("checks a score and says what is missing for an action", async () => {
    expect(JSON.parse((await call({ action: "checkScore", score })).text)).toMatchObject({ ok: true, cues: { hit: { seconds: 1 } } });
    const bad = JSON.parse((await call({ action: "checkScore", score: { ...score, tempo: "fast" } })).text) as { errors: { path: string }[] };
    expect(bad.errors[0]?.path).toBe("tempo");
    const missing = await call({ action: "checkScore" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("checkScore needs `score`");
  });

  it("renders into its output folder only, and returns the timing map's summary", async () => {
    const result = JSON.parse((await call({ action: "renderScore", score: JSON.stringify(score), fileName: "opening" })).text) as {
      audio: string;
      timingFile: string;
      timing: { cues: Record<string, number>; omitted: string };
    };
    expect(result.audio).toBe(join(outDir, "opening.wav"));
    expect(readFileSync(result.audio).subarray(0, 4).toString()).toBe("RIFF");
    expect(JSON.parse(readFileSync(result.timingFile, "utf8"))).toMatchObject({ cues: { hit: 1 } });
    expect(result.timing.cues).toEqual({ hit: 1 });
    expect(result.timing.omitted).toContain("in timingFile");
    const escape = await call({ action: "renderScore", score, fileName: "../evil" });
    expect(escape.isError).toBe(true);
  });

  it("returns errors instead of rendering an invalid score", async () => {
    const result = await call({ action: "renderScore", score: { ...score, tracks: [] } });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('"errors"');
  });
});
