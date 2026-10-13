// The package's version, read from its package.json (next to src/ in a clone, next to dist/ when
// installed), for the CLI's --version and the MCP server's handshake.
import { readFileSync } from "node:fs";
import { z } from "zod";

const PackageSchema = z.object({ version: z.string() });

export function packageVersion(): string {
  const parsed = PackageSchema.safeParse(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")));
  return parsed.success ? parsed.data.version : "0.0.0";
}
