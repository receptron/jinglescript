// npm run build: compiles src/ to dist/ and makes the CLI executable.
import { execFileSync } from "node:child_process";
import { chmod, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
await rm(dist, { recursive: true, force: true });
execFileSync("npx", ["tsc", "-p", "tsconfig.build.json"], { cwd: root, stdio: "inherit" });
await chmod(join(dist, "cli.js"), 0o755);
console.log("built dist/");
