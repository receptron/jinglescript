// WAV reader for sample libraries: PCM 16/24-bit or 32-bit float, any channel count, mixed down
// to mono. A file cut short (a ranged download of its first seconds) is read up to where it ends.

export interface WavLayout {
  channels: number;
  sampleRate: number;
  bits: number;
  /** 1 = integer PCM, 3 = IEEE float. */
  encoding: 1 | 3;
  /** Byte offset of the first sample. */
  dataOffset: number;
  /** Bytes of sample data the header declares (the file may hold fewer). */
  dataBytes: number;
}

const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

function ascii(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

function encodingOf(tag: number, bits: number, view: DataView, fmtOffset: number, fmtSize: number): 1 | 3 {
  // WAVE_FORMAT_EXTENSIBLE keeps the real tag in the first two bytes of its sub-format GUID.
  const real = tag === WAVE_FORMAT_EXTENSIBLE && fmtSize >= 26 ? view.getUint16(fmtOffset + 24, true) : tag;
  if (real === 1 && (bits === 16 || bits === 24)) return 1;
  if (real === 3 && bits === 32) return 3;
  throw new Error(`unsupported WAV encoding (format ${real}, ${bits}-bit): expected 16/24-bit PCM or 32-bit float`);
}

/** Where the samples are and how they are stored. Throws when the bytes are not a WAV file it can read. */
export function readWavLayout(bytes: Uint8Array): WavLayout {
  if (bytes.length < 12 || ascii(bytes, 0) !== "RIFF" || ascii(bytes, 8) !== "WAVE") throw new Error("not a RIFF/WAVE file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format: Omit<WavLayout, "dataOffset" | "dataBytes"> | undefined;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = ascii(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt " && offset + 24 <= bytes.length) {
      const bits = view.getUint16(offset + 22, true);
      format = {
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bits,
        encoding: encodingOf(view.getUint16(offset + 8, true), bits, view, offset + 8, size),
      };
    }
    if (id === "data") {
      if (format === undefined) throw new Error("WAV data chunk before its fmt chunk");
      return { ...format, dataOffset: offset + 8, dataBytes: size };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("WAV file has no data chunk");
}

function sampleAt(view: DataView, offset: number, layout: WavLayout): number {
  if (layout.encoding === 3) return view.getFloat32(offset, true);
  if (layout.bits === 16) return view.getInt16(offset, true) / 32768;
  return (view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getInt8(offset + 2) << 16)) / 8388608;
}

/** The first `maxSeconds` (all, when absent) of a WAV file, mixed down to mono. */
export function decodeWavMono(bytes: Uint8Array, maxSeconds?: number): { sampleRate: number; data: Float32Array } {
  const layout = readWavLayout(bytes);
  const frameBytes = (layout.bits / 8) * layout.channels;
  const available = Math.floor(Math.min(layout.dataBytes, bytes.length - layout.dataOffset) / frameBytes);
  const frames = maxSeconds === undefined ? available : Math.min(available, Math.round(maxSeconds * layout.sampleRate));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const data = new Float32Array(Math.max(0, frames));
  const sampleBytes = layout.bits / 8;
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < layout.channels; c++) sum += sampleAt(view, layout.dataOffset + i * frameBytes + c * sampleBytes, layout);
    data[i] = sum / layout.channels;
  }
  return { sampleRate: layout.sampleRate, data };
}
