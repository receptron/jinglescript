// npm run demo-data: renders two examples into demo/samples.json for the demo page (git-ignored).
import { readFile, writeFile } from "node:fs/promises";
import { manage } from "../../src/manage.ts";

const samples = [];
for (const name of ["hatena-marumo-a", "ukulele-island-strum", "riser-reveal"]) {
  const score: unknown = JSON.parse(await readFile(new URL(`../../examples/${name}.json`, import.meta.url), "utf8"));
  const result = await manage({ action: "renderScore", score, fileName: name }, { player: true });
  samples.push({ toolName: "manageJingleScript", uuid: name, title: result.player?.title, message: result.text, data: result.player });
}
await writeFile(new URL("../demo/samples.json", import.meta.url), JSON.stringify(samples));
console.log(`wrote demo/samples.json (${samples.length} samples)`);
