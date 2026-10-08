# JingleScript

A small JSON score language for jingles and sound effects, written by an LLM (or a person), rendered
to audio plus a **timing map** so animation can land exactly on the music.

```
request ──► LLM ──► score (JSON) ──► render ──► audio (WAV)
                                           └──► timing.json (cues, beats, note onsets)
```

- Everything is synthesized in code: no samples, no network, no third-party audio. What you render
  is yours to use.
- Deterministic: the same score and seed give bit-identical audio on every machine.
- Cues are named moments (`"hit": { "seconds": 1.5 }`); notes are placed on them, and the timing map
  reports them, so an animation reads `cues.hit` instead of hard-coding a time.

**Status: early development (milestone M1 of [PLAN.md](PLAN.md)).** One instrument (`marimba`) so
far; more instruments, sound effects, custom instruments, MP3 output and an MCP server are planned.
Not published to npm yet.

## Try it

Requires Node ≥ 22.18.

```sh
npm install
node src/cli.ts check examples/hatena-marumo-a.json
node src/cli.ts render examples/hatena-marumo-a.json -o out/opening.wav
#   writes out/opening.wav and out/opening.timing.json
node src/cli.ts guide          # how to write a score (for LLMs)
node src/cli.ts schema         # the JSON Schema (also in schema/jinglescript-1.json)
node src/cli.ts instruments
```

## Library

```ts
import { parseScore, render, toWav, checkScore, getSchema, getAuthoringGuide } from "jinglescript";

const score = parseScore(json); // zod-validated; throws with every problem, each with a path and a hint
const { audio, sampleRate, timing } = render(score); // audio: [left, right] Float32Array
await writeFile("out/jingle.wav", toWav(audio, sampleRate));
await writeFile("out/jingle.timing.json", JSON.stringify(timing, null, 2));
```

For LLMs and agents: `getSchema(part?)`, `getAuthoringGuide()`, `listInstruments()`,
`getInstrument(name)` and `checkScore(json)` (never throws; returns errors with JSON paths and
hints, plus the resolved cue times).

## Licence

MIT
