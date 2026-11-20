<script setup lang="ts">
// The compact card in the chat history: title, length and a small waveform. It sets no text
// colour of its own (see the style below).
import type { ToolResultComplete } from "gui-chat-protocol";
import type { PlayerData } from "jinglescript";
import { computed } from "vue";
import { formatTime, waveformPath, WIDTH } from "./layout.ts";

const props = defineProps<{ result: ToolResultComplete<PlayerData> }>();
const data = computed(() => props.result.data);
const path = computed(() => waveformPath(data.value?.peaks ?? [], 20, 18));
</script>

<template>
  <div v-if="data" class="preview">
    <svg :viewBox="`0 0 ${WIDTH} 40`" preserveAspectRatio="none" aria-hidden="true"><path :d="path" /></svg>
    <div class="label">
      {{ data.title }} <span>{{ formatTime(data.duration) }}</span>
    </div>
  </div>
</template>

<style scoped>
/* The text colour is the host's: its list of cards may be light or dark whatever the system's
   colour scheme is, and a colour chosen here from that scheme was unreadable on the other. */
.preview {
  font-family: system-ui, sans-serif;
  font-size: 0.85rem;
  color: inherit;
}
svg {
  width: 100%;
  height: 32px;
  display: block;
}
path {
  fill: #4f7cff;
  opacity: 0.8;
}
.label span {
  opacity: 0.6;
}
</style>
