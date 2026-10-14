<script setup lang="ts">
// The playground: pick an example or edit a score, render it in a worker with the library's
// browser entry, and play it in the GUI plugin's player view.
import type { ToolResultComplete } from "gui-chat-protocol";
import type { PlayerData, ScoreProblem } from "jinglescript/browser";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import View from "../src/vue/View.vue";
import { DEFAULT_EXAMPLE, EXAMPLES } from "./examples.ts";
import type { RenderReply, RenderRequest } from "./messages.ts";

const REPO_URL = "https://github.com/receptron/jinglescript";
const GROUPS = ["Examples", "Piano classics"] as const;
const LONG_PIECE_SECONDS = 60;

let worker = startWorker();
const selected = ref(DEFAULT_EXAMPLE);
/** The player's title when the score has none: the example's name, until the score is edited. */
const fallbackName = ref(DEFAULT_EXAMPLE);
const source = ref("");
const busy = ref(false);
const status = ref("");
const problems = ref<{ kind: "error" | "warning"; problem: ScoreProblem }[]>([]);
const result = ref<ToolResultComplete<PlayerData> | undefined>();
const timingUrl = ref<string | undefined>();
let renderId = 0;

const timingSummary = computed(() => {
  const timing = result.value?.data?.timing;
  if (!timing) return "";
  const { tempo, duration, cues, audibleUntil } = timing;
  return JSON.stringify({ tempo, duration, audibleUntil, cues, beats: `${timing.beats.length} beats`, notes: `${timing.notes.length} notes` }, null, 2);
});

/** Drops the shown render and frees the object URLs its audio and timing.json were served from. */
function clearResult(): void {
  const audio = result.value?.data?.audio;
  if (audio?.startsWith("blob:")) URL.revokeObjectURL(audio);
  if (timingUrl.value) URL.revokeObjectURL(timingUrl.value);
  result.value = undefined;
  timingUrl.value = undefined;
}

function fail(message: string): void {
  busy.value = false;
  clearResult(); // a stale render next to the problem would look like its result
  status.value = message;
}

function parseSource(): unknown {
  try {
    return JSON.parse(source.value);
  } catch (error) {
    status.value = `The score is not valid JSON: ${error instanceof Error ? error.message : String(error)}`;
    return undefined;
  }
}

function renderScore(): void {
  const score = parseSource();
  if (score === undefined) return;
  busy.value = true;
  status.value = "Rendering…";
  problems.value = [];
  const request: RenderRequest = { id: ++renderId, score, name: fallbackName.value, sfxBaseUrl: new URL("sfx/", document.baseURI).href };
  worker.postMessage(request);
}

function onDone(reply: Extract<RenderReply, { kind: "done" }>): void {
  const { warnings, downloads, ms } = reply;
  clearResult();
  // The audio arrives as bytes and is served from an object URL: a data URI of a long piece would be
  // copied as a string several times over.
  const player = { ...reply.player, audio: URL.createObjectURL(new Blob([reply.wav], { type: reply.player.mimeType })) };
  result.value = { toolName: "manageJingleScript", uuid: String(reply.id), message: player.title, title: player.title, data: player };
  timingUrl.value = URL.createObjectURL(new Blob([JSON.stringify(player.timing, null, 2)], { type: "application/json" }));
  problems.value = warnings.map((problem) => ({ kind: "warning", problem }));
  const fetched = downloads > 0 ? `, ${downloads} sample${downloads === 1 ? "" : "s"} downloaded` : "";
  status.value = `Rendered ${player.duration.toFixed(1)} s in ${ms} ms${fetched}, ${player.loudness} LUFS.`;
}

function onReply(reply: RenderReply): void {
  if (reply.id !== renderId) return;
  if (reply.kind === "downloading") {
    status.value = `Downloading samples (${reply.count}): ${reply.file}`;
    return;
  }
  if (reply.kind === "rendering") {
    const long = reply.seconds > LONG_PIECE_SECONDS ? " A long piece takes minutes; Stop cancels it." : "";
    status.value = `Rendering ${reply.seconds.toFixed(1)} s of audio…${long}`;
    return;
  }
  busy.value = false;
  if (reply.kind === "done") return onDone(reply);
  if (reply.kind === "failed") return fail(`Render failed: ${reply.message}`);
  fail("The score has errors; fix them and render again.");
  problems.value = reply.errors.map((problem) => ({ kind: "error", problem }));
}

async function pick(name: string): Promise<void> {
  const example = EXAMPLES.find((e) => e.name === name);
  if (!example) return;
  const previous = selected.value;
  selected.value = name;
  try {
    source.value = JSON.stringify(await example.load(), null, 2);
  } catch (error) {
    selected.value = previous; // the editor still holds the previous score
    status.value = `Could not load the example ${name}: ${error instanceof Error ? error.message : String(error)}. Reload the page.`;
    return;
  }
  fallbackName.value = name;
  renderScore();
}

function onPick(event: Event): void {
  if (event.target instanceof HTMLSelectElement) void pick(event.target.value);
}

function onKey(event: KeyboardEvent): void {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) renderScore();
}

function startWorker(): Worker {
  const started = new Worker(new URL("./render-worker.ts", import.meta.url), { type: "module" });
  started.addEventListener("message", (event: MessageEvent<RenderReply>) => onReply(event.data));
  // A worker that cannot load (a stale tab after a redeploy) or a reply that cannot be read sends no message.
  started.addEventListener("error", (event) => fail(`The renderer stopped: ${event.message || "it could not be loaded"}. Reload the page.`));
  started.addEventListener("messageerror", () => fail("The renderer's answer could not be read. Reload the page."));
  return started;
}

/** Render is synchronous inside the worker, so stopping it means replacing the worker. */
function stop(): void {
  worker.terminate();
  worker = startWorker();
  renderId++;
  fail("Stopped.");
}
onMounted(() => void pick(DEFAULT_EXAMPLE));
onBeforeUnmount(() => {
  worker.terminate();
  clearResult();
});
</script>

<template>
  <main class="mx-auto flex max-w-7xl flex-col gap-4 p-4">
    <header class="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h1 class="text-2xl font-semibold">JingleScript playground</h1>
        <p class="text-sm text-slate-600 dark:text-slate-400">
          A JSON score, rendered to audio and a timing map in your browser — no server. Edit it and press Render (⌘/Ctrl + Enter).
        </p>
      </div>
      <nav class="flex gap-4 text-sm">
        <a class="text-sky-700 underline dark:text-sky-400" :href="`${REPO_URL}#how-to-write-a-jingle`">How to write a score</a>
        <a class="text-sky-700 underline dark:text-sky-400" :href="REPO_URL">GitHub</a>
        <a class="text-sky-700 underline dark:text-sky-400" href="https://www.npmjs.com/package/jinglescript">npm</a>
      </nav>
    </header>

    <div class="grid gap-4 lg:grid-cols-2">
      <section class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <label class="text-sm font-medium" for="example">Example</label>
          <select
            id="example"
            class="rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
            :value="selected"
            :disabled="busy"
            @change="onPick"
          >
            <optgroup v-for="group in GROUPS" :key="group" :label="group">
              <option v-for="example in EXAMPLES.filter((e) => e.group === group)" :key="example.name" :value="example.name">{{ example.name }}</option>
            </optgroup>
          </select>
          <button
            type="button"
            class="rounded bg-sky-600 px-4 py-1 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
            :disabled="busy"
            @click="renderScore"
          >
            Render
          </button>
          <button
            v-if="busy"
            type="button"
            class="rounded border border-slate-400 px-4 py-1 text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-800"
            @click="stop"
          >
            Stop
          </button>
        </div>
        <textarea
          v-model="source"
          aria-label="Score (JSON)"
          spellcheck="false"
          class="h-[60vh] w-full resize-y rounded border border-slate-300 bg-white p-3 font-mono text-xs leading-relaxed dark:border-slate-700 dark:bg-slate-900"
          @keydown="onKey"
          @input="fallbackName = 'score'"
        ></textarea>
      </section>

      <section class="flex flex-col gap-3">
        <p class="min-h-5 text-sm" role="status">{{ status }}</p>
        <ul v-if="problems.length" class="flex flex-col gap-1 text-sm">
          <li
            v-for="(p, i) in problems"
            :key="`${p.kind}:${p.problem.path}:${i}`"
            :class="p.kind === 'error' ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'"
          >
            <code class="font-mono">{{ p.problem.path || "(score)" }}</code
            >: {{ p.problem.message }}
            <span v-if="p.problem.hint" class="text-slate-600 dark:text-slate-400">{{ p.problem.hint }}</span>
          </li>
        </ul>
        <div v-if="result" class="overflow-hidden rounded-xl shadow">
          <View :selected-result="result" />
        </div>
        <details v-if="result?.data" class="text-sm">
          <summary class="cursor-pointer">Timing map (what an animation syncs to)</summary>
          <a class="text-sky-700 underline dark:text-sky-400" :href="timingUrl" :download="`${result.data.title}.timing.json`">Download timing.json</a>
          <pre class="mt-2 max-h-96 overflow-auto rounded bg-white p-3 font-mono text-xs dark:bg-slate-900">{{ timingSummary }}</pre>
        </details>
      </section>
    </div>

    <footer class="text-xs text-slate-500">
      Grand piano: VCSL Steinway B (CC0), fetched from jsDelivr on first use. Recorded effects: Kenney (CC0). Samples are kept in your browser's cache.
    </footer>
  </main>
</template>
