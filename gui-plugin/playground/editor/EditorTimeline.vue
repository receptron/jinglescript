<script setup lang="ts">
// The score on a timeline: a ruler with the beat grid, the cues as flags, and one lane per track with
// a block per sound. Drag a block or a cue to move it (the blocks shown while dragging are the
// moved score's, expanded), double-click a lane to add a sound there, click the ruler to play from
// that point.
import type { InstrumentInfo, ScoreInput } from "jinglescript/browser";
import { computed, ref } from "vue";
import { snappedSeconds, type AtInput, type CueInput, type NoteRef, type TimeContext, type TimelineMove } from "./score-edit.ts";
import { beatLines, TRACK_HEADER_PX as HEADER_PX, type Block } from "./timeline-layout.ts";

const props = defineProps<{
  score: ScoreInput;
  blocks: Block[];
  /** Cue times to draw, in seconds: the dragged score's while a drag is held. */
  cueTimes: Readonly<Record<string, number>>;
  duration: number;
  /** The score's times as written, which a drag snaps against. */
  context: TimeContext;
  pxPerSecond: number;
  selected: NoteRef | undefined;
  now: number | undefined;
  instruments: InstrumentInfo[];
}>();

const emit = defineEmits<{
  select: [ref: NoteRef | undefined];
  /** A drag in progress (undefined when it ends without a move). */
  preview: [move: TimelineMove | undefined];
  move: [move: TimelineMove];
  add: [track: number, seconds: number];
  seek: [seconds: number];
  setInstrument: [track: number, instrument: string];
  removeTrack: [track: number];
}>();

const LANE_PX = 64;
const BLOCK_PX = 18;
const MIN_LENGTH_PX = 36;
/** Pixels the pointer must travel before a press on a block becomes a drag. */
const DRAG_THRESHOLD_PX = 3;

interface Drag {
  target: { kind: "note"; ref: NoteRef } | { kind: "cue"; name: string };
  startX: number;
  /** The time being moved, as written: what snapping keeps the form of. */
  at: AtInput;
  from: number;
  moved: boolean;
  /** Seconds the dragged thing would land at now. */
  to: number;
  /** The earliest it can land: an effect placed by its end starts no earlier than 0. */
  floor: number;
}

const drag = ref<Drag | undefined>();
const width = computed(() => Math.max(props.duration, 0.5) * props.pxPerSecond);
const beats = computed(() => beatLines(props.context.tempo, props.duration));
const xOf = (seconds: number) => seconds * props.pxPerSecond;
const isSelected = (block: Block) => props.selected?.track === block.track && props.selected.note === block.note;

const cues = computed(() => Object.entries(props.cueTimes).map(([name, seconds]) => ({ name, seconds })));

function lengthPx(block: Block): number {
  return Math.max(block.length * props.pxPerSecond, MIN_LENGTH_PX);
}

/** For a block placed by its end, the anchor is its end; the drag is measured from there. */
function anchorOf(block: Block, at: AtInput | undefined, end: AtInput | undefined): { at: AtInput; from: number; floor: number } {
  if (end !== undefined) return { at: end, from: block.start + block.length, floor: block.length };
  return { at: at ?? 0, from: block.start, floor: 0 };
}

function startNoteDrag(event: PointerEvent, block: Block): void {
  if (event.button !== 0) return;
  const ref = { track: block.track, note: block.note };
  const note = props.score.tracks[ref.track]?.notes[ref.note];
  if (note === undefined) return;
  emit("select", ref);
  // A repeat moves with its note: the drag moves the note's own time by as much as the pointer.
  const first = props.blocks.find((b) => b.track === ref.track && b.note === ref.note && b.repeat === 0) ?? block;
  const anchor = anchorOf(first, note.at, note.end);
  drag.value = { target: { kind: "note", ref }, startX: event.clientX, ...anchor, moved: false, to: anchor.from };
  capture(event);
}

function startCueDrag(event: PointerEvent, name: string, seconds: number): void {
  if (event.button !== 0) return;
  drag.value = { target: { kind: "cue", name }, startX: event.clientX, at: { seconds }, from: seconds, moved: false, to: seconds, floor: 0 };
  capture(event);
}

function capture(event: PointerEvent): void {
  if (event.currentTarget instanceof Element) event.currentTarget.setPointerCapture(event.pointerId);
  event.stopPropagation();
}

function cueContext(free: boolean): TimeContext {
  return { ...props.context, gridBeats: free ? undefined : props.context.gridBeats };
}

function onPointerMove(event: PointerEvent): void {
  const current = drag.value;
  if (current === undefined) return;
  const dx = event.clientX - current.startX;
  if (!current.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
  const target = current.from + dx / props.pxPerSecond;
  const context = cueContext(event.altKey);
  // A cue's form is its own ({ seconds } or { beats }); snap it as a time of that form.
  const cue: CueInput | undefined = current.target.kind === "cue" ? props.score.cues?.[current.target.name] : undefined;
  const at: AtInput = cue === undefined ? current.at : "beats" in cue ? 0 : { seconds: 0 };
  const next = { ...current, moved: true, to: snappedSeconds(at, target, context, current.floor) };
  drag.value = next;
  emit("preview", moveOf(next));
}

function moveOf(current: Drag): TimelineMove {
  return { ...current.target, seconds: current.to };
}

function onPointerUp(): void {
  const current = drag.value;
  drag.value = undefined;
  emit("preview", undefined);
  if (current === undefined || !current.moved || current.to === current.from) return;
  emit("move", moveOf(current));
}

function secondsAt(event: MouseEvent): number {
  const target = event.currentTarget;
  if (!(target instanceof Element)) return 0;
  return Math.max(0, (event.clientX - target.getBoundingClientRect().left) / props.pxPerSecond);
}

function onInstrument(track: number, event: Event): void {
  if (event.target instanceof HTMLSelectElement) emit("setInstrument", track, event.target.value);
}

function trackLabel(track: ScoreInput["tracks"][number], index: number): string {
  return track.name ?? `track ${index + 1}`;
}
</script>

<template>
  <div
    class="overflow-x-auto rounded border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <div class="relative" :style="{ width: `${width + HEADER_PX}px` }">
      <!-- ruler and cues -->
      <div class="flex h-12 border-b border-slate-200 dark:border-slate-700">
        <div
          class="sticky left-0 z-20 shrink-0 border-r border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900"
          :style="{ width: `${HEADER_PX}px` }"
        >
          {{ context.tempo }} BPM<br />click to play from
        </div>
        <div class="relative cursor-pointer" :style="{ width: `${width}px` }" @click="emit('seek', secondsAt($event))">
          <template v-for="(line, i) in beats" :key="i">
            <div
              class="absolute bottom-0 border-l"
              :class="line.bar ? 'h-4 border-slate-400' : 'h-2 border-slate-300 dark:border-slate-600'"
              :style="{ left: `${xOf(line.seconds)}px` }"
            ></div>
            <span v-if="line.bar" class="absolute bottom-3 pl-1 text-[10px] text-slate-500" :style="{ left: `${xOf(line.seconds)}px` }"
              >{{ line.seconds.toFixed(1) }}s</span
            >
          </template>
          <button
            v-for="cue in cues"
            :key="cue.name"
            type="button"
            :title="`Cue ${cue.name} at ${cue.seconds.toFixed(3)} s — drag to move (Alt: no snapping)`"
            class="absolute top-0 z-10 -translate-x-px cursor-ew-resize touch-none rounded-r bg-amber-400 px-1.5 text-xs font-medium text-amber-950"
            :style="{ left: `${xOf(cue.seconds)}px` }"
            @pointerdown="startCueDrag($event, cue.name, cue.seconds)"
            @click.stop
          >
            {{ cue.name }}
          </button>
        </div>
      </div>

      <!-- lanes -->
      <div v-for="(track, t) in score.tracks" :key="t" class="flex border-b border-slate-200 dark:border-slate-700" :style="{ height: `${LANE_PX}px` }">
        <div
          class="sticky left-0 z-20 flex shrink-0 flex-col justify-center gap-1 border-r border-slate-200 bg-white px-2 dark:border-slate-700 dark:bg-slate-900"
          :style="{ width: `${HEADER_PX}px` }"
        >
          <div class="flex items-center justify-between gap-1">
            <span class="truncate text-xs font-medium">{{ trackLabel(track, t) }}</span>
            <button
              v-if="score.tracks.length > 1"
              type="button"
              class="text-xs text-slate-400 hover:text-red-600"
              :title="`Remove ${trackLabel(track, t)}`"
              @click="emit('removeTrack', t)"
            >
              ✕
            </button>
          </div>
          <select
            class="w-full rounded border border-slate-300 bg-white text-xs dark:border-slate-700 dark:bg-slate-900"
            :value="track.instrument"
            :aria-label="`Instrument of ${trackLabel(track, t)}`"
            @change="onInstrument(t, $event)"
          >
            <option v-if="!instruments.some((i) => i.name === track.instrument)" :value="track.instrument">{{ track.instrument }}</option>
            <option v-for="instrument in instruments" :key="instrument.name" :value="instrument.name">{{ instrument.name }}</option>
          </select>
        </div>
        <div
          class="relative"
          :style="{ width: `${width}px` }"
          title="Double-click to add a sound"
          @dblclick="emit('add', t, secondsAt($event))"
          @click="emit('select', undefined)"
        >
          <div
            v-for="(line, i) in beats"
            :key="i"
            class="pointer-events-none absolute inset-y-0 border-l"
            :class="line.bar ? 'border-slate-200 dark:border-slate-700' : 'border-slate-100 dark:border-slate-800'"
            :style="{ left: `${xOf(line.seconds)}px` }"
          ></div>
          <div
            v-for="cue in cues"
            :key="cue.name"
            class="pointer-events-none absolute inset-y-0 border-l-2 border-amber-400/70"
            :style="{ left: `${xOf(cue.seconds)}px` }"
          ></div>
          <button
            v-for="block in blocks.filter((b) => b.track === t)"
            :key="`${block.note}:${block.repeat}`"
            type="button"
            :title="`${block.label} at ${block.start.toFixed(3)} s — drag to move (Alt: no snapping)`"
            class="absolute z-10 cursor-grab touch-none truncate rounded px-1 text-left text-[10px] leading-[18px] font-medium"
            :class="[
              block.repeat > 0 ? 'opacity-40' : '',
              isSelected(block) ? 'bg-sky-600 text-white ring-2 ring-sky-300' : 'bg-sky-200 text-sky-950 hover:bg-sky-300 dark:bg-sky-800 dark:text-sky-50',
            ]"
            :style="{
              left: `${xOf(block.start)}px`,
              width: `${lengthPx(block)}px`,
              top: `${4 + block.height * (LANE_PX - BLOCK_PX - 8)}px`,
              height: `${BLOCK_PX}px`,
            }"
            @pointerdown="startNoteDrag($event, block)"
            @click.stop
            @dblclick.stop
          >
            {{ block.label }}
          </button>
        </div>
      </div>

      <div
        v-if="now !== undefined"
        class="pointer-events-none absolute inset-y-0 z-30 border-l-2 border-red-500"
        :style="{ left: `${HEADER_PX + xOf(now)}px` }"
      ></div>
    </div>
  </div>
</template>
