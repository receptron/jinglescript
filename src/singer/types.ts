// The singing-voice instrument's model interfaces (docs/singing-voice-plan.md). The design follows
// wavtechyukky/vocatab (MIT code): an acoustic model (LeapSinger-style) turns phonemes, durations
// and F0 into mel frames, an optional pitch model (PrettyPitch-style) refines F0 and durations, and
// a vocoder (NHVSing-style) turns mel + F0 into PCM. No weights live in this repo; they are
// downloaded into the cache (src/singer/model.ts), and only weights whose licence lets anyone use
// the output freely (MIT / CC0 / CC-BY) are ever listed.

/** One sung note as the singer receives it: seconds, a MIDI pitch and one kana syllable. */
export interface SingerNote {
  start: number;
  end: number;
  midi: number;
  /** One mora of hiragana or katakana, "ー"/"_" to hold the previous vowel, or "" for a rest. */
  lyric: string;
}

/** A phoneme with its frame range in the frame timeline. */
export interface PhonemeSpan {
  phoneme: string;
  /** First frame (inclusive). */
  start: number;
  /** Last frame (exclusive). */
  end: number;
  /** Index of the note it belongs to. */
  note: number;
}

/** What every model step reads: frame-aligned phonemes and F0 (Hz, 0 = unvoiced). */
export interface SingerFrames {
  /** Seconds per frame. */
  hop: number;
  phonemes: PhonemeSpan[];
  f0: Float32Array;
}

export interface PitchModel {
  /** Refines the baseline F0 (vibrato, overshoot, preparation) without changing the frame count. */
  refine(frames: SingerFrames): Promise<Float32Array>;
}

export interface AcousticModel {
  /** Mel spectrogram, frame-major: frames × melBins. */
  mel(frames: SingerFrames): Promise<{ mel: Float32Array; melBins: number }>;
}

export interface Vocoder {
  readonly sampleRate: number;
  synthesize(mel: Float32Array, melBins: number, f0: Float32Array): Promise<Float32Array>;
}

export interface SingerModels {
  acoustic: AcousticModel;
  pitch?: PitchModel;
  vocoder: Vocoder;
}
