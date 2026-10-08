// The authoring guide for LLMs, returned by getAuthoringGuide() / `jinglescript guide` / the MCP
// server. Draft (M1): it grows with the instrument set and is tested by the evaluation in eval/.

export const AUTHORING_GUIDE = `# Writing a JingleScript score

A JingleScript score is JSON (format "jinglescript/1") describing a short jingle — 1 to 15
seconds of music and sound effects — plus named **cues** an animation syncs to. Get the exact
schema with getSchema() / \`jinglescript schema\`; check your score with checkScore() /
\`jinglescript check\` and fix every error it reports before rendering.

## Work in this order

1. **Cues first.** Write down the moments the video needs, in seconds, as cues:
   \`"cues": { "hit": { "seconds": 1.5 }, "voice": { "seconds": 1.8 } }\`. Never convert seconds to
   beats yourself — give cues in seconds and place notes on them.
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
