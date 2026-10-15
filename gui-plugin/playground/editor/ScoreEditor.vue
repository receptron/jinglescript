<script setup lang="ts">
// The score as a GUI: a toolbar, the timeline, and the selected sound's settings. Every edit is
// handed up as the next score; the page keeps the JSON, the undo history and the render.
import { expandScore, listInstruments, ScoreBaseSchema, type ScoreInput } from "jinglescript/browser";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import EditorTimeline from "./EditorTimeline.vue";
import NotePanel from "./NotePanel.vue";
import {
  addNote,
  addTrack,
  anchorSeconds,
  canRemoveNote,
  cueForSeconds,
  cueUses,
  duplicateNote,
  freshCueName,
  moveNote,
  noteAt,
  removeCue,
  removeNote,
  removeTrack,
  setCue,
  setTrack,
  templateNote,
  transpose,
  updateNote,
  type NoteInput,
  type NoteRef,
  type TimeContext,
} from "./score-edit.ts";
import { timelineBlocks, TRACK_HEADER_PX } from "./timeline-layout.ts";

const props = defineProps<{ score: ScoreInput; audioUrl: string | undefined; canUndo: boolean; canRedo: boolean }>();
const emit = defineEmits<{ edit: [score: ScoreInput]; undo: []; redo: [] }>();

const INSTRUMENTS = listInstruments();
const GRIDS: { label: string; beats: number | undefined }[] = [
  { label: "1 beat", beats: 1 },
  { label: "1/2 beat", beats: 0.5 },
  { label: "1/4 beat", beats: 0.25 },
  { label: "1/8 beat", beats: 0.125 },
  { label: "off", beats: undefined },
];
const DEFAULT_GRID = 2;
const ZOOM_STEP = 1.5;
const MIN_PX_PER_SECOND = 10;
const MAX_PX_PER_SECOND = 1200;
/** Room the timeline's border and scrollbar take beside the lanes. */
const TIMELINE_EDGE_PX = 8;
/** Play from this long before an edited sound, so you hear what leads into it. */
const LEAD_IN_SECONDS = 0.75;
const NUDGE_BEATS = 0.25;
const OCTAVE = 12;

const selected = ref<NoteRef | undefined>();
const gridIndex = ref(DEFAULT_GRID);
const pxPerSecond = ref(0);
const playAfterEdit = ref(true);
const audio = ref<HTMLAudioElement | null>(null);
const playing = ref(false);
const now = ref<number | undefined>();
let pendingPlayFrom: number | undefined;
let frame = 0;

const expanded = computed(() => {
  const parsed = ScoreBaseSchema.safeParse(props.score);
  return parsed.success ? expandScore(parsed.data) : undefined;
});
const duration = computed(() => expanded.value?.duration ?? 0);
const context = computed<TimeContext>(() => ({ tempo: props.score.tempo, cues: expanded.value?.cues ?? {}, gridBeats: GRIDS[gridIndex.value]?.beats }));
const blocks = computed(() => (expanded.value ? timelineBlocks(expanded.value) : []));
const root = ref<HTMLElement | null>(null);
const fitWidth = ref(0);
/** Until zoomed, the whole score fits the width of the page. */
const zoom = computed(() => pxPerSecond.value || clampZoom(fitWidth.value / Math.max(duration.value, 0.5)));
const selectedNote = computed(() => (selected.value ? noteAt(props.score, selected.value) : undefined));
const selectedEvent = computed(() => {
  const ref = selected.value;
  return ref && expanded.value?.events.find((e) => e.track === ref.track && e.note === ref.note && e.repeat === 0);
});
const selectedAnchor = computed(() => (selectedNote.value && selectedEvent.value ? anchorSeconds(selectedNote.value, selectedEvent.value) : undefined));
const selectedTrack = computed(() => (selected.value ? props.score.tracks[selected.value.track] : undefined));
const descriptorOf = (instrument: string | undefined) => (instrument === undefined ? undefined : expanded.value?.instruments.get(instrument)?.descriptor);
const cueRows = computed(() => Object.entries(context.value.cues).map(([name, seconds]) => ({ name, seconds, uses: cueUses(props.score, name) })));
const lengthForm = computed(() => ("beats" in props.score.length ? "beats" : "seconds"));
const lengthValue = computed(() => ("beats" in props.score.length ? props.score.length.beats : props.score.length.seconds));

// A selection that no longer exists (an undo, a JSON edit) is dropped.
watch(
  () => props.score,
  () => {
    if (selected.value && !selectedNote.value) selected.value = undefined;
  },
);

/** Hands up the next score; when `playFrom` is given, plays from just before it once it is rendered. */
function edit(next: ScoreInput, playFrom?: number): void {
  pendingPlayFrom = playFrom === undefined ? undefined : Math.max(0, playFrom - LEAD_IN_SECONDS);
  emit("edit", next);
}

function onMove(ref: NoteRef, anchor: number): void {
  selected.value = ref;
  edit(moveNote(props.score, ref, anchor, context.value), anchor);
}

function onAdd(track: number, seconds: number): void {
  const template = templateNote(props.score, track, expanded.value?.events ?? [], seconds);
  if (template === undefined) return;
  const added = addNote(props.score, track, seconds, template, context.value);
  selected.value = added.ref;
  edit(added.score, seconds);
}

function changeSelected(note: NoteInput): void {
  if (!selected.value) return;
  edit(
    updateNote(props.score, selected.value, () => note),
    selectedAnchor.value,
  );
}

function removeSelected(): void {
  const ref = selected.value;
  if (!ref || !canRemoveNote(props.score, ref)) return;
  selected.value = undefined;
  edit(removeNote(props.score, ref));
}

function duplicateSelected(): void {
  const ref = selected.value;
  if (!ref || selectedAnchor.value === undefined) return;
  const at = selectedAnchor.value + 60 / props.score.tempo;
  const copy = duplicateNote(props.score, ref, at, context.value);
  selected.value = copy.ref;
  edit(copy.score, at);
}

function nudgeSelected(beats: number): void {
  const ref = selected.value;
  if (!ref || selectedAnchor.value === undefined) return;
  const at = selectedAnchor.value + (beats * 60) / props.score.tempo;
  edit(moveNote(props.score, ref, at, { ...context.value, gridBeats: context.value.gridBeats ?? NUDGE_BEATS }), at);
}

function transposeSelected(semitones: number): void {
  const note = selectedNote.value;
  if (note) changeSelected(transpose(note, semitones));
}

function onAddTrack(event: Event): void {
  if (!(event.target instanceof HTMLSelectElement) || event.target.value === "") return;
  const instrument = event.target.value;
  event.target.value = "";
  edit(addTrack(props.score, instrument, descriptorOf(instrument) ?? INSTRUMENTS.find((i) => i.name === instrument)), 0);
  selected.value = { track: props.score.tracks.length, note: 0 };
}

function onRemoveTrack(track: number): void {
  selected.value = undefined;
  edit(removeTrack(props.score, track));
}

function onAddCue(): void {
  const seconds = now.value ?? selectedAnchor.value ?? 0;
  edit(setCue(props.score, freshCueName(props.score, "cue"), { seconds: Math.round(seconds * 1000) / 1000 }));
}

function onMoveCue(name: string, seconds: number): void {
  const cue = props.score.cues?.[name];
  if (cue !== undefined) edit(setCue(props.score, name, cueForSeconds(cue, seconds, context.value)), seconds);
}

function numberOf(event: Event): number | undefined {
  if (!(event.target instanceof HTMLInputElement)) return undefined;
  const value = Number(event.target.value);
  return event.target.value.trim() !== "" && Number.isFinite(value) ? value : undefined;
}

function setCueSeconds(name: string, event: Event): void {
  const seconds = numberOf(event);
  if (seconds !== undefined) onMoveCue(name, seconds);
}

function setTempo(event: Event): void {
  const tempo = numberOf(event);
  if (tempo !== undefined) edit({ ...props.score, tempo });
}

function setLength(event: Event): void {
  const value = numberOf(event);
  if (value !== undefined) edit({ ...props.score, length: lengthForm.value === "beats" ? { beats: value } : { seconds: value } });
}

function clampZoom(px: number): number {
  return Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, px));
}

function zoomBy(factor: number): void {
  pxPerSecond.value = clampZoom(zoom.value * factor);
}

const resize = new ResizeObserver(([entry]) => {
  fitWidth.value = (entry?.contentRect.width ?? 0) - TRACK_HEADER_PX - TIMELINE_EDGE_PX;
});
onMounted(() => {
  if (root.value) resize.observe(root.value);
});

function tick(): void {
  now.value = audio.value?.currentTime;
  if (playing.value) frame = requestAnimationFrame(tick);
}

async function play(from?: number): Promise<void> {
  const element = audio.value;
  if (!element || !props.audioUrl) return;
  if (from !== undefined) element.currentTime = from;
  try {
    await element.play();
  } catch {
    return; // the source changed under it (a new render); the next one plays
  }
  playing.value = true;
  frame = requestAnimationFrame(tick);
}

function pause(): void {
  audio.value?.pause();
  playing.value = false;
  cancelAnimationFrame(frame);
}

function togglePlay(): void {
  if (playing.value) pause();
  else void play(audio.value?.ended ? 0 : undefined);
}

function onEnded(): void {
  playing.value = false;
  cancelAnimationFrame(frame);
}

// A new render: keep the playhead where it was, and play the edited moment when there is one.
watch(
  () => props.audioUrl,
  async () => {
    const from = pendingPlayFrom;
    pendingPlayFrom = undefined;
    const wasPlaying = playing.value;
    pause();
    if (!props.audioUrl || !audio.value) return;
    audio.value.load();
    if (from !== undefined && playAfterEdit.value) await play(from);
    else if (wasPlaying) await play(now.value ?? 0);
  },
  { flush: "post" },
);

const isTextField = (target: EventTarget | null) =>
  target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;

const KEYS: Record<string, (event: KeyboardEvent) => void> = {
  " ": togglePlay,
  Delete: removeSelected,
  Backspace: removeSelected,
  Escape: () => (selected.value = undefined),
  ArrowLeft: (e) => nudgeSelected(e.shiftKey ? -1 : -(context.value.gridBeats ?? NUDGE_BEATS)),
  ArrowRight: (e) => nudgeSelected(e.shiftKey ? 1 : (context.value.gridBeats ?? NUDGE_BEATS)),
  ArrowUp: (e) => transposeSelected(e.shiftKey ? OCTAVE : 1),
  ArrowDown: (e) => transposeSelected(e.shiftKey ? -OCTAVE : -1),
};

const COMMAND_KEYS: Record<string, (event: KeyboardEvent) => void> = {
  z: (e) => (e.shiftKey ? emit("redo") : emit("undo")),
  y: () => emit("redo"),
  d: duplicateSelected,
};

function onKey(event: KeyboardEvent): void {
  if (isTextField(event.target)) return;
  // A focused button keeps Space and Enter for itself.
  if (event.target instanceof HTMLButtonElement && (event.key === " " || event.key === "Enter")) return;
  const command = event.metaKey || event.ctrlKey;
  const action = command ? COMMAND_KEYS[event.key.toLowerCase()] : KEYS[event.key];
  if (action === undefined) return;
  event.preventDefault();
  action(event);
}

onBeforeUnmount(() => {
  pause();
  resize.disconnect();
});
</script>

<template>
  <div ref="root" class="flex flex-col gap-3 outline-none" tabindex="0" @keydown="onKey">
    <div class="flex flex-wrap items-center gap-2 text-sm">
      <button
        type="button"
        class="w-20 rounded bg-sky-600 px-3 py-1 font-medium text-white hover:bg-sky-700 disabled:opacity-50"
        :disabled="!audioUrl"
        @click="togglePlay"
      >
        {{ playing ? "❚❚ Pause" : "▶ Play" }}
      </button>
      <span class="w-24 text-xs text-slate-600 tabular-nums dark:text-slate-400">{{ (now ?? 0).toFixed(2) }} / {{ duration.toFixed(2) }} s</span>
      <button
        type="button"
        class="rounded border border-slate-300 px-2 py-1 disabled:opacity-40 dark:border-slate-700"
        :disabled="!canUndo"
        title="Undo (⌘/Ctrl+Z)"
        @click="emit('undo')"
      >
        ↶
      </button>
      <button
        type="button"
        class="rounded border border-slate-300 px-2 py-1 disabled:opacity-40 dark:border-slate-700"
        :disabled="!canRedo"
        title="Redo (⇧⌘/Ctrl+Z)"
        @click="emit('redo')"
      >
        ↷
      </button>
      <label class="flex items-center gap-1">
        Snap
        <select v-model.number="gridIndex" class="rounded border border-slate-300 bg-white px-1 py-0.5 dark:border-slate-700 dark:bg-slate-900">
          <option v-for="(grid, i) in GRIDS" :key="grid.label" :value="i">{{ grid.label }}</option>
        </select>
      </label>
      <span class="flex items-center gap-1">
        <button type="button" class="rounded border border-slate-300 px-2 py-0.5 dark:border-slate-700" title="Zoom out" @click="zoomBy(1 / ZOOM_STEP)">
          −
        </button>
        <button type="button" class="rounded border border-slate-300 px-2 py-0.5 dark:border-slate-700" title="Zoom in" @click="zoomBy(ZOOM_STEP)">+</button>
      </span>
      <label class="flex items-center gap-1">
        Tempo
        <input
          type="number"
          min="20"
          max="400"
          class="w-16 rounded border border-slate-300 px-1 dark:border-slate-700 dark:bg-slate-900"
          :value="score.tempo"
          @change="setTempo"
        />
      </label>
      <label class="flex items-center gap-1">
        Length
        <input
          type="number"
          min="0"
          step="any"
          class="w-16 rounded border border-slate-300 px-1 dark:border-slate-700 dark:bg-slate-900"
          :value="lengthValue"
          @change="setLength"
        />
        {{ lengthForm }}
      </label>
      <select
        class="rounded border border-slate-300 bg-white px-1 py-0.5 dark:border-slate-700 dark:bg-slate-900"
        aria-label="Add a track"
        @change="onAddTrack"
      >
        <option value="">+ Track…</option>
        <optgroup label="Instruments">
          <option v-for="i in INSTRUMENTS.filter((i) => i.kind === 'instrument')" :key="i.name" :value="i.name">{{ i.name }}</option>
        </optgroup>
        <optgroup label="Sound effects">
          <option v-for="i in INSTRUMENTS.filter((i) => i.kind === 'sfx')" :key="i.name" :value="i.name">{{ i.name }}</option>
        </optgroup>
      </select>
      <button
        type="button"
        class="rounded border border-slate-300 px-2 py-0.5 dark:border-slate-700"
        title="Add a cue at the playhead (or the selected sound)"
        @click="onAddCue"
      >
        + Cue
      </button>
      <label class="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
        <input v-model="playAfterEdit" type="checkbox" />
        play after each edit
      </label>
    </div>

    <EditorTimeline
      :score="score"
      :blocks="blocks"
      :duration="duration"
      :context="context"
      :px-per-second="zoom"
      :selected="selected"
      :now="now"
      :instruments="INSTRUMENTS"
      @select="selected = $event"
      @move="onMove"
      @move-cue="onMoveCue"
      @add="onAdd"
      @seek="play"
      @set-instrument="(track, instrument) => edit(setTrack(score, track, { instrument }))"
      @remove-track="onRemoveTrack"
    />

    <p class="text-xs text-slate-500">
      Drag a sound or a cue to move it (Alt: no snapping) · double-click a lane to add a sound · ← → nudge, ↑ ↓ pitch (⇧: beat / octave) · Delete · ⌘D duplicate
      · Space play
    </p>

    <NotePanel
      v-if="selected && selectedNote && selectedAnchor !== undefined"
      :note="selectedNote"
      :anchor="selectedAnchor"
      :context="context"
      :descriptor="descriptorOf(selectedTrack?.instrument)"
      :track-label="selectedTrack?.name ?? selectedTrack?.instrument ?? ''"
      :can-remove="canRemoveNote(score, selected)"
      @change="changeSelected"
      @remove="removeSelected"
      @duplicate="duplicateSelected"
    />

    <div v-if="cueRows.length" class="flex flex-wrap items-center gap-2 text-sm">
      <span class="text-slate-600 dark:text-slate-400">Cues</span>
      <span v-for="cue in cueRows" :key="cue.name" class="flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 dark:bg-amber-950">
        <span class="font-medium">{{ cue.name }}</span>
        <input
          type="number"
          min="0"
          step="any"
          class="w-20 rounded border border-amber-300 bg-white px-1 dark:border-amber-800 dark:bg-slate-900"
          :value="cue.seconds"
          :aria-label="`Cue ${cue.name} in seconds`"
          @change="setCueSeconds(cue.name, $event)"
        />
        s
        <button
          type="button"
          class="text-slate-500 hover:text-red-600 disabled:opacity-30 disabled:hover:text-slate-500"
          :disabled="cue.uses > 0"
          :title="cue.uses > 0 ? `${cue.uses} time${cue.uses === 1 ? '' : 's'} used: move those sounds off it first` : `Remove ${cue.name}`"
          @click="edit(removeCue(score, cue.name))"
        >
          ✕
        </button>
      </span>
    </div>

    <audio ref="audio" :src="audioUrl" preload="auto" class="hidden" @ended="onEnded"></audio>
  </div>
</template>
