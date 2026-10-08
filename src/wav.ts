// WAV writer: stereo PCM, 24-bit by default (no dither needed at that depth), 16-bit on request.

export const WAV_BITS = [16, 24] as const;
export type WavBits = (typeof WAV_BITS)[number];

export function toWav(audio: readonly Float32Array[], sampleRate: number, bits: WavBits = 24): Uint8Array {
  const channels = audio.length;
  const frames = audio[0]?.length ?? 0;
  const bytesPerSample = bits / 8;
  const dataSize = frames * channels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bits, true);
  ascii(36, "data");
  view.setUint32(40, dataSize, true);
  const full = (1 << (bits - 1)) - 1;
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (const channel of audio) {
      const value = Math.round(Math.max(-1, Math.min(1, channel[i] ?? 0)) * full);
      if (bits === 16) view.setInt16(offset, value, true);
      else {
        view.setUint8(offset, value & 0xff);
        view.setUint8(offset + 1, (value >> 8) & 0xff);
        view.setInt8(offset + 2, value >> 16);
      }
      offset += bytesPerSample;
    }
  }
  return new Uint8Array(buffer);
}
