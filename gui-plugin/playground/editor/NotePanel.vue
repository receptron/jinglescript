<script setup lang="ts">
// The selected sound's settings: when it plays (in the form it is written in), its pitch or chord or
// variant, how hard, how long, whether it repeats.
import { parseCueRef, type InstrumentDescriptor } from "jinglescript/browser";
import { computed } from "vue";
import { atInForm, formatCueRef, formOf, transpose, type AtForm, type AtInput, type NoteInput, type TimeContext } from "./score-edit.ts";

const props = defineProps<{
  note: NoteInput;
  /** Seconds the time being edited (`end` for an effect placed by its end, else `at`) resolves to. */
  anchor: number;
  context: TimeContext;
  descriptor: InstrumentDescriptor | undefined;
  trackLabel: string;
  canRemove: boolean;
}>();

const emit = defineEmits<{ change: [note: NoteInput]; remove: []; duplicate: [] }>();

const SEMITONE = 1;
const OCTAVE = 12;
const FORMS: { form: AtForm; label: string }[] = [
  { form: "beats", label: "beats" },
  { form: "seconds", label: "seconds" },
  { form: "cue", label: "from a cue" },
];

const byEnd = computed(() => props.note.end !== undefined);
const time = computed<AtInput>(() => props.note.end ?? props.note.at ?? 0);
const form = computed(() => formOf(time.value));
const cueRef = computed(() => (typeof time.value === "string" ? parseCueRef(time.value) : undefined));
const cueNames = computed(() => Object.keys(props.context.cues));
const timeValue = computed(() => {
  const at = time.value;
  if (typeof at === "number") return at;
  if (typeof at === "object") return at.seconds;
  return cueRef.value?.offsetBeats ?? 0;
});
const pitchText = computed(() => (Array.isArray(props.note.pitch) ? props.note.pitch.join(", ") : (props.note.pitch ?? "")));
const showsPitch = computed(() => props.note.chord === undefined && (props.descriptor?.pitched !== false || props.note.pitch !== undefined));
const variants = computed(() => props.descriptor?.variants ?? []);
const variantValue = computed(() => (typeof props.note.variant === "string" ? props.note.variant : ""));
const hasLength = computed(() => props.note.len !== undefined || props.descriptor?.sustained === true || props.descriptor?.duration !== undefined);
const lenInSeconds = computed(() => typeof props.note.len === "object");
const lenValue = computed(() => (typeof props.note.len === "object" ? props.note.len.seconds : (props.note.len ?? "")));

function withTime(at: AtInput): NoteInput {
  return byEnd.value ? { ...props.note, end: at } : { ...props.note, at };
}

function numberOf(event: Event): number | undefined {
  if (!(event.target instanceof HTMLInputElement) || event.target.value.trim() === "") return undefined;
  const value = Number(event.target.value);
  return Number.isFinite(value) ? value : undefined;
}

function textOf(event: Event): string {
  return event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement ? event.target.value : "";
}

function setForm(event: Event): void {
  const next = textOf(event);
  const chosen = FORMS.find((f) => f.form === next)?.form ?? "beats";
  const cue = cueRef.value?.cue ?? cueNames.value[0];
  if (chosen === "cue" && cue === undefined) return;
  // Rewriting the form keeps the time; the grid is for moving it.
  emit("change", withTime(atInForm(chosen, props.anchor, { ...props.context, gridBeats: undefined }, cue)));
}

function setTimeValue(event: Event): void {
  const value = numberOf(event);
  if (value === undefined) return;
  if (form.value === "beats") return emit("change", withTime(value));
  if (form.value === "seconds") return emit("change", withTime({ seconds: value }));
  const cue = cueRef.value?.cue;
  if (cue === undefined) return;
  emit("change", withTime(formatCueRef(cue, value)));
}

function setCue(event: Event): void {
  emit("change", withTime(formatCueRef(textOf(event), cueRef.value?.offsetBeats ?? 0)));
}

function setPitch(event: Event): void {
  const pitches = textOf(event)
    .split(/[\s,]+/)
    .filter(Boolean);
  const [first] = pitches;
  if (first === undefined) return;
  emit("change", { ...props.note, pitch: pitches.length === 1 ? first : pitches });
}

function setChord(event: Event): void {
  emit("change", { ...props.note, chord: textOf(event) });
}

function setVariant(event: Event): void {
  const { variant: _variant, ...rest } = props.note;
  const variant = textOf(event);
  emit("change", variant === "" ? rest : { ...rest, variant });
}

function setVel(event: Event): void {
  const vel = numberOf(event);
  if (vel !== undefined) emit("change", { ...props.note, vel });
}

function setLen(event: Event): void {
  const value = numberOf(event);
  const { len: _len, ...rest } = props.note;
  if (value === undefined || value <= 0) return emit("change", rest);
  emit("change", { ...rest, len: lenInSeconds.value ? { seconds: value } : value });
}

function setRepeat(patch: { every?: number; count?: number } | undefined): void {
  const { repeat, ...rest } = props.note;
  if (patch === undefined) return emit("change", rest);
  const every = patch.every ?? repeat?.every ?? 1;
  const until = repeat?.until;
  const count = patch.count ?? repeat?.count;
  emit("change", { ...rest, repeat: until !== undefined && patch.count === undefined ? { every, until } : { every, count: count ?? 2 } });
}
</script>

<template>
  <section class="flex flex-col gap-3 rounded border border-slate-300 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900" aria-label="Selected sound">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="font-medium">{{ trackLabel }} · {{ byEnd ? "ends" : "starts" }} at {{ anchor.toFixed(3) }} s</span>
      <div class="flex gap-2">
        <button
          type="button"
          class="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          title="Duplicate (⌘/Ctrl+D)"
          @click="emit('duplicate')"
        >
          Duplicate
        </button>
        <button
          type="button"
          class="rounded border border-red-300 px-2 py-0.5 text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
          :disabled="!canRemove"
          :title="canRemove ? 'Delete (Delete key)' : 'The score needs at least one sound'"
          @click="emit('remove')"
        >
          Delete
        </button>
      </div>
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <label class="flex flex-wrap items-center gap-2">
        <span class="w-16 text-slate-600 dark:text-slate-400">{{ byEnd ? "Ends" : "Time" }}</span>
        <input
          type="number"
          step="any"
          class="w-24 rounded border border-slate-300 px-1 dark:border-slate-700 dark:bg-slate-900"
          :value="timeValue"
          :aria-label="`Time in ${form}`"
          @change="setTimeValue"
        />
        <select
          class="rounded border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
          :value="form"
          aria-label="Written as"
          @change="setForm"
        >
          <option v-for="f in FORMS" :key="f.form" :value="f.form" :disabled="f.form === 'cue' && cueNames.length === 0">{{ f.label }}</option>
        </select>
        <select
          v-if="form === 'cue'"
          class="rounded border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
          :value="cueRef?.cue"
          aria-label="Cue"
          @change="setCue"
        >
          <option v-for="name in cueNames" :key="name" :value="name">{{ name }}</option>
        </select>
      </label>

      <label v-if="showsPitch" class="flex flex-wrap items-center gap-2">
        <span class="w-16 text-slate-600 dark:text-slate-400">Pitch</span>
        <input
          type="text"
          class="w-32 rounded border border-slate-300 px-1 font-mono dark:border-slate-700 dark:bg-slate-900"
          :value="pitchText"
          placeholder="C5 or C4, E4, G4"
          @change="setPitch"
        />
        <span class="flex gap-1">
          <button
            type="button"
            class="rounded border border-slate-300 px-1.5 dark:border-slate-700"
            title="Octave down"
            @click="emit('change', transpose(note, -OCTAVE))"
          >
            −8va
          </button>
          <button
            type="button"
            class="rounded border border-slate-300 px-1.5 dark:border-slate-700"
            title="Semitone down (↓)"
            @click="emit('change', transpose(note, -SEMITONE))"
          >
            −1
          </button>
          <button
            type="button"
            class="rounded border border-slate-300 px-1.5 dark:border-slate-700"
            title="Semitone up (↑)"
            @click="emit('change', transpose(note, SEMITONE))"
          >
            +1
          </button>
          <button
            type="button"
            class="rounded border border-slate-300 px-1.5 dark:border-slate-700"
            title="Octave up"
            @click="emit('change', transpose(note, OCTAVE))"
          >
            +8va
          </button>
        </span>
      </label>

      <label v-if="note.chord !== undefined" class="flex items-center gap-2">
        <span class="w-16 text-slate-600 dark:text-slate-400">Chord</span>
        <input
          type="text"
          class="w-24 rounded border border-slate-300 px-1 font-mono dark:border-slate-700 dark:bg-slate-900"
          :value="note.chord"
          placeholder="C, Am, G7"
          @change="setChord"
        />
      </label>

      <label v-if="variants.length > 0" class="flex items-center gap-2">
        <span class="w-16 text-slate-600 dark:text-slate-400">Sound</span>
        <select class="rounded border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900" :value="variantValue" @change="setVariant">
          <option value="">default</option>
          <option v-if="Array.isArray(note.variant)" value="" disabled>{{ note.variant.join(" / ") }} (edit in JSON)</option>
          <option v-for="v in variants" :key="v" :value="v">{{ v }}</option>
        </select>
      </label>

      <label class="flex items-center gap-2">
        <span class="w-16 text-slate-600 dark:text-slate-400">Velocity</span>
        <input type="range" min="0" max="1" step="0.05" class="w-32" :value="note.vel ?? 0.8" @change="setVel" />
        <span class="w-8 tabular-nums">{{ (note.vel ?? 0.8).toFixed(2) }}</span>
      </label>

      <label v-if="hasLength" class="flex items-center gap-2">
        <span class="w-16 text-slate-600 dark:text-slate-400">Length</span>
        <input
          type="number"
          min="0"
          step="any"
          class="w-20 rounded border border-slate-300 px-1 dark:border-slate-700 dark:bg-slate-900"
          :value="lenValue"
          placeholder="default"
          @change="setLen"
        />
        <span class="text-slate-500">{{ lenInSeconds ? "seconds" : "beats" }}</span>
      </label>

      <div class="flex flex-wrap items-center gap-2">
        <span class="w-16 text-slate-600 dark:text-slate-400">Repeat</span>
        <template v-if="note.repeat">
          every
          <input
            type="number"
            min="0"
            step="any"
            class="w-16 rounded border border-slate-300 px-1 dark:border-slate-700 dark:bg-slate-900"
            :value="note.repeat.every"
            aria-label="Beats between repeats"
            @change="setRepeat({ every: numberOf($event) })"
          />
          beats,
          <template v-if="note.repeat.count !== undefined">
            <input
              type="number"
              min="1"
              max="256"
              step="1"
              class="w-14 rounded border border-slate-300 px-1 dark:border-slate-700 dark:bg-slate-900"
              :value="note.repeat.count"
              aria-label="Times in all"
              @change="setRepeat({ count: numberOf($event) })"
            />
            times
          </template>
          <span v-else>until {{ note.repeat.until }}</span>
          <button type="button" class="text-slate-500 hover:text-red-600" title="Stop repeating" @click="setRepeat(undefined)">✕</button>
        </template>
        <button
          v-else
          type="button"
          class="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          @click="setRepeat({ every: 1, count: 4 })"
        >
          Repeat…
        </button>
      </div>
    </div>
  </section>
</template>
