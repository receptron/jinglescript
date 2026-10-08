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
seconds, and \`audibleUntil\`. The animation reads cue times from it by name.
`;
