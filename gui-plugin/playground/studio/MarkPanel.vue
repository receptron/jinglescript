<script setup lang="ts">
// The selected mark: its sound (a button per sound), its time (nudge), whether the music lands on it.
import { SOUND_IDS, SOUNDS, type Mark, type SoundId } from "./score.ts";

defineProps<{ mark: Mark; isHit: boolean }>();
const emit = defineEmits<{ sound: [sound: SoundId]; nudge: [seconds: number]; hit: []; remove: [] }>();
const NUDGES = [-0.1, -0.02, 0.02, 0.1] as const;
</script>

<template>
  <div class="flex flex-col gap-3 rounded-xl bg-white p-4 shadow dark:bg-slate-900">
    <div class="flex flex-wrap items-center gap-2 text-sm">
      <span class="font-medium">Mark at {{ mark.t.toFixed(2) }} s</span>
      <button v-for="n in NUDGES" :key="n" type="button" class="rounded border border-slate-300 px-2 py-0.5 dark:border-slate-700" @click="emit('nudge', n)">
        {{ n > 0 ? "+" : "−" }}{{ Math.abs(n) }} s
      </button>
      <button
        type="button"
        class="rounded px-2 py-0.5"
        :class="isHit ? 'bg-amber-400 text-slate-900' : 'border border-slate-300 dark:border-slate-700'"
        :aria-pressed="isHit"
        @click="emit('hit')"
      >
        ⭐ Music lands here
      </button>
      <button type="button" class="ml-auto rounded px-2 py-0.5 text-red-700 dark:text-red-400" @click="emit('remove')">Delete</button>
    </div>
    <div class="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6" role="group" aria-label="Sound for this mark">
      <button
        v-for="id in SOUND_IDS"
        :key="id"
        type="button"
        class="flex flex-col items-center rounded-lg border-2 px-1 py-2 text-xs"
        :class="id === mark.sound ? 'border-sky-500 bg-sky-50 dark:bg-sky-950' : 'border-slate-200 dark:border-slate-700'"
        :aria-pressed="id === mark.sound"
        @click="emit('sound', id)"
      >
        <span class="text-2xl" aria-hidden="true">{{ SOUNDS[id].emoji }}</span
        >{{ SOUNDS[id].label }}
      </button>
    </div>
    <p v-if="'lead' in SOUNDS[mark.sound]" class="text-xs text-slate-500">This sound leads in: it ends on the mark.</p>
  </div>
</template>
