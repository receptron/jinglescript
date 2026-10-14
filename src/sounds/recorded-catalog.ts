// The recorded sound effects shipped with the package: which CC0 recording each effect variant
// plays. The WAVs live in samples/sfx/ (made by scripts/import-sfx.ts from these sources) and are
// read by loadSamples() from the installed package, never downloaded. A variant with several takes
// plays one of them, chosen by the note's seeded random stream.
import { sampleKey } from "../samples/source.ts";

/** One recording: its file in samples/sfx/ (without .wav) and where it came from. */
export interface RecordedTake {
  file: string;
  /** Path in the CC0 collection (github.com/receptron/mulmocast-media, soundeffects/). */
  source: string;
}

/** Variant name → its takes; the first variant is the default. */
export type RecordedVariants = Readonly<Record<string, readonly [RecordedTake, ...RecordedTake[]]>>;

const take = (file: string, source: string): RecordedTake => ({ file, source });

export const RECORDED_EFFECTS = {
  glass: { clink: [take("glass-clink", "kenney/impact-sounds/impactGlass_medium_001.ogg")] },
  ding: { ding: [take("bell-ding", "kenney/impact-sounds/impactBell_heavy_003.ogg")] },
  metal: { clang: [take("metal-clang", "kenney/impact-sounds/impactMetal_light_003.ogg")] },
  punch: {
    hit: [take("punch-hit", "kenney/impact-sounds/impactPunch_heavy_001.ogg")],
    soft: [take("punch-soft", "kenney/impact-sounds/impactSoft_heavy_001.ogg")],
  },
  book: {
    flip: [take("book-flip", "kenney/rpg-audio/bookFlip2.ogg")],
    place: [take("book-place", "kenney/rpg-audio/bookPlace1.ogg")],
  },
  door: {
    close: [take("door-close-1", "kenney/rpg-audio/doorClose_1.ogg"), take("door-close-2", "kenney/rpg-audio/doorClose_3.ogg")],
    creak: [take("door-creak", "kenney/rpg-audio/creak2.ogg")],
  },
  dice: {
    throw: [take("dice-throw-1", "kenney/casino-audio/dice-throw-1.ogg"), take("dice-throw-2", "kenney/casino-audio/dice-throw-2.ogg")],
    die: [take("die-throw", "kenney/casino-audio/die-throw-3.ogg")],
    shake: [take("dice-shake", "kenney/casino-audio/dice-shake-3.ogg")],
  },
  cards: {
    place: [take("card-place-1", "kenney/casino-audio/card-place-2.ogg"), take("card-place-2", "kenney/casino-audio/card-place-3.ogg")],
    fan: [take("card-fan", "kenney/casino-audio/card-fan-1.ogg")],
  },
  cloth: { rustle: [take("cloth-1", "kenney/rpg-audio/cloth1.ogg"), take("cloth-2", "kenney/rpg-audio/cloth2.ogg")] },
  /** Recorded surfaces for `footsteps`, whose left/right steps are synthesized. */
  footsteps: {
    carpet: [take("footstep-carpet", "kenney/impact-sounds/footstep_carpet_003.ogg")],
    concrete: [take("footstep-concrete", "kenney/impact-sounds/footstep_concrete_001.ogg")],
    snow: [take("footstep-snow", "kenney/impact-sounds/footstep_snow_003.ogg")],
    wood: [take("footstep-wood-1", "kenney/impact-sounds/footstep_wood_001.ogg"), take("footstep-wood-2", "kenney/impact-sounds/footstep_wood_002.ogg")],
  },
} as const satisfies Record<string, RecordedVariants>;

export type RecordedEffectName = keyof typeof RECORDED_EFFECTS;

/** The sample set the recordings are keyed under (SampleSource keys are `sfx/<file>`). */
export const SFX_SET = "sfx";
/** Sample rate the WAVs are stored at (the engine's default, so most renders read them as they are). */
export const SFX_SAMPLE_RATE = 48000;

/** Every take, for the import script and the loader. */
export function allTakes(): RecordedTake[] {
  return Object.values(RECORDED_EFFECTS).flatMap((variants: RecordedVariants) => Object.values(variants).flat());
}

/** Sample key → file name in samples/sfx/, for every recording. */
export const SFX_FILES: ReadonlyMap<string, string> = new Map(allTakes().map((take) => [sampleKey(SFX_SET, take.file), `${take.file}.wav`]));
