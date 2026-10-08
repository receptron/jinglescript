// npm run schema: writes the published JSON Schemas, generated from the zod schemas. A test fails
// when the committed files are stale.
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_FILES, schemaFileText } from "../src/schema-files.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const [file, part] of Object.entries(SCHEMA_FILES)) {
  await writeFile(join(root, "schema", file), schemaFileText(part));
  console.log(`wrote schema/${file}`);
}
