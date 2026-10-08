<script setup lang="ts">
// The player: the rendered jingle with its waveform, beats, cues and per-track notes, and its
// lyrics karaoke-style when it has any. Click the waveform or a cue to jump there.
import type { ToolResultComplete } from "gui-chat-protocol";
import type { PlayerData } from "jinglescript";
import { computed, onBeforeUnmount, ref } from "vue";
import { formatTime, karaoke, lanes, waveformPath, WIDTH, xOf } from "./layout.ts";

const props = defineProps<{ selectedResult: ToolResultComplete<PlayerData> }>();

const data = computed(() => props.selectedResult.data);
const audio = ref<HTMLAudioElement | null>(null);
const playing = ref(false);
const now = ref(0);
let frame = 0;

const WAVE_HEIGHT = 140;
const LANE_HEIGHT = 18;
const trackLanes = computed(() => (data.value ? lanes(data.value) : []));
const height = computed(() => WAVE_HEIGHT + trackLanes.value.length * LANE_HEIGHT + 8);
const duration = computed(() => data.value?.duration ?? 0);
const path = computed(() => waveformPath(data.value?.peaks ?? [], WAVE_HEIGHT / 2, WAVE_HEIGHT / 2 - 6));
const beats = computed(() => (data.value?.timing.beats ?? []).map((t) => xOf(t, duration.value)));
const cues = computed(() => Object.entries(data.value?.timing.cues ?? {}).map(([name, t]) => ({ name, t, x: xOf(t, duration.value) })));
const audibleX = computed(() => xOf(data.value?.timing.audibleUntil ?? 0, duration.value));
const playheadX = computed(() => xOf(now.value, duration.value));
const lyricLines = computed(() => karaoke(data.value?.timing.lyrics, now.value));
const extension = computed(() => (data.value?.mimeType === "audio/mpeg" ? "mp3" : "wav"));

function tick(): void {
  now.value = audio.value?.currentTime ?? 0;
  if (playing.value) frame = requestAnimationFrame(tick);
}

async function play(from?: number): Promise<void> {
  const element = audio.value;
  if (!element) return;
  if (from !== undefined) element.currentTime = Math.max(0, from);
  await element.play();
  playing.value = true;
  frame = requestAnimationFrame(tick);
}

function pause(): void {
  audio.value?.pause();
  playing.value = false;
  cancelAnimationFrame(frame);
  tick();
}

function toggle(): void {
  if (playing.value) pause();
  else void play();
}

function seek(event: MouseEvent): void {
  const svg = event.currentTarget;
  if (!(svg instanceof SVGSVGElement)) return;
  const box = svg.getBoundingClientRect();
  void play(((event.clientX - box.left) / box.width) * duration.value);
}

function ended(): void {
  playing.value = false;
  cancelAnimationFrame(frame);
  now.value = duration.value;
}

onBeforeUnmount(() => cancelAnimationFrame(frame));
</script>

<template>
  <div v-if="data" class="jingle">
    <header>
      <h2>{{ data.title }}</h2>
      <span class="meta">{{ formatTime(data.duration) }} · {{ data.loudness }} LUFS · {{ data.timing.tempo }} BPM</span>
    </header>

    <svg :viewBox="`0 0 ${WIDTH} ${height}`" preserveAspectRatio="none" class="wave" role="img" :aria-label="`Waveform of ${data.title}`" @click="seek">
      <rect :x="audibleX" y="0" :width="WIDTH - audibleX" :height="WAVE_HEIGHT" class="tail" />
      <line v-for="(x, i) in beats" :key="`b${i}`" :x1="x" :x2="x" y1="0" :y2="WAVE_HEIGHT" class="beat" />
      <path :d="path" class="shape" />
      <g v-for="(lane, l) in trackLanes" :key="`l${l}`">
        <line
          x1="0"
          :x2="WIDTH"
          :y1="WAVE_HEIGHT + 4 + l * LANE_HEIGHT + LANE_HEIGHT / 2"
          :y2="WAVE_HEIGHT + 4 + l * LANE_HEIGHT + LANE_HEIGHT / 2"
          class="lane"
        />
        <g v-for="(note, n) in lane.notes" :key="`n${n}`">
          <line
            v-if="note.x2 !== undefined"
            :x1="note.x"
            :x2="note.x2"
            :y1="WAVE_HEIGHT + 4 + l * LANE_HEIGHT + LANE_HEIGHT / 2"
            :y2="WAVE_HEIGHT + 4 + l * LANE_HEIGHT + LANE_HEIGHT / 2"
            :stroke="lane.color"
            class="span"
          />
          <circle :cx="note.x" :cy="WAVE_HEIGHT + 4 + l * LANE_HEIGHT + LANE_HEIGHT / 2" r="4" :fill="lane.color">
            <title>{{ note.label }}</title>
          </circle>
        </g>
      </g>
      <g v-for="cue in cues" :key="cue.name">
        <line :x1="cue.x" :x2="cue.x" y1="0" :y2="height" class="cue" />
      </g>
      <line :x1="playheadX" :x2="playheadX" y1="0" :y2="height" class="playhead" />
    </svg>
    <div class="cue-labels" aria-hidden="true">
      <span v-for="cue in cues" :key="`c${cue.name}`" :style="{ left: `${(cue.x / WIDTH) * 100}%` }">{{ cue.name }}</span>
    </div>

    <div class="lanes">
      <span v-for="(lane, l) in trackLanes" :key="`k${l}`" class="lane-name"><i :style="{ background: lane.color }" />{{ lane.name }}</span>
    </div>

    <div v-if="lyricLines.length > 0" class="karaoke" :class="{ two: (data.timing.lyrics?.length ?? 0) > 1 }">
      <p v-for="(line, i) in lyricLines" :key="line.key" :class="{ next: i > 0 }">
        <span v-for="(syllable, s) in line.syllables" :key="s" :style="{ '--sung': `${(syllable.progress * 100).toFixed(1)}%` }">{{ syllable.text }}</span>
      </p>
    </div>

    <div class="controls">
      <button type="button" class="play" :aria-label="playing ? 'Pause' : 'Play'" @click="toggle">
        <svg v-if="playing" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="3" y="2" width="3.5" height="12" />
          <rect x="9.5" y="2" width="3.5" height="12" />
        </svg>
        <svg v-else viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2 L14 8 L4 14 Z" /></svg>
      </button>
      <span class="time">{{ formatTime(now) }} / {{ formatTime(data.duration) }}</span>
      <a class="download" :href="data.audio" :download="`${data.title}.${extension}`">Download</a>
    </div>

    <div v-if="cues.length > 0" class="cues">
      <button v-for="cue in cues" :key="cue.name" type="button" class="chip" @click="play(cue.t - 0.5)">
        {{ cue.name }} <span>{{ cue.t.toFixed(3) }} s</span>
      </button>
    </div>

    <audio ref="audio" :src="data.audio" preload="auto" @ended="ended" @pause="playing = false" />
  </div>
</template>

<style scoped>
.jingle {
  --bg: #ffffff;
  --fg: #1d2330;
  --muted: #6b7686;
  --wave: #4f7cff;
  --grid: rgba(29, 35, 48, 0.12);
  --cue: #e8743b;
  --tail: rgba(29, 35, 48, 0.05);
  --chip: #f1f3f7;
  --sung-color: #e8743b;
  background: var(--bg);
  color: var(--fg);
  font-family: system-ui, sans-serif;
  padding: 16px;
  box-sizing: border-box;
  width: 100%;
}
@media (prefers-color-scheme: dark) {
  .jingle {
    --bg: #161a22;
    --fg: #e6e9ef;
    --muted: #9aa4b2;
    --wave: #7d9cff;
    --grid: rgba(230, 233, 239, 0.14);
    --cue: #ff9a5c;
    --tail: rgba(230, 233, 239, 0.05);
    --chip: #232937;
    --sung-color: #ff9a5c;
  }
}
header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
h2 {
  font-size: 1.05rem;
  margin: 0;
}
.meta,
.time,
.lane-name {
  color: var(--muted);
  font-size: 0.85rem;
}
.wave {
  width: 100%;
  height: auto;
  min-height: 120px;
  cursor: pointer;
  display: block;
}
.shape {
  fill: var(--wave);
  opacity: 0.85;
}
.beat,
.lane {
  stroke: var(--grid);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.cue {
  stroke: var(--cue);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}
.playhead {
  stroke: var(--fg);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.tail {
  fill: var(--tail);
}
.span {
  stroke-width: 6;
  stroke-linecap: round;
  opacity: 0.45;
  vector-effect: non-scaling-stroke;
}
.cue-labels {
  position: relative;
  height: 16px;
}
.cue-labels span {
  position: absolute;
  transform: translateX(-50%);
  font-size: 0.75rem;
  color: var(--cue);
  white-space: nowrap;
}
.lanes {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin: 6px 0 10px;
}
.lane-name i {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 4px;
}
.karaoke {
  margin: 4px 0 12px;
  text-align: center;
}
/* Room for two lines even while the last one shows alone, so the player does not jump. */
.karaoke.two {
  min-height: calc(1.6rem * 1.5 + 1.15rem * 1.5);
}
.karaoke p {
  margin: 0;
  font-size: 1.6rem;
  font-weight: 700;
  line-height: 1.5;
  white-space: pre-wrap;
}
.karaoke p.next {
  font-size: 1.15rem;
  opacity: 0.6;
}
.karaoke span {
  background: linear-gradient(90deg, var(--sung-color) var(--sung), var(--fg) var(--sung));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.controls {
  display: flex;
  align-items: center;
  gap: 12px;
}
.play svg {
  width: 14px;
  height: 14px;
  fill: currentColor;
}
.play {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: var(--wave);
  color: #fff;
  font-size: 0.95rem;
  cursor: pointer;
}
.download {
  margin-left: auto;
  color: var(--wave);
  font-size: 0.85rem;
}
.cues {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.chip {
  border: 1px solid var(--cue);
  background: var(--chip);
  color: var(--fg);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 0.85rem;
  cursor: pointer;
}
.chip span {
  color: var(--muted);
}
</style>
