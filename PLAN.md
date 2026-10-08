# JingleScript — Plan

This file is the complete brief for building JingleScript. Read it top to bottom before writing
code; everything you need is here or in `reference/prototype/`. When something is genuinely
undecided it is listed under [Open questions](#open-questions) — ask the user about those
instead of guessing.

## What it is

JingleScript is a **script language for jingles that an LLM writes**, and a renderer for it. The
purpose is **animation that is in sync with its jingle**: a request like "the mascot hops in on
three beats and lands on a big hit at 1.5 s" becomes one score, the score becomes audio, and the
same score's **cues** tell the animation exactly when every hop, hit and voice-over happens.

The script language is the product. The renderer exists to play it faithfully; the format is
what has to be right — small, unambiguous, validated, and easy for an LLM to write correctly on
the first try.

```
request ──► LLM ──► score (JSON) ──► render ──► audio (WAV / MP3)
                                           └──► timing.json (cues, beats, note onsets)
                                                    └──► animation (outside this repo, for now)
```

- **Jingles, stings, intros, outros, transitions** — roughly 1 to 15 seconds. Not songs.
- **Music and sound effects in one score.** Besides instruments, a score can place sound effects
  — a clock's tick-tock, footsteps, tap dancing, a pistol shot, a laser — on the same timeline and
  cues, so a jingle with sound effects, and an animation synced to both, come from one script.
- **No samples, no API, no model.** Every instrument is synthesized from a small physical or
  additive model in code, so the output is free of third-party licences and needs no network.
- **Deterministic.** The same score and seed produce bit-identical audio on every machine.
- **Timing is a first-class output.** The point of a jingle in a video is that pictures land on
  the music. Because JingleScript wrote every note, it knows exactly when each beat, note and
  named hit happens, and it writes that down for the animation to use. This is the feature no
  generated-music service gives you.

### Who it is for

**Everyone making video for YouTube, Instagram and TikTok** — channel intros and outros, logo
stings, transitions, reveals, a punchline hit, a short-form hook in the first second, a product
shot landing on a beat. Their styles range from cute and cartoon to clean tech/corporate, vlog,
lo-fi, gaming/chiptune, comedy and punchy cinematic, so neither the format, the instrument and
effect set, nor the examples may assume one style. Most of these creators will not write a score
themselves: they ask an LLM (or a tool built on JingleScript) in a sentence, in their own
language.

What they get must be usable as-is: loud enough for the platforms, clean on phone speakers and
earbuds, and theirs to use in monetized videos with no licence or attribution (nothing
third-party goes into the sound).

「ハテナマルモ」 (below) is the first real use and the source of the prototype, not the audience.

### Where it comes from

It was prototyped in Python while making the opening of 「ハテナマルモ」, a children's educational
YouTube channel (2D avatars made with AvatarScript, a mascot called マルモ/Mulmo). A 5-second
opening jingle had to be in sync with a mascot that hops in on the beats and lands on the final
hit (1.50 s). The prototype synthesized a marimba from bar modes, then ten more instruments, and
the user — who produced the channel and listens critically — called the results 「とても良い感じ」
(very good) for the marimba and the second batch of instruments. The prototype code is in
`reference/prototype/` (see [Reference prototype](#reference-prototype)); port its sound, not its
structure.

### Sister projects

- **AvatarScript** (`../avatarscript`, github.com/receptron/avatarscript) — an avatar + text →
  lip-synced video, a TypeScript library + CLI. **Copy its project setup and conventions**
  (see [Project setup](#project-setup)). JingleScript is meant to sit next to it.
- **MulmoCast** (`../mulmo`, github.com/receptron/mulmocast-cli) — turns a script into
  presentations/videos. The intended host for JingleScript audio (opening jingles, transitions)
  later; see [Milestone 7](#m7--mulmocast-integration-later).

## Goals

1. **An LLM writes a valid, good score on the first try** from a one-line request ("a bouncy
   5-second marimba opening that ends on a big hit at 1.5 s"), because the format is small,
   validated, documented with examples, and lets it state times in seconds instead of doing
   beat arithmetic. This is measured, not assumed (see [LLM authoring](#llm-authoring-and-evaluation)).
2. **Animation sync is designed in.** Named cues — with or without a note on them — are the
   shared vocabulary between the score and the animation; the timing map reports them exactly.
3. When a score is wrong, the error tells an LLM where, why, and how to fix it, so a
   generate → check → repair loop converges.
4. **Chords and ensembles are basic, not extras.** Any note can be a chord, notes ring over each
   other, and a score mixes any number of tracks of any instruments (the same instrument may
   appear in several tracks, e.g. a marimba melody and a marimba bass).
5. **A score can define its own instruments and effects**, by tweaking a built-in or building
   one from a small set of synthesis blocks — declaratively, so it stays deterministic, safe and
   clean (see [Custom instruments](#custom-instruments)).
6. **Sound effects are first-class.** Effects and instruments share tracks, cues, mixing and the
   timing map; an animation can sync to a footstep or a laser shot exactly as to a note.
7. The score is readable and editable by a person.
8. Each instrument and effect sounds good on its own and in a mix, at publishable quality for
   social video across the styles above — the bar is the prototype's marimba.
9. Exact, reproducible timing; the timing map lets video tools sync without audio analysis.
10. A Node library first, a thin CLI second (same reasons as AvatarScript: MulmoCast will import it).
11. The score and timing map can later be embedded in a larger jingle + animation document
    without changing shape (see [Toward a jingle + animation tool](#toward-a-jingle--animation-tool)).

## Non-goals (v1)

- Vocals or lyrics. (Words go over the jingle as speech from a TTS, not inside it.)
- Long-form music, arrangement generation, or "make me a song" from a mood alone — the LLM writes
  the notes; JingleScript plays them.
- Sampled/realistic orchestral instruments. Sustained acoustic instruments (violin, flute,
  trumpet, voice) cannot be made convincing by small synthesis models. v1 offers synthetic
  versions and says so; real samples are an optional later milestone ([M5](#m5--sampled-instruments-optional)).
- Real-time playback, MIDI input devices, a GUI.
- Recorded Foley. Sound effects are synthesized like the instruments, in styles from cartoon to
  clean/modern; where a style matters an effect offers it as a `variant`. Effects that cannot be
  made convincing by synthesis are labelled synthetic, like piccolo and trumpet; recorded effects
  could only come through an optional sample milestone like M5, and never into the repo.
- Rendering the animation. v1 produces the cues and timing map the animation is built on; the
  animation itself is a later step ([M8](#m8--jingle--animation-tool-later)).

## Score format (`jinglescript/1`)

JSON validated with zod. This format is the core of the project: every choice below is judged by
whether an LLM writes it correctly on the first try and whether the animation can rely on it.

Two kinds of time live in a score, because two kinds of requirement arrive:

- **Musical time in beats** (quarter notes at `tempo`) — rhythm is how people and LLMs think
  about notes ("on the eighths", "two beats later").
- **Clock time in seconds** — the animation's requirements ("lands at 1.5 s", "voice starts at
  1.8 s"). An LLM must never have to convert these to beats; beat arithmetic at an arbitrary
  tempo is exactly the kind of step it gets wrong.

**Cues** join the two. A cue is a named moment, given in seconds or beats, that notes can be
placed on and that the animation refers to by name. A cue does not need a note: `voice` below
marks where the voice-over starts and plays nothing.

```json
{
  "format": "jinglescript/1",
  "title": "ハテナマルモ opening (A)",
  "tempo": 130,
  "length": { "seconds": 4.6 },
  "seed": 1,
  "master": { "reverb": "room", "loudness": -14, "fadeOut": 0.4 },
  "cues": {
    "hit":   { "seconds": 1.5 },
    "voice": { "seconds": 1.8 }
  },
  "tracks": [
    {
      "instrument": "marimba",
      "pan": 0.5,
      "gain": 0,
      "notes": [
        { "at": 0,                   "pitch": "G4", "vel": 0.8 },
        { "at": 0.5,                 "pitch": "C5", "vel": 0.85 },
        { "at": 1,                   "pitch": ["E5", "G5"], "vel": 0.9 },
        { "at": { "seconds": 0.863 }, "pitch": "D5", "vel": 0.8 },
        { "at": { "seconds": 1.023 }, "pitch": "B4", "vel": 0.75 },
        { "at": "hit",               "pitch": ["C5", "E5", "G5", "C6"], "vel": 1.0 },
        { "at": "hit",               "pitch": ["C3", "G3"], "vel": 0.9 },
        { "at": "hit+1",             "pitch": "C6", "vel": 0.35 }
      ]
    },
    { "instrument": "clap", "notes": [{ "at": 0 }, { "at": 1 }, { "at": "hit" }] }
  ]
}
```

Rules (make the schema enforce them and give errors an LLM can act on — see
[LLM authoring](#llm-authoring-and-evaluation)):

- `tempo` in BPM; one beat = one quarter note. The beat grid starts at 0 s.
- `cues`: an object of name → `{ "seconds": n }` or `{ "beats": n }`. Names match
  `^[a-z][A-Za-z0-9_]*$` (no `+`/`-`, so offsets below stay unambiguous). Cues in seconds do not
  have to fall on the beat grid; that is the point of them.
- `at` is one of: a number of **beats**; `{ "seconds": n }`; a cue name (`"hit"`); or a cue name
  with an offset in **beats** (`"hit+1"`, `"hit-0.25"`). Referencing an undefined cue is an error
  that lists the defined ones.
- `pitch`: scientific notation (`C4` = middle C, `F#3`, `Bb5`), or an array for a chord. Unpitched
  instruments (clap, shaker, kick…) take no pitch; giving one is an error.
- Every track is polyphonic: a chord's notes, and notes at the same or overlapping times, all
  sound and ring out independently (no voice stealing, no limit on simultaneous notes). Two notes
  at the same time and pitch on one track simply add.
- `tracks` is a list of any length; each has its own `instrument`, `gain` and `pan`, and the same
  instrument may be used by several tracks.
- `len` (beats) is optional; plucked/struck instruments ignore it (they ring out), sustained
  instruments (organ, piccolo, trumpet…) need it — default: until the same track's next onset,
  minus a small gap (the prototype used 92 %), and the last note holds ~1.6 s.
- `vel` 0–1 (default 0.8). `gain` per track in dB. `pan` 0 (left) … 1 (right), default 0.5, per
  track and optionally per note (the prototype panned individual notes).
- `length`: `{ "seconds": n }` or `{ "beats": n }`. Notes or cues after the end are an error;
  tails are cut by `fadeOut`.
- **Sound effects** go in tracks like instruments (`"instrument": "footsteps"`). Each declares
  in its descriptor whether it takes `pitch` (none, optional or required) and which `variant`s
  it has; a note may set `variant` (`"tick"`/`"tock"`, `"left"`/`"right"`, `"heel"`/`"toe"`…).
  `len` sets the length of effects that have one (a laser's sweep, a whoosh, a riser). Those
  effects may give `"end"` (any `at` form) instead of `"at"`, so a riser can finish exactly on a
  cue: `{ "end": "hit", "len": 4 }`.
- **Repeats** — clocks tick and feet walk, and an LLM should not write twelve notes for that.
  A note may carry `"repeat": { "every": <beats>, "count": n }` or
  `"repeat": { "every": <beats>, "until": <at> }`; `variant` may be a list that cycles over the
  repeats (`["left", "right"]`). Every repetition is expanded before rendering and appears in the
  timing map as its own note, so the animation can put a foot down on each step.
- Optional per-note `detune` (cents) and `humanize` (ms, seeded) — small, opt-in. `humanize`
  never moves a note that sits on a cue; the cue time is a promise to the animation.
- `seed` makes every random component (mallet click noise, reverb tail, humanize) reproducible.
- `instruments` (optional, top level): name → custom instrument or effect definition (see
  [Custom instruments](#custom-instruments)). Tracks use these names exactly like built-in ones.
  A custom name that shadows a built-in is an error.
- Unknown instruments and unknown fields are errors (zod `strictObject`); the error lists the
  built-in and custom names that exist.
- The score is self-contained and has no top-level assumptions about where it lives, so it can
  be embedded unchanged as one field of a larger document later.

All conversions between beats, cues and seconds happen in one module that everything imports.

**All type validation is zod** (v4, the only runtime dependency). The zod schemas are the single
source of truth: the TypeScript types are `z.infer` of them, and the JSON Schema is generated
from them with zod's own `z.toJSONSchema` (no second converter, no hand-written schema). Write it
to `schema/jinglescript-1.json` so other tools and LLM prompts can include it, and serve it from
the API (see [API for LLMs](#api-for-llms)); a test fails if the committed file is stale. Field descriptions in the zod schema (`.describe()`) are
written for an LLM reader: they appear in the JSON Schema and are part of the prompt.

**No text notation in v1.** A compact `.jgs` form (`marimba: G4/8 C5/8 [E5 G5]/4 …`) is
attractive for people, but since the primary author is an LLM, JSON validated against a published
schema is the safer target. Decided 2026-10-08; revisit only if the user asks.

## Timing map (`timing.json`)

Written next to the audio on every render. This is the **public contract with the animation**:
its shape is versioned (`jinglescript-timing/1`) and changing it is a breaking change. Times in
seconds, rounded to 1 ms, computed from the score — never from analysing the audio:

```json
{
  "format": "jinglescript-timing/1",
  "tempo": 130,
  "duration": 4.6,
  "cues": { "hit": 1.5, "voice": 1.8 },
  "beats": [0, 0.4615, 0.923, …],
  "notes": [
    { "t": 0, "track": 0, "instrument": "marimba", "pitch": "G4", "vel": 0.8 },
    { "t": 1.5, "track": 0, "instrument": "marimba", "pitch": ["C5", "E5", "G5", "C6"], "vel": 1, "cue": "hit" },
    …
  ],
  "audibleUntil": 4.25
}
```

- `cues` lists every cue in the score, including ones with no note on them.
- Effects with a duration also carry `"end"` (seconds), so the animation can follow a whoosh or
  a riser over its whole length.
- A note placed on a cue (`"hit"`, not `"hit+1"`) carries `"cue"`, so the animation can find the
  notes that belong to a moment.
- `audibleUntil` is when the rendered audio falls below −40 dBFS for good (measured on the output).

This is what video tools need: where to land, what happens on each cue, where the tail ends.

## LLM authoring and evaluation

The format is only as good as an LLM's first attempt at it, so this is measured from M1 on, not
left to the end.

- **Error messages are written for repair.** Each says where (JSON path, e.g.
  `tracks[0].notes[3].at`), what is wrong, and what is allowed (`unknown cue "hti"; defined cues:
  hit, voice`). A `jinglescript check <score>` command prints them, and `--json` prints them
  machine-readably for an agent loop.
- **`check` also reports what was meant**, without failing: each cue's time in seconds and its
  nearest beat, and notes that fall within a few ms of a cue but are not placed on it (likely
  intended to be).
- **An evaluation set** lives in `eval/`: about twenty one-line requests, written the way
  creators actually ask, in English and Japanese, spread across styles and platforms — a cute
  channel opening with a hit, a tech-review intro (synth pluck, riser into an impact on the logo),
  a vlog outro (lo-fi electric piano), a gaming intro (chiptune), a corporate logo sting, a
  TikTok transition (whoosh on the cut), a 1-second short-form hook, a comedy punchline sting,
  a three-hop entrance, a voice-over gap, a chord progression, two to four instruments together,
  and requests with sound effects — "a clock ticks for 2 s, then a chime on the hit", "footsteps
  walk in on the beat and stop on the hit", "a laser zaps on each of three cues", and requests
  that need a custom sound — "a softer, longer bell than the glockenspiel", "a deep retro zap",
  "layer a piano chord with a boom on the hit". An eval script gives a subagent only the README's authoring section
  and the JSON Schema — obtained through `getAuthoringGuide()` and `getSchema()`, the same API an
  outside LLM uses — asks for a score, and checks mechanically:
  1. it validates on the first try (and, if not, after one repair round using `check` output);
  2. the requested cues exist and are at the requested seconds;
  3. it renders cleanly (the quality checks under Instruments) and its loudness is on target.
  The score files the subagent wrote and the results table are kept in `out/eval/` (git-ignored);
  the pass rate is recorded in Progress whenever the format changes.
- Format changes are judged by this pass rate. A change that makes the format nicer for people
  but lowers first-try validity for LLMs needs the user's approval.

## Toward a jingle + animation tool

Later, JingleScript may grow into a tool that writes the jingle **and** the animation synced to
it from one request (with AvatarScript's characters, for example). Nothing in v1 builds that, but
v1 must not block it:

- Cues are the shared vocabulary. An animation format would say `"on": "hit"` rather than a time,
  and read the time from `timing.json`.
- The score and timing map embed unchanged in a larger document, e.g.
  `{ "jingle": <jinglescript/1 score>, "animation": { … } }` — so neither may grow top-level
  fields that assume they are the whole file.
- One LLM request can then produce cues first, then the music on them, then the animation on them.

The design of that tool is out of scope until the user asks for it ([M8](#m8--jingle--animation-tool-later)).

## Instruments

Each instrument is a pure function `(note, velocity, holdSeconds, rng) → Float32Array` plus a
small descriptor (name, pitched or not, sustained or not, sensible range, default pan/gain). Keep
them in `src/instruments/<name>.ts`, one file each, registered in a `Record<InstrumentName, …>`
table so adding a name without an implementation is a type error.

| Instrument | Model (from the prototype) | Prototype quality |
|---|---|---|
| `marimba` | Bar modes at 1×, 3.93×, 9.2× with decays ~0.42 s / 0.09 s / 0.035 s (longer for low notes), 6 ms lowpassed mallet click, 1.5 ms attack | **User approved** — the reference sound |
| `xylophone` | Modes 1×, 3.0×, 6.1×; shorter decays; harder click | Good |
| `glockenspiel` | Free-bar modes 1×, 2.76×, 5.40×, 8.93×; long decay | Good |
| `vibraphone` | Modes 1×, 4×, 10×; long decay; 5.5 Hz amplitude tremolo | Good |
| `musicbox` | Octave up; modes 1×, 5.4×, 13.1×; 2.5 ms pluck tick | Good (improved version in `instruments2.py`) |
| `piano` | Inharmonic partials `k·f·√(1+B·k²)` (B≈0.0004), three detuned strings per note, two-stage decay, hammer noise | Good |
| `organ` | Drawbar additive (16′ 8′ 4′ 2⅔′ 2′ 1⅓′), 6.2 Hz wobble, key click, ADSR with hold | Good |
| `ukulele` | Prototype: Karplus–Strong (loss 0.996), raw-noise pluck; heard as a koto. Rebuilt soft: low-passed, pluck-position-combed excitation, damping in the loop (delay compensated), decay time per note, output low-pass; the user picked the softest of three candidates | Rebuilt |
| `piccolo` | Octave up, sine + weak 2nd/3rd harmonics, breath noise, delayed 5.5 Hz vibrato, ADSR | **Synthetic-sounding** — label it so |
| `trumpet` | Harmonics 1…13 with brightness rising with the envelope, lip "scoop" into pitch, delayed vibrato | **Synthetic-sounding** — label it so |
| `clap` | Prototype: four bursts of near-white noise; the user found it not good. Rebuilt as band-limited noise (~1–2 kHz) with variants `studio` (default, the user's pick), `snappy`, `hands`, `group` | Rebuilt |

Add, with similar small models (not prototyped yet — tune by ear-equivalent checks below), so
the palette covers the styles creators use, not only the prototype's acoustic one:

- Acoustic/cute: `kalimba`, `celesta`, `bell`/`tubular-bell`, `triangle`, `shaker`, `toy-snare`.
- Modern/electronic (tech, vlog, lo-fi, cinematic): `synth-pluck`, `synth-bass`, `sub-808`,
  `pad`, `synth-lead`, `electric-piano`.
- Drums: `kick`, `snare`, `hihat` (closed/open as variants), `clap` (above).
- Retro/gaming: `chiptune-square`, `chiptune-pulse`, `chiptune-noise`.
 Keep v1's list honest: an instrument ships only when it
renders cleanly (no clicks, aliasing or DC) across its stated range.

### Sound effects

Same interface and registry as instruments (one file each under `src/sounds/`, same
`Record<…>` table, descriptor with `kind: "sfx"`), synthesized, seeded, never sampled. None is
prototyped yet; the models below are starting points. The first five are what the user asked
for; the transition effects after them are the staples of YouTube/TikTok editing.

| Effect | Variants | Model (starting point) |
|---|---|---|
| `clock` | `tick`, `tock` | Very short resonant click (band-passed noise burst + two damped modes ~2–4 kHz); `tock` lower and slightly softer |
| `footsteps` | `left`, `right`; surface later | Low thump (damped ~80–120 Hz) + short filtered noise scuff; small seeded variation per step so repeats don't sound identical |
| `tapdance` | `toe`, `heel`, `shuffle` | Bright metallic tap: inharmonic damped modes ~3–7 kHz + click; `heel` lower; `shuffle` is two taps ~40 ms apart |
| `pistol` | `shot`, `cartoon` | `shot`: sharp noise crack (< 2 ms attack) + low "boom" sine drop + short seeded room tail; `cartoon`: lighter "pop" |
| `laser` | — (`pitch` optional = start pitch; `len` = sweep length) | "Pew": band-limited square/saw with fast exponential downward pitch sweep, slight FM |
| `whoosh` | `soft`, `fast`; `len` = duration | Band-passed noise with a swept centre frequency and a rise-fall envelope; optional stereo pan sweep |
| `riser` | `noise`, `tone`; `len` = duration, ends on its `at` + `len` | Noise and/or detuned saws rising in pitch and level into a hit — usually ends on a cue |
| `impact` | `soft`, `hard` | Low sine drop + noise burst + short tail; the "boom" a reveal lands on |
| `pop` | — | Very short resonant pitch-drop blip (bubbles, items appearing, text pop-ins) |

Candidates if the evaluation shows a need (ask the user before adding): `boing`, `alarm`,
`notification`, `glitch`, `record-scratch`, `camera-shutter`, `typing`.

A `riser` is the one effect whose important moment is its **end**: `"at"` is its start, and an
LLM will usually want it to finish on a cue. Allow `"end": "<at>"` instead of `at` + `len` on
effects with a duration, so "a riser into the hit" is written as `{ "end": "hit", "len": 4 }`.

For effects the timing map's `t` is the **perceptual onset** (the start of the transient), so an
animation frame on `t` lines up with the sound; an effect must not have silent pre-roll before it.
Effects pass the same quality checks as instruments (variants and pitch range included); the laser
sweep must stay alias-free across its range.

### Custom instruments

A score may define its own instruments and effects in a top-level `instruments` object. There
are two ways, and both are **data, not code** — no JavaScript, no expressions, nothing evaluated —
so a score from an LLM or a stranger is safe to render, stays deterministic, and validates with
zod like everything else.

**1. Tweak a built-in.** Each built-in exposes a few named, ranged parameters in its descriptor
(e.g. marimba: `decay`, `brightness`, `mallet` hardness; laser: `sweep`, `bite`). A custom
instrument picks a base, overrides some, and may layer several:

```json
"instruments": {
  "softBell":  { "base": "glockenspiel", "params": { "decay": 1.6, "brightness": 0.35 } },
  "bigHit":    { "layers": [
                   { "base": "piano", "gain": 0 },
                   { "base": "impact", "variant": "soft", "gain": -8 },
                   { "base": "glockenspiel", "transpose": 12, "gain": -12 } ] }
}
```

**2. Build one from blocks.** A small, fixed vocabulary — enough for bells, plucks, pads, leads,
basses, drums and most effects, small enough to describe in the schema:

| Block | What it does |
|---|---|
| `osc` | Band-limited `sine`/`triangle`/`saw`/`square`/`pulse` at a frequency `ratio` (and `detune`, `level`) |
| `modes` | A list of `{ ratio, level, decay }` damped partials — the bar/bell model the marimba uses |
| `noise` | White/pink seeded noise, with its own filter and envelope (clicks, breath, scuffs, cracks) |
| `string` | Karplus–Strong pluck (`loss`, `brightness`) |
| `env` | ADSR (or attack-decay for struck sounds) applied to the sum or one block |
| `filter` | `lowpass`/`highpass`/`bandpass` with cutoff, resonance and an optional envelope amount |
| `pitchEnv` | Pitch sweep in semitones over time (lasers, kicks, pops, risers) |
| `lfo` | Vibrato or tremolo (`rate`, `depth`, `delay`) |

```json
"zap": { "kind": "sfx", "blocks": [
  { "osc": "square", "level": 0.6 },
  { "pitchEnv": { "from": 24, "to": -12, "time": 0.25 } },
  { "filter": "lowpass", "cutoff": 6000 },
  { "env": { "attack": 0.002, "decay": 0.25 } }
] }
```

Rules:

- **Clean by construction.** The engine, not the definition, guarantees what the quality checks
  test: oscillators are band-limited and partials above Nyquist/2.2 are dropped, attack is at
  least 1 ms, every note ends in a fade, output is DC-blocked, levels are capped. A valid custom
  instrument can sound bad, but it cannot click, alias, blow up or go silent-with-NaN.
- Every parameter has a range in the zod schema, with a `.describe()` that tells an LLM what it
  does audibly ("decay: seconds until the note is 60 dB quieter; marimba ≈ 0.4, bell ≈ 2").
  Out-of-range values are errors, not clamps, so the LLM learns.
- The descriptor fields (pitched, sustained, range, variants, `kind: "instrument" | "sfx"`) are
  declared or derived (a definition with no pitch-following block is unpitched).
- **Built-ins are written in the same vocabulary where their model fits** (marimba, xylophone,
  glockenspiel, vibraphone, music box, organ, clap, most effects); the rest (piano, ukulele,
  trumpet…) stay code with exposed parameters. That keeps the vocabulary honest — if the marimba
  can't be expressed, a block is missing — and lets `jinglescript instruments marimba --json`
  print a definition an LLM can copy and change. Ported built-ins must still match the
  prototype within a few percent (M1/M2 criteria).
- Definitions live inside the score, so a score stays self-contained and portable. Sharing a set
  of definitions across scores (an "instrument kit" file) is not v1; see Open questions.

**Quality checks you can do without ears** (the user listens; you cannot): no NaN/Inf; peak
≤ −1 dBFS after master; no DC offset (> 0.5 %); no energy above sampleRate/2.2 in additive partials
(drop partials that would alias); no clicks at note starts (attack ≥ 1 ms) or at the end (fade);
each onset on the sample `round(t × sampleRate)` of its exact time, and the timing map (rounded to
1 ms) within 0.5 ms of it; spectral centroid within an expected
band per instrument (catches a broken model). Render every instrument across its range in a test
"scale" file and keep the WAVs out of git (generate them in `out/`).

## Master chain

Sum tracks (constant-power pan) → per-track gain → small room reverb (the prototype convolves with
seeded exponentially decaying noise, ~0.18–0.25 s decay, 1.2–1.4 % wet; provide `none`, `room`,
`hall`; effects can opt out of the reverb per track with `"reverb": false`) → fade-out → loudness. Loudness: v1 normalises integrated loudness to `master.loudness`
LUFS (default −14, the level YouTube normalises to and a common target for Instagram and
TikTok, so a jingle is neither turned down nor left quiet next to the rest of the video) with a
true-peak ceiling of −1.5 dBTP (headroom for the platforms' lossy re-encoding). A pistol shot or tap is far peakier
than the music; a short look-ahead peak limiter (deterministic) before normalisation keeps one
transient from pulling the whole mix down. Implement ITU-R BS.1770 (K-weighting +
gating) in TypeScript rather than shelling out to ffmpeg, so the library has no runtime binary
dependency for WAV; use ffmpeg only for MP3/OGG encoding (optional, detected at runtime, with a
clear error if missing).

## Library and CLI

```ts
import { parseScore, render, toWav } from "jinglescript";

const score = parseScore(json);                 // zod-validated, repair-oriented errors
const { audio, sampleRate, timing } = render(score);   // audio: [Float32Array, Float32Array]
await writeFile("out/jingle.wav", toWav(audio, sampleRate));
await writeFile("out/jingle.timing.json", JSON.stringify(timing, null, 2));
```

```sh
npx jinglescript render examples/hatena-marumo-a.json -o out/opening.wav [--mp3] [--seed 1]
#   writes out/opening.wav (or .mp3) and out/opening.timing.json
npx jinglescript check score.json [--json]   # validate; print errors and resolved cue times
npx jinglescript instruments          # list instruments and sound effects: ranges, variants, parameters
npx jinglescript instruments marimba --json   # a built-in's definition, to copy into a score's `instruments`
npx jinglescript schema [part]        # print the JSON Schema (for LLM prompts)
npx jinglescript guide                # print the authoring guide for LLMs
npx jinglescript mcp [--out <dir>]    # MCP server over stdio (see below)
npx jinglescript demo marimba -o out/ # render the instrument across its range (or an effect's variants)
```

48 kHz stereo by default (`--rate 44100` allowed). The CLI is a thin wrapper over the library.

### API for LLMs

An LLM (or an agent built on one) needs to learn the format, see what sounds exist, and check its
work, without a human pasting docs. The library exports a small set of functions for that, each
returning plain JSON, and every one has a CLI twin so a shell-using agent gets the same thing:

```ts
import { getSchema, getAuthoringGuide, listInstruments, getInstrument, checkScore } from "jinglescript";

getSchema();                        // JSON Schema of the whole score (jinglescript/1), from zod
getSchema("instrument");            // just one part: "score" | "note" | "cue" | "instrument" | "timing"
getAuthoringGuide();                // the README's "how to write a jingle" section as Markdown
listInstruments();                  // [{ name, kind, pitched, sustained, range, variants, params, synthetic }]
getInstrument("marimba");           // descriptor + definition (for copying into `instruments`)
checkScore(json);                   // { ok, errors: [{ path, message, hint }], cues: { name: seconds }, notes }
```

| Library | CLI |
|---|---|
| `getSchema(part?)` | `jinglescript schema [part]` |
| `getAuthoringGuide()` | `jinglescript guide` |
| `listInstruments()` / `getInstrument(name)` | `jinglescript instruments [name] --json` |
| `checkScore(json)` | `jinglescript check <file> --json` |

- `getSchema` returns the same JSON Schema as `schema/jinglescript-1.json`, generated from the same
  zod schemas — never a copy. Its `description`s are the LLM-oriented `.describe()` texts.
- The schema lists every built-in instrument and effect name with a one-line description, so an
  LLM that reads only the schema still knows what it can use.
- `getSchema("timing")` returns the timing map's schema, so the animation side (or the LLM writing
  it) knows the contract too.
- `checkScore` never throws on bad input; it returns the errors. `parseScore` is the throwing
  variant for code.
- These functions are the stable LLM-facing surface: the eval harness uses only them (plus
  `render`), which is how we know they are enough.

### MCP server (v1)

`jinglescript mcp` starts an MCP server over stdio, so a chat assistant (Claude Desktop, Claude
Code, any MCP client) can learn the format, write a score, check it and render it directly. It
exposes **one tool, `manageJingleScript`**, whose `action` parameter says what to do — one entry
point keeps the client's tool list small and the loop obvious. Each action calls one library
function; the input is a zod discriminated union on `action` (no second definition):

| `action` | Other parameters | Wraps | Returns |
|---|---|---|---|
| `getSchema` | `part?` | `getSchema` | JSON Schema |
| `getGuide` | — | `getAuthoringGuide` | Markdown |
| `listInstruments` | — | `listInstruments` | JSON |
| `getInstrument` | `name` | `getInstrument` | JSON |
| `checkScore` | `score` | `checkScore` | errors with paths and hints, resolved cue times |
| `renderScore` | `score`, `name?`, `format?` | `render` + writers | paths of the audio and timing files, the timing map, measured loudness and `audibleUntil` |

- `renderScore` writes only inside an output directory fixed when the server starts
  (`--out <dir>`, default `./out/jinglescript`); `name` is a file stem, never a path. The score
  itself is passed as JSON, never as a file path, so the server reads no files.
- The tool description and the server's instructions give the intended loop: `getGuide` →
  `getSchema` → write → `checkScore` → repair → `renderScore`. An unknown `action` returns the
  list of actions.
- Uses the official `@modelcontextprotocol/sdk` — the one runtime dependency besides zod,
  accepted because the protocol is versioned and the SDK tracks it. Loaded only by the `mcp`
  command, so `import "jinglescript"` does not pull it in.
- Tested in-process with the SDK's in-memory transport (no subprocess, no network): list tools,
  call every action, render a score and check the files.

## Examples (ship these)

Port the prototype's jingles exactly (same notes, same timing) so the user can compare. Each one
defines `hit` as a cue at `{ "seconds": 1.5 }` and `voice` at `{ "seconds": 1.8 }`; notes the
prototype placed off the eighth-note grid (A's D5 at 0.863 s and B4 at 1.023 s, B's B5, C's G5,
and C's C5 and D5 from 0.92 s) use `{ "seconds": … }` with the prototype's exact values:

- `examples/hatena-marumo-a.json` — 「ハ・テ・ナ？」 rising question (G4 C5 E5+G5 on eighths), answer
  D5 → B4 → big C-major hit at **1.50 s** with C3+G3 bass, an extra C6 after. 130 BPM.
  (In the prototype: `A` in `marimba.py`. The user liked this melody.)
- `examples/hatena-marumo-b.json` — fast sixteenth run C5 D5 E5 G5 A5 C6, B5, hit at 1.50 s.
- `examples/hatena-marumo-c.json` — E5 G5 A5 (question) + G5, C5 D5 hop, hit at 1.50 s.
- `examples/a-<instrument>.json` — melody A on each instrument; `a-marimba-glocken-claps.json` —
  marimba lead, glockenspiel doubling an octave up at 30 %, claps on beats 0, 1 and the hit.

These examples double as the reference style the README shows an LLM: cues first, music on them.

## Reference prototype

`reference/prototype/` (Python + numpy; run with `uv run --with numpy python -I <file>` — the
scripts insert their own directory into `sys.path`):

- `marimba.py` — the marimba model, the room reverb, melodies A/B/C, WAV writer.
- `instruments.py` — xylophone, glockenspiel, music box, vibraphone, ukulele (Karplus–Strong),
  clap, and the marimba+glockenspiel+claps mix.
- `instruments2.py` — piano, organ, music box v2, piccolo, trumpet, and how sustained notes get
  their hold length.
- `beats.py` — librosa beat/onset analysis used to study an existing jingle (not part of v1; see M6).

Port the **sound** (mode ratios, decays, envelopes, noise shapes, levels) faithfully, then render
the same melodies in TypeScript and compare against the prototype's output numerically
(per-note spectral peaks and decay times within a few percent). Do not port the code structure:
the prototype uses global state, non-seeded paths in places, and peak normalisation instead of
loudness. Keep `reference/` in the repo as provenance (it is MIT like the rest), and do not
import it.

Do **not** add any third-party audio to the repo. In particular, the jingle the user analysed while
prototyping belongs to another of their brands; it is not part of this project.

## Project setup

Mirror `../avatarscript` (read its `CLAUDE.md`, `package.json`, `tsconfig*.json`,
`eslint.config.js`, `.github/workflows/ci.yml`):

- TypeScript, ESM, Node ≥ 22, **npm** (package-lock.json), MIT licence, `author: receptron`.
- zod for every untyped input; no `as` casts or `!` (lint errors); `Record<Union, …>` tables.
- ESLint with every rule an error; Prettier; `npm run format / lint / typecheck / test`.
- `tsconfig.json` includes `src`, `tests`, `scripts`, `examples` and `eval`.
- vitest; **tests run without network or ffmpeg** (skip MP3 tests when ffmpeg is absent, but
  never fail for it); golden tests compare a hash of rendered PCM for each example at a fixed seed.
- `README.md` (what/how), `PLAN.md` (this file, kept up to date with a Progress section like
  AvatarScript's), `CLAUDE.md` (working notes for agents — already written; read it before
  starting and extend it as conventions emerge).
- GitHub repository: receptron/jinglescript — confirm with the user before creating it or
  publishing to npm.

## Milestones

### M0 — Scaffold
Repo setup as above, `git init`, CI, empty `render` that returns silence of the right length with
a correct timing map. **Done when** lint/typecheck/test pass in CI.

### M1 — Score language, timing, marimba, first LLM evaluation
zod schema with LLM-oriented descriptions + JSON Schema export, the API for LLMs (`getSchema`,
`checkScore`, `listInstruments`; `getAuthoringGuide` with the draft guide), cues (seconds and beats), `at`
forms, `repeat`, beat↔second conversion, hold lengths, repair-oriented errors and `check`, the timing map,
the marimba instrument, chords, the multi-track mixer (any number of tracks, constant-power pan,
per-track gain), room reverb, BS.1770 loudness, WAV writer. Port `hatena-marumo-a.json` (melody,
chords and bass as separate marimba tracks, so the mixer is exercised from the start).
First version of the evaluation set and script ([LLM authoring](#llm-authoring-and-evaluation)),
with a draft authoring guide for the subagent to read.
**Done when** rendering example A gives onsets exactly at the timing map (within one sample),
the `hit` cue at 1.500 s, integrated loudness −14 ± 0.5 LUFS, its per-note spectra/decays match
the prototype's marimba within a few percent, and the evaluation has run with its pass rate
recorded in Progress (no target yet — the first number is the baseline; marimba-only requests).

### M2 — All prototyped instruments
xylophone, glockenspiel, vibraphone, music box, piano, organ, ukulele, piccolo, trumpet, clap,
mixed freely with each other. Examples B, C, the `a-<instrument>` set, and ensemble examples
(`a-marimba-glocken-claps.json`, plus e.g. piano chords + ukulele + clap) that check the mix for
clipping and loudness with many simultaneous notes. **Done when** each passes the
"quality checks without ears" across its range, and the user has listened to the rendered examples
(hand them over as a folder of MP3s and ask; do not mark the milestone done on your own judgement).

### M2b — Sound effects
`clock`, `footsteps`, `tapdance`, `pistol`, `laser`, `whoosh`, `riser`, `impact`, `pop`;
`variant`; `end` for effects with a duration; the peak limiter; per-track reverb opt-out. Examples mixing music and effects (e.g. `clock-to-chime.json`: ticks into a
marimba hit; `walk-in.json`: footsteps landing on the hit). **Done when** each effect passes the
quality checks across its variants, effect onsets are on the timing map within one sample, the
effect requests in the evaluation pass, and the user has listened to the rendered effects and
examples (MP3 folder; their judgement, not ours).

### M2c — Modern palette
The not-yet-prototyped instruments above (synths, drums, chiptune, the extra acoustic ones), and
style examples a creator would recognise: `tech-intro.json`, `vlog-outro.json`,
`gaming-intro.json`, `logo-sting.json`, `tiktok-transition.json`. **Done when** each instrument
passes the quality checks across its range, the style requests in the evaluation pass, and the
user has listened to the rendered examples.

### M2d — Custom instruments
`instruments` in the score: tweaking and layering built-ins (parameters exposed by every
built-in), the block vocabulary, engine-side safety guarantees, re-expressing the fitting
built-ins as definitions. Examples: `custom-bell.json`, `custom-zap.json`, `layered-hit.json`.
**Done when** the re-expressed built-ins render identically (or within the M1/M2 tolerances) to
their code versions, a fuzz test of random valid definitions never produces NaN, clicks, aliasing
or DC, the evaluation's custom-sound requests pass, and the user has listened to the examples.
The schema reserves `instruments` from M1 so earlier scores stay valid.

### M3 — CLI, docs, LLM-readiness
CLI commands above, `instruments`/`schema`/`demo`, README with a "how to write a jingle" section
aimed at LLMs: cues first (from the animation's times), then music on them; and the musical rules
of thumb that made the prototype work — a 3-note rising "question" then a resolving "answer", the
big chord with a low bass on the hit, keep it under ~2 s of notes for a 5 s sting, leave the tail
for a voice-over. Grow the evaluation set to all instruments. **Done when** the full evaluation
passes on the first try for every request with cue times correct (one repair round allowed for
at most one request), including "a 4-second glockenspiel sting that lands on a hit at 1.2 s".

Also the [MCP server](#mcp-server-v1). **Done when** (in addition) a subagent that is given
only the MCP tools — no README, no files — renders the evaluation's requests through them.

### M4 — Encoding and packaging
MP3/OGG via ffmpeg (optional), `--rate`, npm packaging (`files`, `bin`), a pack-install-render smoke
test like AvatarScript's `scripts/smoke.sh`. Publishing waits for the user.

### M5 — Sampled instruments (optional)
For sustained acoustic instruments, an opt-in sample-based instrument type fed by a CC0 library
such as the Versilian Community Sample Library (VCSL) — verify its licence and contents first,
download samples on demand into a cache (never commit them), keep the score format unchanged
(`"instrument": "vcsl:trumpet"` or similar). Ask the user before starting.

### M6 — Analyse existing audio (optional)
`jinglescript analyze <audio>` — tempo, beats, onsets, the loudest hit, `audibleUntil` — so an
existing jingle can drive an animation the same way. The prototype did this with librosa
(`beats.py`); a TypeScript onset detector (spectral flux) is enough. Ask before starting.

### M7 — MulmoCast integration (later)
A way for a MulmoScript to use a JingleScript score as an opening/transition audio and expose its
timing. Design it with the MulmoCast maintainers; out of scope until M1–M4 are done.

### M8 — Jingle + animation tool (later)
Grow JingleScript into a tool that writes the jingle and the animation synced to it from one
request, on the cue vocabulary ([Toward a jingle + animation tool](#toward-a-jingle--animation-tool)).
Possibly built with or on AvatarScript. Not designed yet; ask the user before starting.

## How it will be used first (context for decisions)

The 「ハテナマルモ」 opening: a 5.1 s video where マルモ hops in from the right, landing on the
beats (0.17 / 0.53 / 1.00 s), lands on the final hit at 1.50 s while 「？」 pops and the logo
completes, then says 「ハテナ、マルモ、はじまるよ！」 over the tail (≈1.8–4.4 s). The renderer that
makes that video lives outside this repo (in the user's workspace); it will read
`timing.json` (`cues.hit`, `cues.voice`, `beats`, `audibleUntil`) instead of hard-coded times.
That is why the timing map's shape matters more than any other API detail — keep it stable and
documented.

This is the pattern every use follows: the animation has moments, the moments become cues, the
music is written on the cues, and the animation reads the cue times back. The hop landings above
could be cues too (`hop1`…`hop3`), with or without notes on them.

## Open questions

Ask the user rather than deciding:

1. Repository name/owner and npm package name (`jinglescript` under receptron?) and when to publish.
2. The default sample rate (48 kHz to match video, or 44.1 kHz).
3. Whether piccolo and trumpet should ship in v1 as "synthetic" or wait for M5.
4. Whether M5/M6 are wanted at all.
5. Which LLM(s) the evaluation should target besides a Claude subagent, if any.
6. Content ID: rendering is deterministic, so two creators rendering the same example get
   identical audio. If one registers it with YouTube Content ID, the other could get a claim.
   Should the README ask users not to register rendered output, and should examples be meant to
   be varied (seed, tempo, instruments) rather than used as-is?
7. Instrument kits: should definitions be shareable across scores (a kit file a score imports,
   or a kit passed to the library), or stay inline in each score? Inline keeps scores
   self-contained, which matters for embedding and for LLMs.

Decided:

- MCP server: in v1, milestone M3, one tool `manageJingleScript` with an `action` parameter,
  wrapping the API for LLMs (2026-10-08).
- Text notation (`.jgs`): not in v1 — the primary author is an LLM, and JSON + schema is safer
  for it (2026-10-08).

## Progress

(Keep a dated log here as milestones land, like AvatarScript's PLAN.md.)

- 2026-10-08 — Plan written from the Python prototype; folder created by the user. Nothing built yet.
- 2026-10-08 — Direction set by the user: the script language is the product, written by an LLM,
  for animation synced to the jingle; may grow into a jingle + animation tool. Plan updated:
  cues (in seconds or beats, notes optional) replace markers; `at` accepts seconds; timing map
  reports cues; repair-oriented errors and `check`; LLM evaluation moved into M1; embedding rules
  and M8 added; `.jgs` dropped from v1.
- 2026-10-08 — User: chords and mixing several instruments are basic requirements. Made explicit
  (Goals, polyphony and track rules); the multi-track mixer moves into M1; ensemble examples in
  M2; chord and multi-instrument requests added to the evaluation set.
- 2026-10-08 — User: jingles and animations with sound effects (clock tick-tock, footsteps, tap
  dance, pistol, laser). Added sound effects as first-class tracks (`variant`, `repeat`, perceptual
  onsets), a peak limiter in the master chain, milestone M2b, effect requests in the evaluation.
- 2026-10-08 — User: the audience is everyone making video for YouTube/Instagram/TikTok, not only
  kids' or cartoon content. Added "Who it is for"; quality bar and Foley non-goal reworded across
  styles; default loudness −16 → −14 LUFS (platform normalisation); modern/electronic, drum and
  chiptune instruments grouped and given milestone M2c; transition effects (`whoosh`, `riser`,
  `impact`, `pop`) and `end` added to M2b; evaluation widened to ~20 requests across styles;
  Content ID added to Open questions.
- 2026-10-08 — User: keep many built-in instruments, and let a score define its own. Added
  [Custom instruments](#custom-instruments): top-level `instruments`, tweak/layer a built-in or
  build from a fixed block vocabulary, data not code, clean by construction; built-ins re-expressed
  in the same vocabulary where they fit; milestone M2d; custom-sound requests in the evaluation;
  instrument kits added to Open questions.
- 2026-10-08 — User: zod for all type validation; an LLM-facing API that can return the schema.
  zod v4 with `z.toJSONSchema` made explicit as the single source of truth; added
  [API for LLMs](#api-for-llms) (`getSchema(part?)`, `getAuthoringGuide`, `listInstruments`,
  `getInstrument`, `checkScore`, each with a CLI twin) in M1; the eval uses only this API; MCP
  server added to Open questions.
- 2026-10-08 — User: MCP server in v1; start implementing. Added [MCP server](#mcp-server-v1)
  (stdio, tools wrapping the API for LLMs, sandboxed output directory, `@modelcontextprotocol/sdk`)
  to M3; moved from Open questions to Decided.
- 2026-10-08 — **M0 done locally; M1 mostly done.** Scaffold mirroring avatarscript (npm, ESM,
  zod 4, strict ESLint, Prettier, vitest, CI workflow — CI not yet run: no GitHub repo). M1: zod
  schemas → JSON Schema (`schema/`, test keeps it current), cues/`at` forms/`repeat`/`humanize`/
  hold lengths in one events module, repair-oriented errors and `check`, timing map
  (`jinglescript-timing/1`), marimba, room/hall reverb (FFT convolution), BS.1770 loudness and
  true peak (agree with ffmpeg's ebur128 to 0.1 LU), WAV 24/16-bit, API for LLMs and CLI
  (`render`, `check`, `schema`, `guide`, `instruments`). 43 tests pass.
  - Marimba vs prototype `bar()`: after the 10 ms click, samples match to ~1e-7 relative; decay
    time constants identical. The click uses the same recipe with seeded draws.
  - Loudness: marimba is peaky (peak-to-loudness ~15.7 dB), so −14 LUFS at −1.5 dBTP needs
    limiting. The look-ahead limiter planned for M2b moved into M1 (`master.limiter`, default on,
    at most 6 dB; beyond that the loudness is left short). Example A: −14.0 LUFS, −1.7 dBTP,
    0.7 dB limiting.
  - Found: the prototype's reverb (delta + decaying noise with ~0.6 of the direct energy) colours
    tones randomly — one marimba note's energy through it varies 0.4–1.76× by seed, so limiting
    on example A varies 0–5.9 dB with the seed and also changes with the sample rate. Kept as
    ported pending the user's ears (out/listen-m1/).
  - Evaluation baseline (marimba-only, 10 requests, guide + schema via the CLI only, no check):
    default model 10/10, Haiku 10/10 valid on first try with cue times correct. Feedback to act on:
    evenly spaced notes in seconds ("every 0.4 s") forced the LLM to choose a tempo to match —
    consider `repeat.every` in seconds; say how `until` treats times just off the grid.
  - Not done in M1 yet: the user's listening check of the port (MP3s in out/listen-m1/).
- 2026-10-08 — M1 committed. User: the MCP server exposes a single tool `manageJingleScript`
  with an `action` parameter (plan updated). Starting M2.
- 2026-10-08 — **M2 implemented; waiting for the user's ears.** xylophone, glockenspiel,
  vibraphone, music box (v2), piano, organ, ukulele, piccolo, trumpet, clap ported from the
  prototype; descriptors gained `transpose` (music box and piccolo sound an octave up). Shared
  blocks in `src/instruments/common.ts` (modes, noise bursts, ADSR, phase accumulation, finish).
  Examples B, C, `a-<instrument>` ×9, `a-marimba-glocken-claps`, and a new
  `piano-ukulele-claps` ensemble; golden PCM hashes for all 14. 103 tests pass.
  - Measured defects of the prototype fixed (no ears needed): ukulele out of tune by up to 13.9
    cents (integer Karplus–Strong delay → fractional all-pass) and carrying a DC offset (the
    excitation's mean); glockenspiel/vibraphone/music box/piano/ukulele cut while still ringing
    (→ ring to −60 dB or a 0.3 s damper fade); music box 0.8 ms onset (→ 1 ms minimum).
  - Every instrument trimmed so a C5 at full velocity matches the marimba's loudness (±0.5 LU,
    tested), so ensembles balance. Every instrument passes the checks across its range: finite,
    onset ramp, ends silent, DC < 0.5 %, energy above sampleRate/2.2 < 1e-5, in tune ±10 cents.
  - Ukulele's pluck (one period of raw noise) is very peaky: `a-ukulele` reaches only −17.2 LUFS
    and `piano-ukulele-claps` −15.8 LUFS with the limiter at its 6 dB maximum (reported as
    `limitedByPeak`). Left as ported pending the user's ears.
  - MP3s of every example plus the prototype's own renders for comparison: out/listen-m2/.
- 2026-10-08 — User listened to M2: ukulele pluck too harsh, clap not good. Clap rebuilt as
  band-limited noise with variants `studio`, `snappy`, `hands`, `group`; the user picked `studio`
  ("だいぶ拍手っぽくなった"), the default. Every variant is quality-tested and loudness-matched.
  Biquad filters shared in `src/dsp/biquad.ts`. Ukulele: low-passing the pluck was not enough —
  the user hears it as a koto ("全然ダメ。琴みたい。もっとずっと柔らかく"); being reworked.
- 2026-10-08 — Ukulele rebuilt for a soft nylon sound (string loop with damping, compensated so
  pitch stays exact; finger-pluck excitation; per-note decay time; body low-pass). Three
  candidates rendered (C5 spectral centroid 746 / 567 / 525 Hz vs 933 Hz for the koto-like
  version); the user picked the softest. New example `ukulele-island-strum.json`: an original
  C–F–G7–C island strum with GCEA voicings and strings 15 ms apart (the user asked for "カメハメハ
  大王" to hear chords; that song is copyrighted, so an original progression instead).
  Idea for later: a `strum` option on chords (string order and spacing) instead of writing each
  string as its own note.
- 2026-10-08 — User liked the strum, "especially that it is a little off", and asked for a language
  that makes this easy for an LLM. Added `chord` (symbols such as "G7", "Fmaj7", "F#m7"; voiced by
  the instrument — fretted instruments declare a `tuning` and get a real shape from a fret search,
  e.g. ukulele C = 0003, G7 = 0212; others stack from octave 4) and `strum` ("down", "up", or a
  tab-style pattern "D-DU-UDU", one character per eighth note; strings ~15 ms apart with seeded
  looseness in string gaps, onset and velocity; a stroke on a cue starts exactly on it). The
  island-strum example went from 100 notes to 5 lines. Timing map notes gain `chord` and `strum`
  (additive, still jinglescript-timing/1).
  - Evaluation (Haiku, guide + schema only, 3 strum requests incl. Japanese): 3/3 valid on the
    first try, patterns used correctly ("-U-U" upbeats, "D-DUD-DU", "D-DU" for 2-beat chords).
    Found and fixed: the near-cue warning fired on a stroke's looseness; it now judges the written
    time.
- 2026-10-08 — **M2b implemented; waiting for the user's ears.** Nine effects in `src/sounds/`:
  clock (tick/tock), footsteps (left/right), tapdance (toe/heel/shuffle), pistol (shot/cartoon),
  laser (optional start pitch, `len` sweep), whoosh (soft/fast), riser (noise/tone), impact
  (soft/hard), pop (optional pitch). Score: `end` places effects with a length by when they finish
  (`{ "end": "hit", "len": 4 }`); tracks take `"reverb": false` (a dry bus joins after the
  reverb); descriptors gain `pitchOptional` and `duration`; the first variant is the default;
  timing-map notes gain `end` for effects with a length. Every effect and variant passes the
  checks (finite, onset ramp, ends silent, DC < 0.5 %, tonal ones alias-free), is loudness-matched
  to the marimba (mean over five seeds, ±0.5 LU), and — except whoosh and riser, which swell —
  reaches a quarter of its peak within 5 ms of its onset; effect onsets land on the sample the
  timing map gives (tested at 48 and 44.1 kHz). Footsteps needed a 40 Hz high-pass: the thump
  decays within a cycle and left DC. Examples: clock-to-chime, walk-in, laser-zaps,
  whoosh-transition, riser-reveal, tap-dance. Examples with impacts or footsteps come out at
  −15 to −16 LUFS with the limiter at its 6 dB cap (reported, not hidden). MP3s of every effect
  and example: out/listen-m2b/.
  - Evaluation, effects (eval/requests-effects.json, 6 requests incl. Japanese; guide + schema only,
    no check): Haiku 6/6 and the default model 6/6 valid on the first try with every cue time right.
    Both placed the riser with `end` and alternated variants with lists. The "western" request (two
    pistol shots) comes out at −17 to −18 LUFS with the limiter at its cap.
- 2026-10-08 — User: tapdance and footsteps "a little strange"; add high heels and a knock.
  Footsteps rebuilt as noise (heel strike coloured by the floor, toe, scuff) instead of a falling
  sine; tapdance as a broadband crack, a short dense metallic ring and the floor's knock instead of
  clean bell-like modes; new `heels` (clack resonances, then the sole) and `knock` (knuckle click
  and panel resonances; door/table). Found while calibrating: matching an impulse's *loudness* to
  the marimba put its peak 10–20 dB above the music, so the limiter crushed every mix. Impulses
  now carry `transient` and are balanced by peak (as loud at their peak as a C5 marimba note);
  clock moved to the same rule. With that, walk-in and tap-dance reach −14 LUFS with 0–3.6 dB of
  limiting. Two candidates each for footsteps, tapdance and heels in
  out/listen-footsteps-heels-tap-knock/; the code defaults to candidate A until the user picks.
- 2026-10-08 — User picks: footsteps B (leather on wood), heels B (block heel on wood; "room to
  improve", direction not yet given). Tap dance went through two more rounds: adding weight to the
  ringing-plate design still sounded like "hitting an empty can" — sparse sustained partials read
  as a can whatever their level. Rebuilt without any sustained ring; of five candidates the user
  picked a dry crack plus a dense, heavily damped 40-mode wooden floor at 60 % of the crack's peak.
  Lesson for future effects: avoid sparse, lightly damped partials unless the thing really rings.
- 2026-10-08 — **M3 done** (CLI, docs, LLM-readiness, MCP). `jinglescript mcp`: one tool
  `manageJingleScript`, actions getGuide/getSchema/listInstruments/getInstrument/checkScore/
  renderScore, input one zod schema (per-action requirements in it), renders only into `--out`,
  file stems validated; the SDK is imported only by the `mcp` command. Tested in-process (in-memory
  transport) and over stdio, from src and from dist. `jinglescript demo <sound>`; render and MCP
  share `renderToFiles`. README: MCP setup for Claude Code / Desktop, and the authoring guide
  generated into it from src/guide.ts (`npm run readme`, test keeps it current).
  - Evaluation, all instruments (eval/requests-instruments.json, 10 requests incl. "a 4-second
    glockenspiel sting that lands on a hit at 1.2 s" and Japanese): default model 10/10, Haiku 9/10
    first try (the miss placed the note right but made no cue for it). MCP only (a subagent whose
    only tool was a stdio MCP client bridge; no files): 5/5 rendered, each passing its first
    checkScore.
  - Acted on the evaluators' feedback: instrument facts (range, transpose, sustained, len default,
    variants, synthetic) now in the schema's instrument description; `len` also takes
    `{ "seconds": n }`; checkScore returns a `timeline` (where each note/effect resolved, with
    `end`); the guide says every named time becomes a cue, and gives laser/pop default pitches.
  - Not changed: the timing map's `beats` (seconds of each beat) keeps its name — it is the
    public contract.
- 2026-10-08 — **M4 done** (publishing still waits for the user; package.json stays `private`).
  MP3 (libmp3lame VBR ~190 kbit/s) and OGG (Vorbis q6) through ffmpeg, found at run time; a clear
  message when it is missing (CLI prints it, MCP returns it as a tool error). `-o` picks the format
  by extension; MCP `renderScore` takes `format`. `scripts/smoke.sh` packs the tarball, installs it
  into an empty folder and renders through the CLI (WAV + MP3), the library and the MCP server over
  stdio; CI runs it with ffmpeg. Tarball: 113 files, 73 kB (dist, schema, README, LICENSE).
- 2026-10-08 — User: MCP should also support the GUI Chat Protocol, so a rendered jingle can be
  heard in a view. Research (receptron protocol + MulmoTerminal/MulmoClaude): hosts do not take GUI
  data from external MCP servers — a view comes from a gui-chat-protocol plugin package registered
  in the host, whose core `execute` the host runs server-side and whose `/vue` entry supplies the
  view. So: `src/manage.ts` now holds manageJingleScript independent of the carrier (MCP wraps it;
  `renderScore` can also return `PlayerData`: embedded MP3/WAV data URI, waveform peaks, timing),
  and `gui-plugin/` is the plugin `@gui-chat-plugin/jinglescript` with a player view (waveform,
  beats, labelled cues that seek, per-track note lanes, bars for effects with a length, download)
  and a preview card. Verified in a headless browser on a demo page: no console errors, three
  players render, play advances the time, a cue chip seeks. Not yet registered in MulmoTerminal
  (needs edits in that repo — asked the user first). Package name is provisional.

