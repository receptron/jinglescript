<script setup lang="ts">
// The timeline under the video: the rendered audio's waveform, the playhead, and a button per mark.
// Clicking the track seeks; clicking a mark selects it.
import { computed } from "vue";
import { sliderSeek } from "./page-rules.ts";
import { markRows, SOUNDS, type Mark } from "./score.ts";

const props = defineProps<{ duration: number; now: number; marks: readonly Mark[]; selectedId?: string; hitMarkId?: string; peaks: readonly number[] }>();
const emit = defineEmits<{ seek: [seconds: number]; select: [id: string] }>();

const percent = (t: number): string => `${(Math.min(Math.max(t / props.duration, 0), 1) * 100).toFixed(3)}%`;
// Marks closer than this (a fraction of the timeline) go on separate rows.
const MARK_GAP = 0.04;
const ROW_HEIGHT_PX = 34;
const rows = computed(() => markRows(props.marks, props.duration, MARK_GAP));
const rowCount = computed(() => Math.max(0, ...rows.value) + 1);
const bars = computed(() => props.peaks.map((peak, i) => ({ x: (i / Math.max(1, props.peaks.length)) * 100, h: Math.max(2, peak * 100) })));

function onTrackKey(event: KeyboardEvent): void {
  const to = sliderSeek(event.key, event.shiftKey, props.now, props.duration);
  if (to === undefined) return;
  event.preventDefault();
  emit("seek", to);
}

function onTrackClick(event: MouseEvent): void {
  if (!(event.currentTarget instanceof HTMLElement)) return;
  const box = event.currentTarget.getBoundingClientRect();
  emit("seek", ((event.clientX - box.left) / box.width) * props.duration);
}
</script>

<template>
  <div class="select-none">
    <div
      class="relative h-20 cursor-pointer overflow-hidden rounded-lg bg-slate-200 focus:ring-2 focus:ring-sky-500 focus:outline-none dark:bg-slate-800"
      role="slider"
      tabindex="0"
      aria-label="Timeline: click, or use the arrow keys (Shift for 1 s), to move the playhead"
      :aria-valuetext="`${now.toFixed(2)} of ${duration.toFixed(2)} seconds`"
      :aria-valuenow="now"
      :aria-valuemin="0"
      :aria-valuemax="duration"
      @click="onTrackClick"
      @keydown="onTrackKey"
    >
      <svg class="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <rect
          v-for="(bar, i) in bars"
          :key="i"
          :x="bar.x"
          :y="50 - bar.h / 2"
          :width="100 / Math.max(1, bars.length)"
          :height="bar.h"
          class="fill-sky-400/50"
        />
      </svg>
      <div class="pointer-events-none absolute inset-y-0 w-0.5 bg-red-500" :style="{ left: percent(now) }" />
    </div>
    <div class="relative mt-1" :style="{ height: `${rowCount * ROW_HEIGHT_PX}px` }">
      <button
        v-for="(mark, i) in marks"
        :key="mark.id"
        type="button"
        class="absolute -translate-x-1/2 rounded-full border-2 bg-white px-1 text-lg leading-7 shadow dark:bg-slate-900"
        :class="mark.id === selectedId ? 'border-sky-500' : 'border-transparent'"
        :style="{ left: percent(mark.t), top: `${(rows[i] ?? 0) * ROW_HEIGHT_PX}px` }"
        :aria-label="`${SOUNDS[mark.sound].label} at ${mark.t.toFixed(2)} s${mark.id === hitMarkId ? ', music lands here' : ''}`"
        @click="emit('select', mark.id)"
      >
        {{ SOUNDS[mark.sound].emoji }}<span v-if="mark.id === hitMarkId" class="absolute -top-2 -right-2 text-xs">⭐</span>
      </button>
    </div>
  </div>
</template>
