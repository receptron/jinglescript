// npm run readme: puts the authoring guide (src/guide.ts) into README.md between its markers.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withGuide } from "../src/readme.ts";

const file = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "README.md");
await writeFile(file, withGuide(await readFile(file, "utf8")));
console.log("wrote the guide into README.md");
