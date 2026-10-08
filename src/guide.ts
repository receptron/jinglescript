// The authoring guide for LLMs, returned by getAuthoringGuide() / `jinglescript guide` / the MCP
// server. Draft (M1): it grows with the instrument set and is tested by the evaluation in eval/.

export const AUTHORING_GUIDE = `# Writing a JingleScript score

A JingleScript score is JSON (format "jinglescript/1") describing a short jingle — 1 to 15
seconds of music and sound effects — plus named **cues** an animation syncs to. Get the exact
schema with getSchema() / \`jinglescript schema\` / the MCP action \`getSchema\`; check your score
with checkScore() / \`jinglescript check\` / the MCP action \`checkScore\`, and fix every error it
reports before rendering.

## Work in this order

1. **Cues first.** Write down the moments the video needs, in seconds, as cues:
   \`"cues": { "hit": { "seconds": 1.5 }, "voice": { "seconds": 1.8 } }\`. Never convert seconds to
   beats yourself — give cues in seconds and place notes on them. Every time the request
   mentions (a start, a landing, a logo, a cut) becomes a cue, even when it happens to fall on a
   beat: the animation reads cues, not notes.
2. **Tempo and length.** 100–140 BPM suits most jingles. \`length\` is the whole audio; leave
   1–3 s after the last note for it to ring out, more if a voice-over follows.
3. **Music on the cues.** Place the big moment exactly on its cue (\`"at": "hit"\`), and the lead-in
   before it on the beat grid (\`"at": 0\`, \`0.5\`, \`1\` … in beats) or relative to the cue
   (\`"at": "hit-1"\` = one beat before, \`"hit+0.5"\` = half a beat after).
4. **Check, fix, render.**

## Time

- \`at\` as a number is **beats** from the start (one beat = a quarter note at \`tempo\`; 0.5 is an
  eighth note, 0.25 a sixteenth).
- \`at\` as \`{ "seconds": 0.86 }\` is clock time, for a note the animation pins to a moment.
- \`at\` as a cue name is that cue's time; \`"cue+n"\` / \`"cue-n"\` offsets it by n beats.
- \`repeat\` plays a note again every \`every\` beats, \`count\` times in total or \`until\` a time:
  \`{ "at": 0, "repeat": { "every": 1, "until": "hit" } }\`.

## Notes and chords

- \`pitch\` is "C4" (middle C), "F#3", "Bb5"; a list is a chord: \`["C5", "E5", "G5"]\`.
- \`vel\` 0–1 is how hard: 0.8 normal, 1.0 for the hit, 0.3–0.4 for a soft echo.
- Several tracks play together. Put the melody and the bass on separate tracks (even with the same
  instrument), each with its own \`gain\` (dB) and \`pan\` (0 left … 1 right).

## Chords and strums

- Write a chord by name with \`chord\` instead of \`pitch\`: "C", "Am", "G7", "Fmaj7", "Bb", "F#m7",
  "Dsus4". The instrument voices it — on the **ukulele** you get the real chord shape (C = 0003,
  F = 2010, G7 = 0212), on other instruments the chord stacked from octave 4. Use \`pitch\` lists
  when you want exact notes.
- \`strum\` plays a chord string by string, ~15 ms apart, slightly loose like a real hand (seeded,
  so the same score always sounds the same). \`"down"\` or \`"up"\` for one stroke, or a pattern
  with one character per eighth note: D down, U up, d/u soft, - rest.
  - \`"D-DU-UDU"\` — the classic island strum, one 4-beat bar.
  - \`"D-D-D-D-"\` — plain downstrokes on every beat.
  - \`"D-DUD-DU"\` — a busier pop strum.
  Write one note per bar with its chord and pattern; add \`"repeat": { "every": 4, "count": 2 }\`
  to keep the same chord for two bars.
- End on a single stroke: \`{ "at": "end", "chord": "C", "strum": { "pattern": "down", "spread": 25 } }\`
  (a slower, wider final strum). A stroke placed on a cue starts exactly on it.

### Example: island strum on ukulele

\`\`\`json
{
  "format": "jinglescript/1",
  "tempo": 100,
  "length": { "seconds": 12 },
  "cues": { "end": { "beats": 16 } },
  "tracks": [
    { "instrument": "ukulele", "notes": [
      { "at": 0, "chord": "C", "strum": "D-DU-UDU", "vel": 0.75 },
      { "at": 4, "chord": "F", "strum": "D-DU-UDU", "vel": 0.75 },
      { "at": 8, "chord": "G7", "strum": "D-DU-UDU", "vel": 0.75 },
      { "at": 12, "chord": "C", "strum": "D-DU-UDU", "vel": 0.75 },
      { "at": "end", "chord": "C", "strum": { "pattern": "down", "spread": 25 }, "vel": 0.9 }
    ] }
  ]
}
\`\`\`

## Instruments

Every instrument and its range is listed in the schema (\`tracks[].instrument\`) and by
listInstruments() / \`jinglescript instruments\`. Rules of thumb:

- **Struck and plucked** (marimba, xylophone, glockenspiel, vibraphone, musicbox, piano, ukulele,
  clap) ring out on their own; \`len\` is ignored. **Sustained** (organ, piccolo, trumpet) hold
  each note until the track's next note unless you give \`len\` in beats.
- **musicbox** and **piccolo** sound an octave above the written pitch.
- **piccolo** and **trumpet** sound synthetic; use them for a playful line, not for realism.
- **clap** takes no pitch. Use \`repeat\` for claps on every beat. The default is a drum-machine
  clap; \`"variant"\` can be "snappy", "hands" (one person) or "group" (a few people).
- A second instrument doubling the melody quietly adds colour: glockenspiel an octave up at
  \`"gain": -6\` over a marimba melody makes it sparkle.
- All instruments are balanced to the same loudness at the same velocity; use track \`gain\` to
  put one behind another.

## Sound effects

Effects go in tracks like instruments and land on cues exactly like notes; the timing map's \`t\`
is the start of the sound, so an animation frame on it lines up.

| Effect | Variants (first = default) | Notes |
|---|---|---|
| clock | tick, tock | \`"variant": ["tick", "tock"]\` with \`repeat\` for a ticking clock |
| footsteps | left, right | \`"variant": ["left", "right"]\`, \`repeat\` every 0.5–1 beat to walk |
| heels | left, right | high-heel steps; walk the same way |
| knock | door, table | "knock-knock": two notes about half a beat apart |
| tapdance | toe, heel, shuffle | |
| pistol | shot, cartoon | |
| laser | — | optional \`pitch\` = where the "pew" starts (default about D7); \`len\` = sweep length (default 0.25 s) |
| whoosh | soft, fast | \`len\` = length (default 0.5 s); place with \`end\` to finish on a cut |
| riser | noise, tone | builds into a hit: \`{ "end": "hit", "len": { "seconds": 2 } }\` (default 2 s) |
| impact | soft, hard | the boom a reveal lands on |
| pop | — | optional \`pitch\` = starting pitch (default about E6); things appearing, text popping in |

- \`end\` (instead of \`at\`) places an effect with a length by when it **finishes** — a riser or
  whoosh that stops exactly on the cut. \`len\` is beats, or \`{ "seconds": n }\` when the request
  gives seconds.
- checkScore lists where every note and effect resolved to (\`timeline\`), so you can confirm an
  effect placed by \`end\` starts where you meant.
- Close, dry effects (ticks, footsteps, taps) sound better outside the reverb: give their track
  \`"reverb": false\`.
- Short impulses (ticks, steps, taps, knocks) peak like an instrument note; other effects are as
  loud as instruments at the same velocity; put them under the music with track
  \`gain\` (-4 to -8 dB) unless they are the point.
- Big impacts are very peaky; a jingle with one may come out a little quieter than the loudness
  target (the renderer reports it).

## Custom instruments

When no built-in sounds right, define your own under top-level \`"instruments"\` and use its name
in a track like a built-in. Names start with a lowercase letter (\`"softBell"\`) and must not be a
built-in's. Three forms, from easiest to most flexible — use the first that does the job:

**1. Tweak a built-in** with \`base\` and any of: \`params\` (\`decay\`, \`brightness\`, \`attack\`),
\`transpose\` (semitones), \`detune\` (cents), \`gain\` (dB), \`variant\`.

\`\`\`json
"instruments": {
  "softBell": { "base": "glockenspiel", "params": { "decay": 1.8, "brightness": -0.5, "attack": 0.01 } },
  "deepBoom": { "base": "impact", "variant": "hard", "params": { "brightness": -0.6 } }
}
\`\`\`

- \`decay\` multiplies how long it rings: 0.5 half, 2 twice. Above 1 only for built-ins that have a
  block definition (marimba, xylophone, glockenspiel, vibraphone, musicbox, ukulele, organ).
- \`brightness\` -1 (dark, muffled) … 1 (bright, crisp). \`attack\` seconds of fade-in: 0.02–0.08
  softens the strike, 0.2+ swells in.

**2. Layer** 2–6 sounds that play together on every note; each layer takes the same fields as a
tweak, plus \`delay\` (seconds after the onset). Give the note a chord as usual: pitched layers
play every pitch of it, layers without pitch (an impact, a clap) play once.

\`\`\`json
"bigHit": { "layers": [
  { "base": "piano" },
  { "base": "impact", "variant": "soft", "gain": -8 },
  { "base": "glockenspiel", "transpose": 12, "gain": -12 }
] }
\`\`\`

**3. Build from blocks.** Sources are mixed: \`osc\` (sine, triangle, saw, square, pulse at a
\`ratio\` of the note), \`modes\` (struck partials: bars, bells), \`noise\` (clicks, breath, hiss),
\`string\` (a plucked string). Shapers act on the whole sound: \`env\`, \`filter\`, \`pitchEnv\` (a
pitch glide), \`lfo\` (vibrato or tremolo). Every time is in seconds; \`decay\` means "seconds until
silent".

\`\`\`json
"zap": { "kind": "sfx", "pitch": "C7", "blocks": [
  { "osc": "square", "level": 0.6 },
  { "pitchEnv": { "from": 0, "to": -36, "time": 0.25, "curve": "linear" } },
  { "filter": "lowpass", "cutoff": 5000 },
  { "env": { "attack": 0.002, "decay": 0.3 } }
] },
"warmPad": { "blocks": [
  { "osc": "saw", "detune": -7 }, { "osc": "saw", "detune": 7 },
  { "filter": "lowpass", "cutoff": 1800 },
  { "env": { "attack": 0.15, "decay": 0.5, "sustain": 0.7, "release": 0.6 } },
  { "lfo": "vibrato", "rate": 5, "depth": 8, "delay": 0.3 }
] },
"bell": { "blocks": [
  { "modes": [ { "ratio": 1, "level": 1, "decay": 4 }, { "ratio": 2.76, "level": 0.4, "decay": 1.5 }, { "ratio": 5.4, "level": 0.2, "decay": 0.6 } ] },
  { "noise": "white", "burst": 0.003, "level": 0.1 }
] }
\`\`\`

- \`env\` with \`sustain\` 0 is struck (rings out over \`decay\`); \`sustain\` above 0 holds for the
  note's \`len\` like the organ. A source with its own \`env\` ignores the whole sound's.
- \`"kind": "sfx"\` makes a sound effect: \`pitch\` is the default when a note gives none; \`length\`
  makes it last \`len\` (default \`length\` seconds) and lets notes be placed by \`end\`.
- getInstrument("marimba") (and the other block built-ins) shows the built-in as blocks: copy it
  and change ratios, decays or the click to make a relative of it.
- You do not set levels: every custom sound is balanced against the marimba, and the engine keeps
  it clean (no aliasing, clicks, DC or runaway levels). Use track \`gain\` or layer \`gain\` to mix.

## Lyrics

Words can ride on the melody, so a player shows them karaoke-style: the current line, the next
one, and a wipe across each syllable as its note plays. Nothing is sung — the instrument plays the
melody; the words are text on its notes, timed exactly by them.

- Put \`lyric\` on each melody note: one syllable per note. In Japanese one mora (\`"ハ"\`,
  \`"テ"\`, \`"ナ"\`; a contracted sound such as \`"きょ"\` is one mora, one note); in English one
  syllable, ending in \`-\` when the word continues on the next note (\`"hap-"\`, \`"py"\` shows as
  "happy"). Words are spaced for you, except between Japanese syllables.
- \`"lyric": "_"\` holds the previous syllable over this note too (one syllable sung over two
  notes).
- Notes without \`lyric\` may sit among them on the same track (an instrumental fill, an echo
  after the hit); they show no text.
- When a word should land on a cue, put its stressed syllable there (\`"day"\` of "today" on
  \`"hit"\`, \`"to-"\` half a beat before).
- \`"lineEnd": true\` on the last syllable of a line starts a new line after it. Keep lines short:
  one phrase of the melody, 2–4 seconds.
- Count the syllables first, then write exactly that many melody notes (plus any \`"_"\`). A chord
  takes one lyric; percussion and effects take none; a note with \`repeat\` takes none (write the
  notes out).
- checkScore lists each line with its time (\`lyrics\`), so you can confirm the words land where
  the request wants them.

\`\`\`json
{ "instrument": "marimba", "name": "melody", "notes": [
  { "at": 0, "pitch": "G4", "lyric": "ハ" },
  { "at": 0.5, "pitch": "A4", "lyric": "テ" },
  { "at": 1, "pitch": "C5", "lyric": "ナ" },
  { "at": 1.5, "pitch": "D5", "lyric": "_" },
  { "at": 2, "pitch": "E5", "lyric": "good" },
  { "at": 2.5, "pitch": "D5", "lyric": "mor-" },
  { "at": 3, "pitch": "C5", "lyric": "ning!", "lineEnd": true }
] }
\`\`\`

## What makes a jingle work

- A **question and an answer**: three rising notes that end open (e.g. G4 C5 E5 on eighths), then
  a short answer that resolves.
- **The hit**: a full chord (C5 E5 G5 C6) with a low bass (C3 + G3) on a separate track, at velocity
  1.0, exactly on the cue the animation lands on.
- Keep the notes short: about 2 s of notes is plenty for a 5 s sting. After the hit, one soft
  echo note (vel 0.35, an octave up) at most; leave the tail for the voice-over.
- Stay in one key; major keys and the pentatonic scale sound friendly.

## Example

\`\`\`json
{
  "format": "jinglescript/1",
  "title": "Bouncy opening",
  "tempo": 130,
  "length": { "seconds": 4.6 },
  "cues": { "hit": { "seconds": 1.5 }, "voice": { "seconds": 1.8 } },
  "tracks": [
    { "instrument": "marimba", "name": "melody", "notes": [
      { "at": 0, "pitch": "G4", "vel": 0.8 },
      { "at": 0.5, "pitch": "C5", "vel": 0.85 },
      { "at": 1, "pitch": ["E5", "G5"], "vel": 0.9 },
      { "at": "hit", "pitch": ["C5", "E5", "G5", "C6"], "vel": 1.0 },
      { "at": "hit+1", "pitch": "C6", "vel": 0.35 }
    ] },
    { "instrument": "marimba", "name": "bass", "notes": [
      { "at": "hit", "pitch": ["C3", "G3"], "vel": 0.9 }
    ] }
  ]
}
\`\`\`

## Output

Rendering gives audio and a timing map (\`jinglescript-timing/1\`): every cue, beat and note in
seconds, \`audibleUntil\`, and — when the score has lyrics — every line and syllable with its
time (\`lyrics\`). The animation reads cue times from it by name.
`;
