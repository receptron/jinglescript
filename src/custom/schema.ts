// Custom instruments, structurally: a score's own instruments, defined as data. Three forms, told
// apart by their key: `base` tweaks a built-in, `layers` stacks several, `blocks` builds one from a
// fixed vocabulary. Nothing in a definition is evaluated. The engine (src/custom/) — not the
// definition — guarantees band-limiting, minimum attack, end fades, DC blocking and level caps.
// Descriptions are written for an LLM reader; out-of-range values are errors, not clamps.
import { z } from "zod";
import { PITCH_PATTERN } from "../pitch.ts";

/** Names of custom instruments: like cue names, so they can never look like a built-in's. */
export const CUSTOM_NAME_PATTERN = /^[a-z]\w*$/;

/** The longest a custom note may last, seconds (ring, release and all). */
export const MAX_NOTE_SECONDS = 10;

const seconds = (min: number, max: number) => z.number().min(min).max(max);

// ---- Tweaks and layers ----------------------------------------------------------------------

export const TweakParamsSchema = z
  .strictObject({
    decay: z
      .number()
      .min(0.25)
      .max(4)
      .optional()
      .describe(
        "How long it rings, as a multiple of the base's ring: 0.5 = half as long (damped), 2 = twice as long. Above 1 only for built-ins that have a block definition (listed by getInstrument).",
      ),
    brightness: z.number().min(-1).max(1).optional().describe("Tone colour: -1 dark and muffled, 0 as is, 1 bright and crisp."),
    attack: seconds(0.001, 0.5).optional().describe("Seconds to fade in at the start: 0.001 keeps the strike; 0.02–0.08 softens it; 0.2+ swells in."),
  })
  .describe("Adjustments to the base sound. Leave out what should stay as it is.");

const LayerFields = {
  base: z.string().describe('A built-in instrument or effect (e.g. "glockenspiel", "impact"), or another custom instrument of this score.'),
  params: TweakParamsSchema.optional(),
  variant: z.string().optional().describe('Always play this variant of the base (for bases with variants, e.g. impact "soft"/"hard").'),
  transpose: z.int().min(-24).max(24).optional().describe("Semitones to shift the pitch (12 = an octave up). Pitched bases only."),
  detune: z.number().min(-100).max(100).optional().describe("Cents to detune by (a slight detune against another layer thickens the sound)."),
  gain: z.number().min(-36).max(12).optional().describe("Level in dB relative to the base (0 = as is, -6 = about half as loud)."),
};

export const LayerSchema = z
  .strictObject({
    ...LayerFields,
    delay: seconds(0, 1)
      .optional()
      .describe(
        "Seconds after the note's onset that this layer starts (an echo, a late sparkle). Default 0. A layer with a length (whoosh, riser) is shortened by its delay, so the stack still ends at the note's `len`.",
      ),
  })
  .describe("One sound in a stack: a base with its own adjustments.");

const DescriptionField = z.string().max(200).optional().describe("One line for people: what this sounds like.");

export const TweakDefinitionSchema = z
  .strictObject({ ...LayerFields, description: DescriptionField })
  .describe('A built-in with adjustments: { "base": "glockenspiel", "params": { "decay": 1.5, "brightness": -0.4 } }.');

export const LayeredDefinitionSchema = z
  .strictObject({
    layers: z
      .array(LayerSchema)
      .min(2)
      .max(6)
      .describe("2–6 sounds played together on every note. On a chord, pitched layers play every pitch; layers without pitch (an impact, a clap) play once."),
    description: DescriptionField,
  })
  .describe(
    'Several sounds played together on every note, e.g. a piano chord with a soft impact under it: { "layers": [ { "base": "piano" }, { "base": "impact", "gain": -8 } ] }.',
  );

// ---- Blocks ---------------------------------------------------------------------------------

export const EnvSchema = z
  .strictObject({
    attack: seconds(0.001, 2).default(0.002).describe("Seconds to rise to full level (0.001–0.005 a strike; 0.05+ a soft swell)."),
    decay: seconds(0.01, 10)
      .default(1)
      .describe("Seconds to fall from full level: to silence (-60 dB) when sustain is 0; otherwise the time to settle to the sustain level."),
    sustain: z
      .number()
      .min(0)
      .max(1)
      .default(0)
      .describe(
        "Level held while the note is held (0–1). 0 = a struck or plucked sound that rings out; above 0 = a sustained sound that holds for the note's `len`.",
      ),
    release: seconds(0.01, 5).default(0.2).describe("Seconds to fade to silence after a held note ends."),
  })
  .describe(
    'Envelope: how the level moves over the note. Struck sounds: { "attack": 0.002, "decay": 1.5 }. Held sounds: { "attack": 0.02, "decay": 0.3, "sustain": 0.7, "release": 0.3 }.',
  );

export const FILTER_TYPES = ["lowpass", "highpass", "bandpass"] as const;

export const FilterSettingsSchema = z
  .strictObject({
    cutoff: z.number().min(20).max(20000).describe("Cutoff (centre for bandpass) in Hz: lowpass 800 is muffled, 4000 soft, 12000 open."),
    q: z.number().min(0.3).max(12).default(0.7).describe("Resonance: 0.7 neutral, 2–6 a peak at the cutoff (squelchy, vocal), up to 12."),
    sweep: z
      .number()
      .min(-6)
      .max(6)
      .default(0)
      .describe("Octaves the cutoff starts away from `cutoff` and glides back over `sweepTime` (4 = starts 4 octaves higher: a bright pluck that closes)."),
    sweepTime: seconds(0.005, 10).default(0.3).describe("Seconds the sweep takes to reach `cutoff`."),
  })
  .describe("A filter.");

const OSC_SHAPES = ["sine", "triangle", "saw", "square", "pulse"] as const;

export const OscBlockSchema = z
  .strictObject({
    osc: z
      .enum(OSC_SHAPES)
      .describe(
        "Waveform: sine (pure, soft), triangle (hollow, flute-like), saw (bright, brassy, buzzy), square (hollow, retro, clarinet-like), pulse (nasal; set `width`).",
      ),
    ratio: z
      .number()
      .min(0.125)
      .max(16)
      .default(1)
      .describe("Frequency as a multiple of the note's (1 = the note, 2 = an octave up, 0.5 = an octave down, 3 = a fifth above the octave)."),
    detune: z.number().min(-100).max(100).default(0).describe("Cents (two saws at -7 and +7 make a thick, chorused sound)."),
    width: z.number().min(0.05).max(0.95).default(0.5).describe("Pulse width for `pulse` (0.5 = square, 0.1 = thin and nasal)."),
    level: z.number().min(0).max(1).default(1).describe("Level 0–1, relative to the other blocks."),
    env: EnvSchema.optional().describe("This oscillator's own envelope; without it the oscillator follows the whole sound's `env`."),
  })
  .describe('An oscillator following the note\'s pitch: { "osc": "saw", "level": 0.6 }. Band-limited by the engine.');

export const ModeSchema = z.strictObject({
  ratio: z
    .number()
    .min(0.25)
    .max(40)
    .describe("Frequency as a multiple of the note's. Bars and bells have inharmonic ratios (marimba 1, 3.93, 9.2; glockenspiel 1, 2.76, 5.4, 8.93)."),
  level: z.number().min(0).max(1).describe("Level 0–1."),
  decay: seconds(0.01, 15).describe(
    "Seconds until this partial has faded to silence (-60 dB); notes are cut (with a fade) at 10 s. Higher partials usually die sooner.",
  ),
});

export const ModesBlockSchema = z
  .strictObject({
    modes: z.array(ModeSchema).min(1).max(32).describe("Damped partials, each ringing out on its own — the model of struck bars, bells, tines and plates."),
    lowRingsLonger: z
      .number()
      .min(0)
      .max(2)
      .default(0)
      .describe("How much longer low notes ring: 0 = the same at every pitch; 1 = twice as long two octaves below middle C (a marimba)."),
  })
  .describe('Struck partials: { "modes": [ { "ratio": 1, "level": 1, "decay": 3 }, { "ratio": 2.76, "level": 0.3, "decay": 0.8 } ] }.');

export const NoiseBlockSchema = z
  .strictObject({
    noise: z.enum(["white", "pink"]).describe("white = hiss, pink = softer, rumblier noise."),
    level: z.number().min(0).max(1).default(1).describe("Level 0–1, relative to the other blocks."),
    burst: seconds(0.0005, 0.2)
      .optional()
      .describe("A short burst of this many seconds at the start, smoothly windowed: a mallet click (0.004), a pick or pin (0.002), a breath (0.05)."),
    decay: seconds(0.005, 10).optional().describe("Seconds for the noise to fade to silence (-60 dB) from the onset, instead of a `burst`."),
    env: EnvSchema.optional().describe("An envelope instead of `burst` or `decay` (for held noise: wind, breath, a hiss)."),
    filter: z
      .strictObject({ type: z.enum(FILTER_TYPES), ...FilterSettingsSchema.shape })
      .optional()
      .describe('Colour the noise: { "type": "bandpass", "cutoff": 2000, "q": 1.5 }.'),
    at: seconds(0, 2).default(0).describe("Seconds after the onset that the noise starts."),
  })
  .describe(
    'Noise for clicks, breath, scrapes, snares and hiss: { "noise": "white", "burst": 0.004, "level": 0.2 }. Give `burst`, `decay` or `env` (default: decay 0.1).',
  );

export const StringBlockSchema = z
  .strictObject({
    string: z
      .strictObject({
        pluck: z
          .number()
          .min(100)
          .max(10000)
          .default(500)
          .describe("Brightness of the pluck in Hz: 500 a soft finger (nylon), 3000 a pick, 8000 a sharp metal twang."),
        position: z
          .number()
          .min(0.05)
          .max(0.5)
          .default(0.3)
          .describe("Where the string is plucked: 0.5 the middle (round), 0.1 near the bridge (thin, twangy)."),
        damping: z.number().min(0).max(0.9).default(0.65).describe("How fast the highs die: 0 rings bright (steel), 0.65 soft (nylon), 0.9 muted."),
        ring: seconds(0.1, 8).default(2).describe("Seconds to fade to silence at middle C; higher notes ring shorter."),
        body: z.number().min(500).max(16000).default(2200).describe("Low-pass on the output in Hz: 2200 mellow, 8000 open."),
      })
      .describe("A plucked string (Karplus–Strong). {} is a soft nylon string."),
    level: z.number().min(0).max(1).default(1).describe("Level 0–1, relative to the other blocks."),
  })
  .describe('A plucked string that follows the note\'s pitch: { "string": { "pluck": 3000, "damping": 0.3, "ring": 3 } }.');

export const EnvBlockSchema = z
  .strictObject({ env: EnvSchema })
  .describe("The envelope of the whole sound (oscillators and strings follow it unless they have their own).");

export const FilterBlockSchema = z
  .strictObject({
    filter: z.enum(FILTER_TYPES).describe("lowpass removes highs (warmer), highpass removes lows (thinner), bandpass keeps a band (telephone, nasal)."),
    ...FilterSettingsSchema.shape,
  })
  .describe('A filter on the whole sound: { "filter": "lowpass", "cutoff": 3000, "q": 0.7, "sweep": 3, "sweepTime": 0.2 }.');

export const PitchEnvBlockSchema = z
  .strictObject({
    pitchEnv: z
      .strictObject({
        from: z.number().min(-48).max(48).describe("Semitones away from the note's pitch at the onset (24 = two octaves above)."),
        to: z.number().min(-48).max(48).default(0).describe("Semitones away from the note's pitch at the end of the glide (0 = lands on the note)."),
        time: seconds(0.001, 10).optional().describe("Seconds the glide takes. Default: the whole note (for effects with a length, its `len`)."),
        curve: z
          .enum(["linear", "exp"])
          .default("exp")
          .describe("exp: fast at first, then settles (kicks, pops, thumps); linear: an even glide in semitones (lasers, sirens, risers)."),
      })
      .describe("A pitch glide at the start of every note."),
  })
  .describe('Pitch sweep: { "pitchEnv": { "from": 24, "to": -12, "time": 0.25, "curve": "linear" } } is a laser.');

export const LfoBlockSchema = z
  .strictObject({
    lfo: z.enum(["vibrato", "tremolo"]).describe("vibrato wobbles the pitch, tremolo the level."),
    rate: z.number().min(0.1).max(40).default(5.5).describe("Wobbles per second (5–6 is natural; 30+ is a buzz)."),
    depth: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe("vibrato: cents up and down (10–30 natural; default 20); tremolo: 0–1, how far the level dips (default 0.25, gentle)."),
    delay: seconds(0, 2).default(0).describe("Seconds before the wobble starts (it fades in over the same time)."),
  })
  .describe('Vibrato or tremolo: { "lfo": "vibrato", "rate": 5.5, "depth": 20, "delay": 0.2 }.');

export const BLOCK_KEYS = ["osc", "modes", "noise", "string", "env", "filter", "pitchEnv", "lfo"] as const;
export type BlockKey = (typeof BLOCK_KEYS)[number];

const BLOCK_SCHEMAS = {
  osc: OscBlockSchema,
  modes: ModesBlockSchema,
  noise: NoiseBlockSchema,
  string: StringBlockSchema,
  env: EnvBlockSchema,
  filter: FilterBlockSchema,
  pitchEnv: PitchEnvBlockSchema,
  lfo: LfoBlockSchema,
} as const satisfies Record<BlockKey, z.ZodType>;

export const BlockSchema = z
  .union([OscBlockSchema, ModesBlockSchema, NoiseBlockSchema, StringBlockSchema, EnvBlockSchema, FilterBlockSchema, PitchEnvBlockSchema, LfoBlockSchema], {
    error: `A block is an object named by one key: ${BLOCK_KEYS.join(", ")} (e.g. { "osc": "sine" }).`,
  })
  .describe(
    `One block, named by its key: ${BLOCK_KEYS.join(", ")}. Sound sources (osc, modes, noise, string) are mixed; env, filter, pitchEnv and lfo shape the whole sound.`,
  );

export const BlocksDefinitionSchema = z
  .strictObject({
    kind: z
      .enum(["instrument", "sfx"])
      .default("instrument")
      .describe('"instrument" plays notes; "sfx" is a sound effect — `pitch` becomes optional (it uses `pitch` below when none is given).'),
    pitch: z
      .string()
      .regex(PITCH_PATTERN)
      .optional()
      .describe('For an "sfx" with pitched blocks: the pitch it plays when a note gives none (e.g. "D7" for a laser). Notes may give any pitch from C1 to C8.'),
    length: seconds(0.02, MAX_NOTE_SECONDS)
      .optional()
      .describe(
        'For an "sfx": the sound lasts `len` (default this many seconds), like whoosh and riser, and may be placed by `end`. pitchEnv and envelopes without times then span the whole length.',
      ),
    blocks: z.array(BlockSchema).min(1).max(16).describe("Sound sources and shapers. At least one source (osc, modes, noise or string)."),
    description: DescriptionField,
  })
  .describe(
    'A sound built from blocks: { "blocks": [ { "osc": "square", "level": 0.6 }, { "pitchEnv": { "from": 24, "to": -12, "time": 0.25 } }, { "env": { "attack": 0.002, "decay": 0.3 } } ] }.',
  );

export const DefinitionSchema = z
  .union([TweakDefinitionSchema, LayeredDefinitionSchema, BlocksDefinitionSchema], {
    error: 'A custom instrument is { "base": "glockenspiel", … } (a tweaked built-in), { "layers": [ … ] } or { "blocks": [ … ] }.',
  })
  .describe('A custom instrument: { "base": … } tweaks a built-in, { "layers": [ … ] } stacks sounds, { "blocks": [ … ] } builds one from blocks.');

export const InstrumentsSchema = z
  .record(
    z
      .string()
      .regex(CUSTOM_NAME_PATTERN, { error: 'Custom instrument names start with a lowercase letter and use only letters, digits and _ (e.g. "softBell").' }),
    DefinitionSchema,
  )
  .describe(
    'Custom instruments and effects, by name, used in tracks like built-ins: { "softBell": { "base": "glockenspiel", "params": { "decay": 1.5, "brightness": -0.4 } } }. Data only: the engine keeps every sound clean and at a balanced level.',
  );

export type TweakParams = z.output<typeof TweakParamsSchema>;
export type Layer = z.output<typeof LayerSchema>;
export type TweakDefinition = z.output<typeof TweakDefinitionSchema>;
export type LayeredDefinition = z.output<typeof LayeredDefinitionSchema>;
export type BlocksDefinition = z.output<typeof BlocksDefinitionSchema>;
export type BlocksDefinitionInput = z.input<typeof BlocksDefinitionSchema>;
export type Definition = z.output<typeof DefinitionSchema>;
export type Block = z.output<typeof BlockSchema>;
export type Env = z.output<typeof EnvSchema>;
export type FilterSettings = z.output<typeof FilterSettingsSchema>;
export type Mode = z.output<typeof ModeSchema>;

/** The key a definition is told apart by, or undefined when it has none of them. */
export function definitionForm(value: unknown): "base" | "layers" | "blocks" | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if ("blocks" in value) return "blocks";
  if ("layers" in value) return "layers";
  if ("base" in value) return "base";
  return undefined;
}

/** The block key an object carries, or undefined. */
export function blockForm(value: unknown): BlockKey | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  return BLOCK_KEYS.find((key) => key in value);
}

/** The schema of one definition form, or one block kind — to re-validate a union branch for precise errors. */
export const DEFINITION_FORM_SCHEMAS = { base: TweakDefinitionSchema, layers: LayeredDefinitionSchema, blocks: BlocksDefinitionSchema } as const;
export { BLOCK_SCHEMAS };
