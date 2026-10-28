// The demo page: every sample in the player view, and their previews. The samples come from
// demo/samples.json (npm run demo-data; git-ignored), fetched at run time and checked on the way
// in, as any untyped data is.
import type { ToolResultComplete } from "gui-chat-protocol";
import { PLUGIN_RUNTIME_KEY, type BrowserPluginRuntime } from "gui-chat-protocol/vue";
import type { PlayerData } from "jinglescript";
import { createApp, h, ref } from "vue";
import { z } from "zod";
// The schema modules alone: the library's index needs Node (ffmpeg), which a page cannot load.
import { ScoreBaseSchema } from "../../src/score-schema.ts";
import { TimingSchema } from "../../src/timing.ts";
import { PROGRESS_REQUEST } from "../src/audio-request.ts";
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
  musicxml: z.string().optional(),
  presentation: z
    .object({
      view: z.enum(["waveform", "notation"]),
      autoplay: z.boolean(),
      autoplayDelay: z.number().optional(),
      notifyWhenDone: z.boolean(),
      renderedAt: z.number().optional(),
    })
    .optional(),
  pending: z.string().optional(),
});
const SamplesSchema = z.array(
  z.object({
    toolName: z.string(),
    uuid: z.string(),
    message: z.string(),
    title: z.string().optional(),
    data: PlayerSchema,
    /** For a pending sample: what the stand-in runtime hands its view. */
    collected: PlayerSchema.optional(),
  }),
);

const response = await fetch(new URL("./samples.json", import.meta.url));
const parsed = SamplesSchema.safeParse(response.ok ? await response.json() : undefined);
if (!parsed.success) {
  // A missing or stale samples.json (written before PlayerData changed) would otherwise leave a blank page.
  document.body.textContent = "demo/samples.json is missing or out of date: run `npm run demo-data`, then reload.";
  throw new Error(`demo/samples.json does not match PlayerData:\n${z.prettifyError(parsed.error)}`);
}
const results: ToolResultComplete<PlayerData>[] = parsed.data;

/** How long the stand-in server takes to finish a pending render. */
const COLLECT_MS = 3000;
const collectedById = new Map(
  parsed.data.flatMap((sample) => (sample.data.pending && sample.collected ? [[sample.data.pending, sample.collected] as const] : [])),
);

const loadedAt = Date.now();

/** How far the stand-in render is: NEUTRINO singing for most of COLLECT_MS, then the mix. */
function standInProgress(): object {
  const done = (Date.now() - loadedAt) / (0.8 * COLLECT_MS);
  return done < 1 ? { progress: { stage: "singing", done }, message: "" } : { progress: { stage: "mixing" }, message: "" };
}

/** A stand-in for the host's runtime: its dispatch answers a pending card's requests for its audio and its progress. */
const runtime: BrowserPluginRuntime = {
  pubsub: { subscribe: () => () => undefined },
  locale: ref("en"),
  log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
  openUrl: (url: string) => window.open(url, "_blank", "noopener,noreferrer"),
  dispatch: (args: object) =>
    Reflect.get(args, "kind") === PROGRESS_REQUEST
      ? Promise.resolve(standInProgress())
      : new Promise((resolve) => {
          const id: unknown = Reflect.get(args, "id");
          const data = typeof id === "string" ? collectedById.get(id) : undefined;
          setTimeout(
            () => resolve(data ? { outcome: "ready", data, message: "The audio is ready." } : { outcome: "gone", message: "Not in this demo." }),
            COLLECT_MS,
          );
        }),
};

/** What the views would send the LLM, listed on the page. */
const sent = ref<string[]>([]);

createApp({
  render: () => [
    h("div", { class: "sent" }, [
      h("strong", "Sent to the LLM: "),
      sent.value.length === 0
        ? "nothing yet"
        : h(
            "ol",
            sent.value.map((text) => h("li", text)),
          ),
    ]),
    h(
      "div",
      { class: "previews" },
      results.map((r) => h("div", [h(Preview, { result: r })])),
    ),
    ...results.map((r) => h("div", { class: "card" }, [h(View, { selectedResult: r, sendTextMessage: (text?: string) => sent.value.push(text ?? "") })])),
  ],
})
  .provide(PLUGIN_RUNTIME_KEY, runtime)
  .mount("#app");
