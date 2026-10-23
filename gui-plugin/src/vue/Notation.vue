<script setup lang="ts">
// Sheet music for the player: the score's MusicXML drawn by OpenSheetMusicDisplay, loaded only when
// this is shown, with its cursor on the note being played. The page stays white (paper) in dark mode.
import type { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { cursorIndex } from "./playback.ts";

const props = defineProps<{ musicxml: string; tempo: number; now: number }>();

const container = ref<HTMLDivElement | null>(null);
const state = ref<"loading" | "ready" | "failed">("loading");
let osmd: OpenSheetMusicDisplay | undefined;
/** Seconds of each cursor position, in order. */
let positions: number[] = [];
let at = 0;

function moveTo(seconds: number): void {
  const cursor = osmd?.cursor;
  if (cursor === undefined || positions.length === 0) return;
  const target = cursorIndex(positions, seconds);
  if (target === at) return;
  if (target < at) {
    cursor.reset();
    at = 0;
  }
  while (at < target) {
    cursor.next();
    at++;
  }
}

/** Draws `musicxml`; a newer call (the score changed meanwhile) wins. */
let drawing = 0;
async function draw(musicxml: string): Promise<void> {
  const element = container.value;
  if (!element) return;
  const call = ++drawing;
  state.value = "loading";
  try {
    const { OpenSheetMusicDisplay } = await import("opensheetmusicdisplay");
    osmd ??= new OpenSheetMusicDisplay(element, {
      backend: "svg",
      autoResize: true,
      autoBeam: true,
      drawTitle: false,
      drawComposer: false,
      drawCredits: false,
      followCursor: true,
      defaultColorMusic: "#000000",
    });
    const display = osmd;
    await display.load(musicxml);
    if (call !== drawing) return;
    display.render();
    const cursor = display.cursor;
    cursor.show();
    cursor.reset();
    const secondsPerWhole = (4 * 60) / props.tempo;
    const found: number[] = [];
    while (!cursor.iterator.EndReached) {
      found.push(cursor.iterator.currentTimeStamp.RealValue * secondsPerWhole);
      cursor.next();
    }
    cursor.reset();
    positions = found;
    at = 0;
    state.value = "ready";
    moveTo(props.now);
  } catch (error) {
    if (call !== drawing) return;
    console.error("jinglescript: the sheet music could not be drawn", error);
    state.value = "failed";
  }
}

onMounted(() => void draw(props.musicxml));

watch(
  () => props.musicxml,
  (musicxml) => void draw(musicxml),
);

watch(
  () => props.now,
  (seconds) => moveTo(seconds),
);

onBeforeUnmount(() => {
  osmd?.clear();
  osmd = undefined;
});
</script>

<template>
  <div class="sheet">
    <p v-if="state === 'loading'" class="status">Drawing the sheet music…</p>
    <p v-else-if="state === 'failed'" class="status">The sheet music could not be drawn. The audio still plays; the MusicXML can be downloaded below.</p>
    <!-- Never hidden: OSMD lays the page out at the container's width when it renders. -->
    <div ref="container" class="page" />
  </div>
</template>

<style scoped>
.sheet {
  background: #ffffff;
  color: #1d2330;
  border-radius: 8px;
  padding: 8px 4px;
  margin-bottom: 10px;
  min-height: 80px;
  overflow-x: auto;
}
.status {
  margin: 8px 12px;
  font-size: 0.85rem;
  color: #6b7686;
}
</style>
