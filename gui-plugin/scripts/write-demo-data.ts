// npm run demo-data: renders a few examples into demo/samples.json for the demo page (git-ignored).
import { readFile, writeFile } from "node:fs/promises";
import { awaitDeferredPlayer } from "../../src/deferred-renders.ts";
import { manage } from "../../src/manage.ts";

const samples = [];
// The lesson is rendered as sheet music that plays by itself and reports when it has been heard
// (autoplay only works within a couple of minutes of this script, as the view plays only fresh renders).
const lesson = { view: "notation", autoplay: true, notifyWhenDone: true } as const;
for (const [name, presentation] of [
  ["learn-happy-birthday", lesson],
  ["hatena-marumo-a", {}],
  ["lyrics-hatena", {}],
  ["ukulele-island-strum", {}],
  ["riser-reveal", {}],
] as const) {
  const score: unknown = JSON.parse(await readFile(new URL(`../../examples/${name}.json`, import.meta.url), "utf8"));
  const result = await manage({ action: "renderScore", score, fileName: name, ...presentation }, { player: true });
  samples.push({ toolName: "manageJingleScript", uuid: name, title: result.player?.title, message: result.text, data: result.player });
}
// A card shown before its audio (a host that sets deferredAudio): the demo page's stand-in runtime
// hands the view the finished one (`collected`) a few seconds after the page loads.
const deferred = JSON.parse(await readFile(new URL("../../examples/hatena-marumo-b.json", import.meta.url), "utf8")) as unknown;
const pending = await manage({ action: "renderScore", score: deferred, fileName: "pending", autoplay: true }, { player: true, deferAudio: { waitMs: 0 } });
const finished = await awaitDeferredPlayer(pending.player?.pending ?? "");
if (finished.kind !== "ready") throw new Error(`the deferred demo render did not finish: ${finished.kind}`);
samples.push({
  toolName: "manageJingleScript",
  uuid: "pending",
  title: pending.player?.title,
  message: pending.text,
  data: pending.player,
  collected: finished.player,
});
await writeFile(new URL("../demo/samples.json", import.meta.url), JSON.stringify(samples));
console.log(`wrote demo/samples.json (${samples.length} samples)`);
