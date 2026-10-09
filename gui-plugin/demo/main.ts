// The demo page: every sample in the player view, and their previews. The samples come from
// demo/samples.json (npm run demo-data; git-ignored), fetched at run time and checked on the way
// in, as any untyped data is.
import type { ToolResultComplete } from "gui-chat-protocol";
import type { PlayerData } from "jinglescript";
import { createApp, h } from "vue";
import { z } from "zod";
// The schema modules alone: the library's index needs Node (ffmpeg), which a page cannot load.
import { ScoreBaseSchema } from "../../src/score-schema.ts";
import { TimingSchema } from "../../src/timing.ts";
import Preview from "../src/vue/Preview.vue";
import View from "../src/vue/View.vue";

const PlayerSchema = z.object({
  title: z.string(),
  audio: z.string(),
  mimeType: z.string(),
  duration: z.number(),
  peaks: z.array(z.number()),
  timing: TimingSchema,
  tracks: z.array(z.string()),
  loudness: z.number(),
  score: ScoreBaseSchema,
  midi: z.string(),
});
const SamplesSchema = z.array(z.object({ toolName: z.string(), uuid: z.string(), message: z.string(), title: z.string().optional(), data: PlayerSchema }));

const response = await fetch(new URL("./samples.json", import.meta.url));
const results: ToolResultComplete<PlayerData>[] = SamplesSchema.parse(await response.json());

createApp({
  render: () => [
    h(
      "div",
      { class: "previews" },
      results.map((r) => h("div", [h(Preview, { result: r })])),
    ),
    ...results.map((r) => h("div", { class: "card" }, [h(View, { selectedResult: r, sendTextMessage: () => undefined })])),
  ],
}).mount("#app");
