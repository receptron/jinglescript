<script setup lang="ts">
// The studio: a video (yours, or the demo clip), marks on its timeline with a sound each, and a music
// style. Every change becomes a score (studioScore), rendered in the playground's worker; Play runs
// the picture and the rendered audio together.
import type { TimingMap } from "jinglescript/browser";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { RenderReply } from "../messages.ts";
import { createRenderClient } from "../render-client.ts";
import { DEMO_HEIGHT, DEMO_HIT_MARK, DEMO_MARKS, DEMO_SECONDS, DEMO_WIDTH, drawDemo } from "./demo-animation.ts";
import MarkPanel from "./MarkPanel.vue";
import { shellQuote, shortcutsApply } from "./page-rules.ts";
import { MAX_SECONDS, STYLE_IDS, STYLES, studioScore, type Mark, type SoundId, type StyleId } from "./score.ts";
import Timeline from "./Timeline.vue";

const RENDER_DELAY_MS = 300;
const PLAYGROUND_URL = "./";

const videoUrl = ref<string | undefined>();
const videoName = ref("your-video.mp4");
const duration = ref(DEMO_SECONDS);
const marks = ref<Mark[]>(DEMO_MARKS.map((mark) => ({ ...mark })));
const hitMarkId = ref<string | undefined>(DEMO_HIT_MARK);
const style = ref<StyleId | "none">("marimba");
const selectedId = ref<string | undefined>();
const nextSound = ref<SoundId>("pop");
const keepOriginalSound = ref(true);

const now = ref(0);
const playing = ref(false);
const status = ref("");
const audioUrl = ref<string | undefined>();
const timingUrl = ref<string | undefined>();
const peaks = ref<number[]>([]);
const video = ref<HTMLVideoElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const audio = new Audio();
let nextId = 1;
let renderTimer: ReturnType<typeof setTimeout> | undefined;
let frame = 0;
/** Bumped by every play and pause, so a play that resolves after a pause does not start the clock. */
let playToken = 0;

const selected = computed(() => marks.value.find((mark) => mark.id === selectedId.value));
const score = computed(() => studioScore({ duration: duration.value, marks: marks.value, style: style.value, hitMarkId: hitMarkId.value }));
const scoreJson = computed(() => JSON.stringify(score.value, null, 2));
const ffmpegCommand = computed(() =>
  [
    `ffmpeg -i ${shellQuote(videoName.value)} -i jingle.wav -filter_complex \\`,
    `  "[0:a]volume=0.5[v];[v][1:a]amix=inputs=2:duration=first:normalize=0[a]" \\`,
    `  -map 0:v -map "[a]" -c:v copy -c:a aac with-sound.mp4`,
  ].join("\n"),
);

const renderer = createRenderClient({ onReply, onFailure: renderFailed });

function revoke(url: string | undefined): void {
  if (url) URL.revokeObjectURL(url);
}

/** Drops the rendered audio, so nothing plays or downloads that is not this state's. */
function clearOutput(): void {
  pause();
  [audioUrl.value, timingUrl.value].forEach(revoke);
  audioUrl.value = undefined;
  timingUrl.value = undefined;
  peaks.value = [];
  audio.removeAttribute("src");
}

function requestRender(): void {
  // Any change makes a reply in flight stale, even before the delayed request goes out.
  renderer.invalidate();
  clearTimeout(renderTimer);
  if (score.value.tracks.length === 0) {
    clearOutput();
    status.value = "Add a mark, or pick a music style, to hear something.";
    return;
  }
  renderTimer = setTimeout(() => {
    status.value = "Rendering…";
    renderer.request({ score: score.value, name: "jingle", sfxBaseUrl: new URL("sfx/", document.baseURI).href });
  }, RENDER_DELAY_MS);
}

function onRendered(reply: Extract<RenderReply, { kind: "done" }>): void {
  const wasPlaying = playing.value;
  pause();
  revoke(audioUrl.value);
  revoke(timingUrl.value);
  audioUrl.value = URL.createObjectURL(new Blob([reply.wav], { type: "audio/wav" }));
  timingUrl.value = URL.createObjectURL(new Blob([JSON.stringify(reply.player.timing satisfies TimingMap, null, 2)], { type: "application/json" }));
  peaks.value = reply.player.peaks;
  audio.src = audioUrl.value;
  seek(now.value);
  if (wasPlaying) void play();
  status.value = `Ready: ${marks.value.length} mark${marks.value.length === 1 ? "" : "s"}, rendered in ${reply.ms} ms. Press Play (Space).`;
}

/** The latest render did not happen: the previous audio is not this state's, so it goes too. */
function renderFailed(message: string): void {
  clearOutput();
  status.value = message;
}

function onReply(reply: RenderReply): void {
  if (reply.kind === "done") onRendered(reply);
  else if (reply.kind === "downloading") status.value = `Downloading a sound: ${reply.file}`;
  else if (reply.kind === "invalid") renderFailed(`Could not build the sound: ${reply.errors[0]?.message ?? "invalid score"}`);
  else if (reply.kind === "failed") renderFailed(`Render failed: ${reply.message}`);
}

function draw(): void {
  const context = canvas.value?.getContext("2d");
  if (context) drawDemo(context, now.value);
}

function tick(): void {
  now.value = audio.currentTime;
  if (video.value && Math.abs(video.value.currentTime - now.value) > 0.15) video.value.currentTime = now.value;
  draw();
  if (audio.ended || now.value >= duration.value) pause();
  if (playing.value) frame = requestAnimationFrame(tick);
}

async function play(): Promise<void> {
  if (!audioUrl.value) return;
  if (now.value >= duration.value - 0.05) seek(0);
  const token = ++playToken;
  playing.value = true;
  try {
    await Promise.all([audio.play(), video.value?.play()]);
  } catch (error) {
    if (token === playToken) pause();
    status.value = `Could not play: ${error instanceof Error ? error.message : String(error)}`;
    return;
  }
  if (token !== playToken) return; // paused (or played again) while starting
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(tick);
}

function pause(): void {
  playToken++;
  playing.value = false;
  audio.pause();
  video.value?.pause();
  cancelAnimationFrame(frame);
}

function seek(seconds: number): void {
  now.value = Math.min(Math.max(0, seconds), duration.value);
  audio.currentTime = now.value;
  if (video.value) video.value.currentTime = now.value;
  draw();
}

function addMark(): void {
  const mark: Mark = { id: `u${nextId++}`, t: Math.round(now.value * 100) / 100, sound: nextSound.value };
  marks.value = [...marks.value, mark].sort((a, b) => a.t - b.t);
  selectedId.value = mark.id;
}

function updateSelected(change: (mark: Mark) => Mark): void {
  marks.value = marks.value.map((mark) => (mark.id === selectedId.value ? change(mark) : mark)).sort((a, b) => a.t - b.t);
}

function setSound(sound: SoundId): void {
  nextSound.value = sound;
  updateSelected((mark) => ({ ...mark, sound }));
}

function nudge(seconds: number): void {
  updateSelected((mark) => ({ ...mark, t: Math.round(Math.min(Math.max(0, mark.t + seconds), duration.value - 0.06) * 100) / 100 }));
}

function toggleHit(): void {
  hitMarkId.value = hitMarkId.value === selectedId.value ? undefined : selectedId.value;
}

function removeSelected(): void {
  marks.value = marks.value.filter((mark) => mark.id !== selectedId.value);
  if (hitMarkId.value === selectedId.value) hitMarkId.value = undefined;
  selectedId.value = undefined;
}

function useVideo(file: File): void {
  pause();
  revoke(videoUrl.value);
  videoUrl.value = URL.createObjectURL(file);
  videoName.value = file.name;
  marks.value = [];
  hitMarkId.value = undefined;
  selectedId.value = undefined;
  status.value = "Play your video and press “+ Sound here” (or M) where something happens.";
}

function onVideoLoaded(): void {
  duration.value = Math.min(MAX_SECONDS, video.value?.duration ?? DEMO_SECONDS);
  seek(0);
}

async function useDemo(): Promise<void> {
  pause();
  revoke(videoUrl.value);
  videoUrl.value = undefined;
  duration.value = DEMO_SECONDS;
  marks.value = DEMO_MARKS.map((mark) => ({ ...mark }));
  hitMarkId.value = DEMO_HIT_MARK;
  await nextTick();
  seek(0);
}

function onFile(event: Event): void {
  const file = event.target instanceof HTMLInputElement ? event.target.files?.[0] : undefined;
  if (file) useVideo(file);
}

function onDrop(event: DragEvent): void {
  const file = event.dataTransfer?.files[0];
  if (file?.type.startsWith("video/")) useVideo(file);
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    status.value = "Copied.";
  } catch {
    status.value = "Could not copy: select the text and copy it by hand.";
  }
}

function keyTarget(target: EventTarget | null) {
  return target instanceof HTMLElement ? { tagName: target.tagName, isContentEditable: target.isContentEditable } : null;
}

function onKey(event: KeyboardEvent): void {
  if (!shortcutsApply(keyTarget(event.target), event.key)) return;
  if (event.key === " ") {
    event.preventDefault();
    if (playing.value) pause();
    else void play();
  } else if (event.key === "m" || event.key === "M") addMark();
  else if ((event.key === "Delete" || event.key === "Backspace") && selected.value) removeSelected();
}

watch([score], requestRender);
watch(keepOriginalSound, (keep) => {
  if (video.value) video.value.muted = !keep;
});
onMounted(() => {
  window.addEventListener("keydown", onKey);
  draw();
  requestRender();
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  clearTimeout(renderTimer);
  pause();
  renderer.terminate();
  [audioUrl.value, timingUrl.value, videoUrl.value].forEach(revoke);
});
</script>

<template>
  <main class="mx-auto flex max-w-6xl flex-col gap-4 p-4" @dragover.prevent @drop.prevent="onDrop">
    <header class="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h1 class="text-2xl font-semibold">JingleScript Studio</h1>
        <p class="text-sm text-slate-600 dark:text-slate-400">
          Mark the moments in your video, pick a sound for each, and hear it land on the frame. No code; it all runs in your browser.
        </p>
      </div>
      <nav class="flex gap-4 text-sm">
        <a class="text-sky-700 underline dark:text-sky-400" :href="PLAYGROUND_URL">JSON playground</a>
        <a class="text-sky-700 underline dark:text-sky-400" href="https://github.com/receptron/jinglescript">GitHub</a>
      </nav>
    </header>

    <section class="flex flex-col gap-2">
      <div class="relative mx-auto aspect-video w-full max-w-3xl overflow-hidden rounded-xl bg-black shadow">
        <video v-if="videoUrl" ref="video" :src="videoUrl" class="h-full w-full" playsinline :muted="!keepOriginalSound" @loadedmetadata="onVideoLoaded" />
        <canvas v-else ref="canvas" :width="DEMO_WIDTH" :height="DEMO_HEIGHT" class="h-full w-full" aria-label="Demo clip: a ball bounces and becomes a logo" />
      </div>
      <div class="flex flex-wrap items-center justify-center gap-2 text-sm">
        <button
          type="button"
          class="rounded-full bg-sky-600 px-5 py-2 font-medium text-white disabled:opacity-50"
          :disabled="!audioUrl"
          @click="playing ? pause() : play()"
        >
          {{ playing ? "⏸ Pause" : "▶ Play" }}
        </button>
        <span class="tabular-nums">{{ now.toFixed(2) }} / {{ duration.toFixed(2) }} s</span>
        <button type="button" class="rounded-full bg-amber-400 px-4 py-2 font-medium text-slate-900" @click="addMark">＋ Sound here (M)</button>
        <label class="cursor-pointer rounded-full border border-slate-300 px-4 py-2 focus-within:ring-2 focus-within:ring-sky-500 dark:border-slate-700">
          🎬 Use my video<input type="file" accept="video/*" class="sr-only" @change="onFile" />
        </label>
        <button v-if="videoUrl" type="button" class="rounded-full border border-slate-300 px-4 py-2 dark:border-slate-700" @click="useDemo">
          Back to the demo
        </button>
        <label v-if="videoUrl" class="flex items-center gap-1"><input v-model="keepOriginalSound" type="checkbox" /> Video's own sound</label>
      </div>
      <p class="text-center text-sm" role="status">{{ status }}</p>
    </section>

    <Timeline
      :duration="duration"
      :now="now"
      :marks="marks"
      :selected-id="selectedId"
      :hit-mark-id="hitMarkId"
      :peaks="peaks"
      @seek="seek"
      @select="selectedId = $event"
    />

    <MarkPanel
      v-if="selected"
      :mark="selected"
      :is-hit="selected.id === hitMarkId"
      @sound="setSound"
      @nudge="nudge"
      @hit="toggleHit"
      @remove="removeSelected"
    />
    <p v-else class="text-sm text-slate-500">Click a mark on the timeline to change its sound, move it, or make the music land on it.</p>

    <section class="flex flex-col gap-2 rounded-xl bg-white p-4 shadow dark:bg-slate-900">
      <h2 class="font-medium">Music</h2>
      <div class="flex flex-wrap gap-2" role="group" aria-label="Music style">
        <button
          v-for="id in STYLE_IDS"
          :key="id"
          type="button"
          class="rounded-lg border-2 px-3 py-2 text-sm"
          :class="style === id ? 'border-sky-500 bg-sky-50 dark:bg-sky-950' : 'border-slate-200 dark:border-slate-700'"
          :aria-pressed="style === id"
          @click="style = id"
        >
          {{ STYLES[id].emoji }} {{ STYLES[id].label }}
        </button>
        <button
          type="button"
          class="rounded-lg border-2 px-3 py-2 text-sm"
          :class="style === 'none' ? 'border-sky-500 bg-sky-50 dark:bg-sky-950' : 'border-slate-200 dark:border-slate-700'"
          :aria-pressed="style === 'none'"
          @click="style = 'none'"
        >
          🔇 Sound effects only
        </button>
      </div>
      <p class="text-xs text-slate-500">
        The music builds up to the mark with ⭐ and lands a chord on it. Without a ⭐ it plays a short jingle from the start.
      </p>
    </section>

    <section class="flex flex-col gap-2 rounded-xl bg-white p-4 shadow dark:bg-slate-900">
      <h2 class="font-medium">Take it to your editor</h2>
      <div class="flex flex-wrap gap-2 text-sm">
        <a v-if="audioUrl" class="rounded-full bg-sky-600 px-4 py-2 text-white" :href="audioUrl" download="jingle.wav">⬇ Audio (WAV)</a>
        <a v-if="timingUrl" class="rounded-full border border-slate-300 px-4 py-2 dark:border-slate-700" :href="timingUrl" download="jingle.timing.json"
          >⬇ Timing map (JSON)</a
        >
      </div>
      <p class="text-xs text-slate-500">Drop jingle.wav on your editor's timeline at 0:00, or put it on the video with ffmpeg:</p>
      <pre class="overflow-x-auto rounded bg-slate-100 p-3 font-mono text-xs dark:bg-slate-800">{{ ffmpegCommand }}</pre>
      <div>
        <button type="button" class="rounded border border-slate-300 px-3 py-1 text-xs dark:border-slate-700" @click="copy(ffmpegCommand)">Copy command</button>
      </div>
      <details class="text-sm">
        <summary class="cursor-pointer">The score behind it (JingleScript JSON)</summary>
        <p class="my-2 text-xs text-slate-500">Every mark is a cue in seconds. Paste it into the JSON playground to keep editing, or hand it to an LLM.</p>
        <pre class="max-h-80 overflow-auto rounded bg-slate-100 p-3 font-mono text-xs dark:bg-slate-800">{{ scoreJson }}</pre>
        <button type="button" class="mt-2 rounded border border-slate-300 px-3 py-1 text-xs dark:border-slate-700" @click="copy(scoreJson)">Copy JSON</button>
      </details>
    </section>

    <footer class="text-xs text-slate-500">
      Your video never leaves your browser. Recorded sound effects: Kenney (CC0). Rendered with jinglescript/browser.
    </footer>
  </main>
</template>
