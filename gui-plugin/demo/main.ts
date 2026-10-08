// The demo page: every sample in the player view, and their previews. The sample JSON is checked
// against the timing-map schema on the way in, as any untyped data is.
import type { ToolResultComplete } from "gui-chat-protocol";
import type { PlayerData } from "jinglescript";
// The timing schema module alone: the library's index needs Node (ffmpeg), which a page cannot load.
import { TimingSchema } from "../../src/timing.ts";
import { createApp, h } from "vue";
import Preview from "../src/vue/Preview.vue";
import View from "../src/vue/View.vue";
import samples from "./samples.json";

const results: ToolResultComplete<PlayerData>[] = samples.map((s) => ({ ...s, data: { ...s.data, timing: TimingSchema.parse(s.data.timing) } }));

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
