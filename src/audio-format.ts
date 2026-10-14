// The audio formats a render can be written as, and their MIME types. No Node built-in, so the
// browser's player data names WAV the way the Node encoder does.
export const AUDIO_FORMATS = ["wav", "mp3", "ogg"] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

export const MIME_TYPES: Record<AudioFormat, string> = { wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg" };

export function isAudioFormat(name: string): name is AudioFormat {
  return AUDIO_FORMATS.some((f) => f === name);
}
