# JingleScript

A small JSON score language for jingles and sound effects, written by an LLM (or a person), rendered
to audio plus a **timing map** so animation can land exactly on the music.

```
request ──► LLM ──► score (JSON) ──► render ──► audio (WAV)
                                           └──► timing.json (cues, beats, note onsets, lyrics)
```

**Try it in your browser: [the playground](https://receptron.github.io/jinglescript/)** — pick an
example and edit it on a timeline (drag sounds and cues, double-click to add one, change pitch and
sound in a panel) or as JSON, and hear it rendered in the page (no server).

- Everything is synthesized in code — except two things that play recordings. `grandpiano` plays a
  real grand piano from the [Versilian Community Sample Library](https://github.com/sgossner/VCSL)
  (CC0, public domain). Those samples are not in the package: the first render that uses
  `grandpiano` downloads the notes it plays (about 1.2 MB each) into `~/.cache/jinglescript`
  (`JINGLESCRIPT_CACHE` overrides it). The recorded sound effects (ding, glass, metal, punch, book,
  door, dice, cards, cloth, and the footstep surfaces) are CC0 recordings by
  [Kenney](https://kenney.nl), and five more (applause, shutter, coin, page, droplet) were generated
  with Stability AI's Stable Audio 3 and released as CC0; all ship in the package (`samples/sfx/`,
  2.0 MB; sources, prompts and licences in [samples/sfx/SOURCES.md](samples/sfx/SOURCES.md)). Everything else needs no samples and no
  network. What you render is yours to use.
- Deterministic: the same score and seed give bit-identical audio on every machine.
- Cues are named moments (`"hit": { "seconds": 1.5 }`); notes are placed on them, and the timing map
  reports them, so an animation reads `cues.hit` instead of hard-coding a time.

**Status: early (0.x).** Twelve instruments (marimba, xylophone, glockenspiel, vibraphone, music
box, piano, grandpiano (sampled), organ, ukulele, piccolo and trumpet — both synthetic-sounding —
and clap) and twenty-five sound effects: eleven synthesized (clock, footsteps, heels, tapdance,
knock, pistol, laser, whoosh, riser, impact, pop), nine recorded (ding, glass, metal, punch, book,
door, dice, cards, cloth) and five generated with Stable Audio 3 (applause, shutter, coin, page,
droplet), plus recorded surfaces for footsteps.
Chords by name (`"chord": "G7"`) and tab-style strums (`"strum": "D-DU-UDU"`). An MCP server and a
GUI Chat Protocol plugin with a player view. Custom instruments are planned.

```sh
npm install jinglescript
```

## Try it

The package requires Node ≥ 22.12. Running from a clone, as below, runs the TypeScript sources
directly and needs Node ≥ 22.18 (or use `npx jinglescript …` with the package):

```sh
yarn install
node src/cli.ts check examples/hatena-marumo-a.json
node src/cli.ts render examples/hatena-marumo-a.json -o out/opening.wav
#   writes out/opening.wav and out/opening.timing.json
node src/cli.ts demo ukulele -o out/   # hear a sound across its range (or an effect's variants)
node src/cli.ts instruments            # every instrument and sound effect
node src/cli.ts guide                  # how to write a score (for LLMs)
node src/cli.ts schema                 # the JSON Schema (also in schema/jinglescript-1.json)
node src/cli.ts notation examples/learn-happy-birthday.json -o out/birthday.musicxml
#   the score as sheet music, for MuseScore and the like
```

The `learn-*` examples are short lessons written for sheet music: the C major scale with its
solfège, note values from quarters to triplets, Twinkle Twinkle and Happy Birthday on a piano
grand staff, and Row, Row, Row Your Boat in 6/8.

`examples/piano/` holds fifteen full-length public-domain piano pieces (Debussy, Chopin, Liszt,
Beethoven, Rachmaninoff, Schubert, Satie, Tchaikovsky, Joplin) written for `grandpiano` — what a
2–7 minute score looks like.
They are in the repository only, not the npm package; see [examples/piano/README.md](examples/piano/README.md).

## Use it from Claude (MCP)

`jinglescript mcp` is an MCP server with a single tool, **`manageJingleScript`**. Its `action`
says what to do: `getGuide`, `getSchema`, `listInstruments`, `getInstrument`, `checkScore`,
`renderScore`. Rendered files go to the folder given by `--out` (default `out/jinglescript`).
`checkScore` and `renderScore` take the score inline (`score`) or as a file (`path`: a `.json`
file, relative to the directory the server runs in or absolute), so a long score need not travel
in the tool call; renders are then named after the file.
`renderScore` answers with a summary of the timing map (tempo, duration, cues, `audibleUntil`,
notes per track) and the path of the full `timing.json`; pass `includeTiming: true` to get every
beat, note and lyric in the answer too. A score written for sheet music (one with a `meter`,
`key` or `pickup`, or rendered with `view: "notation"`) also gets a `.musicxml` file next to the
audio.

Claude Code:

```sh
claude mcp add jinglescript -- npx -y jinglescript mcp --out /path/to/renders
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "jinglescript": {
      "command": "npx",
      "args": ["-y", "jinglescript", "mcp", "--out", "/path/to/renders"]
    }
  }
}
```

Then ask for a jingle in a sentence ("a 5-second ukulele opening that lands on a hit at 1.5 s").

## Use it from Claude Code (skill)

`skills/jinglescript/SKILL.md` is a Claude Code skill that needs no MCP setup: it reads the
guide, writes the score to `jingles/<name>.json`, runs `npx -y jinglescript check` until it
passes, and renders with `npx -y jinglescript render`. Install it for yourself:

```sh
mkdir -p ~/.claude/skills/jinglescript
curl -fsSL https://raw.githubusercontent.com/receptron/jinglescript/main/skills/jinglescript/SKILL.md \
  -o ~/.claude/skills/jinglescript/SKILL.md
```

(or copy it into a project's `.claude/skills/jinglescript/`). Then ask Claude Code for a jingle.
The skill runs the latest published `jinglescript` through npx, as the MCP setup above does; to stay
on one version, replace `npx -y jinglescript` in it with `npx -y jinglescript@<version>`, and install
the file from that release's tag instead of `main`.

## Put it on a video

[docs/video-sound-effects.md](docs/video-sound-effects.md) walks through adding footsteps, bonks and
a jingle to two shots of *Big Buck Bunny* (CC BY) with ffmpeg: find the moments, name them as cues,
render, mix, and check the frames line up; then burn in telops on cues and karaoke captions from the
lyrics, with ffmpeg's ASS subtitles.

## Make a music video

[`tools/music-video`](tools/music-video/README.md) renders a score into a 3D music video synced to every note (Three.js + headless Chrome + ffmpeg). Design an original scene for each video; the bundled `crystal-stair` scene is only an example of the scene contract.

## Hear it in a GUI chat (GUI Chat Protocol)

`gui-plugin/` is a [GUI Chat Protocol](https://github.com/receptron/gui-chat-protocol) plugin with the same tool,
`manageJingleScript`, for hosts such as MulmoTerminal and MulmoClaude. A rendered jingle opens in a
**player view**: waveform, beats, named cues you can click to jump to, and a lane of notes per
track, with downloads of the audio and of the music as MIDI. For teaching, the same view shows
**sheet music** with a cursor following playback: `renderScore` takes `view: "notation"` (or
`"waveform"`, the default), `autoplay: true` to start playing as the card appears, and
`notifyWhenDone: true` to have the view tell the LLM, in one chat message, when the user has
heard it to the end — so a lesson can go on by itself. See [gui-plugin/README.md](gui-plugin/README.md) for adding it to a host.

## Library

```ts
import { parseScore, render, loadSamples, toWav, checkScore, getSchema, getAuthoringGuide } from "jinglescript";

const score = parseScore(json); // zod-validated; throws with every problem, each with a path and a hint
const samples = await loadSamples(score); // grandpiano's recordings (cached; nothing when it is not used)
const { audio, sampleRate, timing } = await render(score, { samples }); // audio: [left, right] Float32Array
await writeFile("out/jingle.wav", toWav(audio, sampleRate));
await writeFile("out/jingle.timing.json", JSON.stringify(timing, null, 2));
```

`render` returns a Promise and never touches the network. In Node it renders on a worker thread,
so a long piece, or a vocal sung by NEUTRINO, never blocks your event loop (a server keeps
answering); the audio is the same, bit for bit, as rendering in place. `loadSamples` fetches what
a score's `grandpiano` notes play (or reads it from the cache; `{ download: false }` keeps it
offline).
`renderToFiles(score, dir, stem)`, the CLI and the MCP tool do this for you.

`scoreToMidi(score)` gives the music as a Standard MIDI File (`Uint8Array`, type 1) to edit in a
DAW or notation program: a track per score track, at the times the audio plays them, with General
MIDI sounds for the built-ins (claps, knocks, the clock and impacts on the drum channel; the
pistol as Gunshot). A custom instrument gets its base's sound. Effects with no General MIDI sound
(whoosh, riser, laser, pop, footsteps, heels, tap dance) are markers named after the effect;
cues are markers, lyrics are lyric events. Pitches are as they sound (a glockenspiel's written C5
is C6).

`scoreToMusicXml(score)` gives the music as sheet music (MusicXML 4.0, a string), and
`scoreToNotation(score)` the bars, notes and rests it is written from, with a warning (and the
note's path) for every time it had to round onto the grid and every note it had to shorten. A score
sets its `meter`, `key` and `pickup` for this; they never change the sound. Times are rounded to
32nd notes and triplets, a note without `len` is written up to the next one, one staff holds one
line of notes, a piano's right and left hand share a grand staff, chords written by name are
spelled from their root and print their symbol, lyrics go under their notes, and sound effects are
left off.

For LLMs and agents: `getSchema(part?)`, `getAuthoringGuide()`, `listInstruments()`,
`getInstrument(name)` and `checkScore(json, { notation? })` (never throws; returns errors with JSON
paths and hints, plus the resolved cue times; with `notation: true`, or for a score with a `meter`,
also what the sheet music would round or shorten).

### In the browser

`jinglescript/browser` is the same library without the parts that need Node (files, ffmpeg, the
MCP tool): parse and check, `render`, `toWav`, `scoreToMidi`, `scoreToMusicXml`, the timing map,
and the API for LLMs.
It renders in the page, with no server, to the same bit-identical audio. There `render` works on
the page's own thread (its Promise resolves when it is done); run it in a Web Worker to keep a long
render from holding up the page.

```ts
import { parseScore, render, loadSamples, toWav } from "jinglescript/browser";

const score = parseScore(json);
const samples = await loadSamples(score); // only when it plays grandpiano or a recorded effect
const { audio, sampleRate, timing } = await render(score, { samples });
const context = new AudioContext({ sampleRate });
const buffer = context.createBuffer(2, audio[0].length, sampleRate);
audio.forEach((channel, i) => buffer.copyToChannel(channel, i));
// play `buffer`, or offer toWav(audio, sampleRate) as a download
```

The browser's `loadSamples` fetches what the score plays:

- `grandpiano`: the first 4.5 s of each VCSL recording it plays, through jsDelivr's GitHub mirror
  (GitHub's raw server refuses a browser's ranged request), checked against the same SHA-256 as in
  Node, and kept in the page's Cache API (`cache`), so a piece is downloaded once.
- Recorded sound effects: from `sfxBaseUrl`, by default this version of the package on jsDelivr
  (`https://cdn.jsdelivr.net/npm/jinglescript@<version>/samples/sfx/`). Serve `samples/sfx/` yourself
  and pass its URL to keep the page off the CDN. These have no checksum, so they are left to the
  browser's HTTP cache.

Options: `sfxBaseUrl`, `pianoBaseUrl`, `cache` (a Cache API name, or `false`), `onDownload`,
`seed`, `fetch`. Audio is WAV only (MP3 and OGG need ffmpeg).

## How to write a jingle

This section is the authoring guide an LLM gets from `jinglescript guide`, `getAuthoringGuide()`
or the MCP action `getGuide`; it is generated from `src/guide.ts` (`npm run readme`).

<!-- guide:start -->

A JingleScript score is JSON (format "jinglescript/1") describing a short piece of music — a
jingle, a song (played, or sung with `sing`), an exercise shown as sheet music — and sound
effects, plus named **cues** an animation syncs to. Get the exact schema with getSchema() /
`jinglescript schema` / the MCP action `getSchema`; check your score
with checkScore() / `jinglescript check` / the MCP action `checkScore`, and fix every error it
reports before rendering. A long score is easier to keep in a `.json` file: write it there and
pass `path` to `checkScore` / `renderScore` instead of the score itself.

### Work in this order (a jingle for a video)

For a song see **Songs and melodies** below; for a lesson, **Sheet music**.

1. **Cues first.** Write down the moments the video needs, in seconds, as cues:
   `"cues": { "hit": { "seconds": 1.5 }, "voice": { "seconds": 1.8 } }`. Never convert seconds to
   beats yourself — give cues in seconds and place notes on them. Every time the request
   mentions (a start, a landing, a logo, a cut) becomes a cue, even when it happens to fall on a
   beat: the animation reads cues, not notes.
2. **Tempo and length.** 100–140 BPM suits most jingles. `length` is the whole audio; leave
   1–3 s after the last note for it to ring out, more if a voice-over follows.
3. **Music on the cues.** Place the big moment exactly on its cue (`"at": "hit"`), and the lead-in
   before it on the beat grid (`"at": 0`, `0.5`, `1` … in beats) or relative to the cue
   (`"at": "hit-1"` = one beat before, `"hit+0.5"` = half a beat after).
4. **Check, fix, render.**

### Time

- `at` as a number is **beats** from the start (one beat = a quarter note at `tempo`; 0.5 is an
  eighth note, 0.25 a sixteenth).
- `at` as `{ "seconds": 0.86 }` is clock time, for a note the animation pins to a moment.
- `at` as a cue name is that cue's time; `"cue+n"` / `"cue-n"` offsets it by n beats.
- `repeat` plays a note again every `every` beats, `count` times in total or `until` a time:
  `{ "at": 0, "repeat": { "every": 1, "until": "hit" } }`.

### Notes and chords

- `pitch` is "C4" (middle C), "F#3", "Bb5"; a list is a chord: `["C5", "E5", "G5"]`.
- `vel` 0–1 is how hard: 0.8 normal, 1.0 for the hit, 0.3–0.4 for a soft echo.
- Several tracks play together. Put the melody and the bass on separate tracks (even with the same
  instrument), each with its own `gain` (dB) and `pan` (0 left … 1 right).

### Chords and strums

- Write a chord by name with `chord` instead of `pitch`: "C", "Am", "G7", "Fmaj7", "Bb", "F#m7",
  "Dsus4". The instrument voices it — on the **ukulele** you get the real chord shape (C = 0003,
  F = 2010, G7 = 0212), on other instruments the chord stacked from octave 4. Use `pitch` lists
  when you want exact notes.
- `strum` plays a chord string by string, ~15 ms apart, slightly loose like a real hand (seeded,
  so the same score always sounds the same). `"down"` or `"up"` for one stroke, or a pattern
  with one character per eighth note: D down, U up, d/u soft, - rest.
  - `"D-DU-UDU"` — the classic island strum, one 4-beat bar.
  - `"D-D-D-D-"` — plain downstrokes on every beat.
  - `"D-DUD-DU"` — a busier pop strum.
  Write one note per bar with its chord and pattern; add `"repeat": { "every": 4, "count": 2 }`
  to keep the same chord for two bars.
- End on a single stroke: `{ "at": "end", "chord": "C", "strum": { "pattern": "down", "spread": 25 } }`
  (a slower, wider final strum). A stroke placed on a cue starts exactly on it.

#### Example: island strum on ukulele

```json
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
```

### Instruments

Every instrument and its range is listed in the schema (`tracks[].instrument`) and by
listInstruments() / `jinglescript instruments`. Rules of thumb:

- **Struck and plucked** (marimba, xylophone, glockenspiel, vibraphone, musicbox, ukulele, clap) ring out on their own; `len` is ignored. **Sustained** (organ, piccolo, trumpet) hold each
  note until the track's next note unless you give `len` in beats.
- **grandpiano** is the piano: a recorded grand (range A0–A7). Its samples download on first use
  (about 1.2 MB per note), so its first render needs the network.
- **grandpiano has dampers**, like a real piano. Without `len` a note rings out (about 3 s). With
  `len` the key is held that long and the note stops when it ends — write it for staccato, short
  notes and rests. The track's `pedal` keeps released notes ringing until it lifts:
  `"pedal": [{ "at": 0, "until": 4 }, { "at": 4, "until": 8 }]`, a new stretch where the harmony
  changes. Striking a key again stops the note still ringing on it. A piece written for two hands
  on two tracks needs the pedal on both.
- **musicbox** and **piccolo** sound an octave above the written pitch.
- **piccolo** and **trumpet** sound synthetic; use them for a playful line, not for realism.
- **clap** takes no pitch. Use `repeat` for claps on every beat. The default is a drum-machine
  clap; `"variant"` can be "snappy", "hands" (one person) or "group" (a few people).
- A second instrument doubling the melody quietly adds colour: glockenspiel an octave up at
  `"gain": -6` over a marimba melody makes it sparkle.
- All instruments are balanced to the same loudness at the same velocity; use track `gain` to
  put one behind another.

### Sound effects

Effects go in tracks like instruments and land on cues exactly like notes; the timing map's `t`
is the start of the sound, so an animation frame on it lines up.

| Effect | Variants (first = default) | Notes |
|---|---|---|
| clock | tick, tock | `"variant": ["tick", "tock"]` with `repeat` for a ticking clock |
| footsteps | left, right, carpet, concrete, snow, wood | `"variant": ["left", "right"]`, `repeat` every 0.5–1 beat to walk; the surfaces are recorded steps (`"variant": "wood"` with `repeat`) |
| heels | left, right | high-heel steps; walk the same way |
| knock | door, table | "knock-knock": two notes about half a beat apart |
| tapdance | toe, heel, shuffle | |
| pistol | shot, cartoon | |
| laser | — | optional `pitch` = where the "pew" starts (default about D7); `len` = sweep length (default 0.25 s) |
| whoosh | soft, fast | `len` = length (default 0.5 s); place with `end` to finish on a cut |
| riser | noise, tone | builds into a hit: `{ "end": "hit", "len": { "seconds": 2 } }` (default 2 s) |
| impact | soft, hard | the boom a reveal lands on |
| pop | — | optional `pitch` = starting pitch (default about E6); things appearing, text popping in |
| ding | — | recorded: a struck bell; a correct answer, a reveal |
| glass | — | recorded: glasses clinking, a toast |
| metal | — | recorded: a light metal clang |
| punch | hit, soft | recorded: a punch or slap; "soft" is a thud onto a cushion |
| book | flip, place | recorded: a page turned; a book set down |
| door | close, creak | recorded: "creak" swells in over about 0.8 s; for knocking use knock |
| dice | throw, die, shake | recorded: dice thrown, one die, dice rattled (1.5 s) |
| cards | place, fan | recorded: "place" slides the card first, so it lands 0.1–0.15 s after the note |
| cloth | — | recorded: clothes rustling |
| applause | — | generated: a small audience clapping, fading out over about 5 s |
| shutter | — | generated: a camera shutter click |
| coin | — | generated: a coin dropped on a table, a clink and a short rattle |
| page | — | generated: one page turned slowly; softer and longer than book's "flip" |
| droplet | — | generated: one water drop into still water, a "plop" |

- `end` (instead of `at`) places an effect with a length by when it **finishes** — a riser or
  whoosh that stops exactly on the cut. `len` is beats, or `{ "seconds": n }` when the request
  gives seconds.
- checkScore lists where every note and effect resolved to (`timeline`), so you can confirm an
  effect placed by `end` starts where you meant.
- Close, dry effects (ticks, footsteps, taps) sound better outside the reverb: give their track
  `"reverb": false`.
- Short impulses (ticks, steps, taps, knocks) peak like an instrument note; other effects are as
  loud as instruments at the same velocity; put them under the music with track
  `gain` (-4 to -8 dB) unless they are the point.
- The recorded effects play real recordings; a variant with two recordings alternates between
  them at random (seeded), so a repeat does not sound the same every time.
- Big impacts are very peaky; a jingle with one may come out a little quieter than the loudness
  target (the renderer reports it).

### Custom instruments

When no built-in sounds right, define your own under top-level `"instruments"` and use its name
in a track like a built-in. Names start with a lowercase letter (`"softBell"`) and must not be a
built-in's. Three forms, from easiest to most flexible — use the first that does the job:

**1. Tweak a built-in** with `base` and any of: `params` (`decay`, `brightness`, `attack`),
`transpose` (semitones), `detune` (cents), `gain` (dB), `variant`.

```json
"instruments": {
  "softBell": { "base": "glockenspiel", "params": { "decay": 1.8, "brightness": -0.5, "attack": 0.01 } },
  "deepBoom": { "base": "impact", "variant": "hard", "params": { "brightness": -0.6 } }
}
```

- `decay` multiplies how long it rings: 0.5 half, 2 twice. Above 1 only for built-ins that have a
  block definition (marimba, xylophone, glockenspiel, vibraphone, musicbox, ukulele, organ).
- `brightness` -1 (dark, muffled) … 1 (bright, crisp). `attack` seconds of fade-in: 0.02–0.08
  softens the strike, 0.2+ swells in.

**2. Layer** 2–6 sounds that play together on every note; each layer takes the same fields as a
tweak, plus `delay` (seconds after the onset). Give the note a chord as usual: pitched layers
play every pitch of it, layers without pitch (an impact, a clap) play once.

```json
"bigHit": { "layers": [
  { "base": "grandpiano" },
  { "base": "impact", "variant": "soft", "gain": -8 },
  { "base": "glockenspiel", "transpose": 12, "gain": -12 }
] }
```

**3. Build from blocks.** Sources are mixed: `osc` (sine, triangle, saw, square, pulse at a
`ratio` of the note), `modes` (struck partials: bars, bells), `noise` (clicks, breath, hiss),
`string` (a plucked string). Shapers act on the whole sound: `env`, `filter`, `pitchEnv` (a
pitch glide), `lfo` (vibrato or tremolo). Every time is in seconds; `decay` means "seconds until
silent".

```json
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
```

- `env` with `sustain` 0 is struck (rings out over `decay`); `sustain` above 0 holds for the
  note's `len` like the organ. A source with its own `env` ignores the whole sound's.
- `"kind": "sfx"` makes a sound effect: `pitch` is the default when a note gives none; `length`
  makes it last `len` (default `length` seconds) and lets notes be placed by `end`.
- getInstrument("marimba") (and the other block built-ins) shows the built-in as blocks: copy it
  and change ratios, decays or the click to make a relative of it.
- You do not set levels: every custom sound is balanced against the marimba, and the engine keeps
  it clean (no aliasing, clicks, DC or runaway levels). Use track `gain` or layer `gain` to mix.

### Lyrics

Words can ride on the melody, so a player shows them karaoke-style: the current line, the next
one, and a wipe across each syllable as its note plays. The words are text on the notes, timed
exactly by them; the instrument plays the melody, unless the track has `sing` (see **Songs and
melodies**), which sings them.

- Put `lyric` on each melody note: one syllable per note. In Japanese one mora (`"ハ"`,
  `"テ"`, `"ナ"`; a contracted sound such as `"きょ"` is one mora, one note); in English one
  syllable, ending in `-` when the word continues on the next note (`"hap-"`, `"py"` shows as
  "happy"). Words are spaced for you, except between Japanese syllables.
- `"lyric": "_"` holds the previous syllable over this note too (one syllable sung over two
  notes).
- Notes without `lyric` may sit among them on the same track (an instrumental fill, an echo
  after the hit); they show no text.
- When a word should land on a cue, put its stressed syllable there (`"day"` of "today" on
  `"hit"`, `"to-"` half a beat before).
- `"lineEnd": true` on the last syllable of a line starts a new line after it. Keep lines short:
  one phrase of the melody, 2–4 seconds.
- The melody comes first, the words go onto its notes. Count the syllables and check that the
  melody has a note for each (plus any `"_"`); when it has too few, split a note (a quarter into
  two eighths) or add a pickup — don't build the melody as one note per syllable on an even beat.
  A chord takes one lyric; percussion and effects take none; a note with `repeat` takes none
  (write the notes out).
- checkScore lists each line with its time (`lyrics`), so you can confirm the words land where
  the request wants them.

```json
{ "instrument": "marimba", "name": "melody", "notes": [
  { "at": 0, "pitch": "G4", "lyric": "ハ" },
  { "at": 0.5, "pitch": "C5", "lyric": "テ" },
  { "at": 1, "pitch": "E5", "lyric": "ナ" },
  { "at": 1.5, "pitch": "D5", "lyric": "_" },
  { "at": 2, "pitch": "G5", "lyric": "good" },
  { "at": 3, "pitch": "E5", "lyric": "mor-" },
  { "at": 3.5, "pitch": "C5", "lyric": "ning!", "lineEnd": true }
] }
```

### Songs and melodies

A song needs a melody someone would hum: a shape, a rhythm and a goal. An LLM writing notes one
after another drifts into the easiest next step — the neighbouring scale note, on the next beat —
and the result runs up and down the scale in even notes. Decide the melody before you write any
JSON.

**A song the user names** (a nursery song, a folk song, a hymn): play its real melody — its
pitches, its rhythm, its meter, key and pickup — as the song goes. Never make one up and present
it as that song. Write it only when you know it note by note, or have it as note names (ドレミ,
solfège, "E E F# …", ABC or MusicXML) from the user or from a page that spells them out. A web
search for the song mostly finds lyrics and pages whose sheet music is an image or a PDF, which
gives no notes. When you can't get the notes, say so, and ask the user for them or offer an
original song with the same words.

**A new melody.** Plan it in words first, then write the notes:

- **Phrases.** 2 or 4 bars each; a song of 8 or 16 bars is two or four phrases. End a phrase on a
  long note (a half note or longer) and leave a rest before the next one (a breath, when sung).
  The first phrase ends open (on the 2nd, 5th or 7th degree, over the V chord); the last ends on
  the key note over the I chord.
- **A motif.** 3–5 notes with a rhythm of their own (e.g. two eighths and a dotted quarter).
  Repeat it, move it up a step or a third (a sequence), change its ending — most of a song is its
  motif again, changed. Phrase pairs often go A A' (same start, different ending).
- **Steps and leaps.** Mostly steps, with a leap of a 3rd to a 6th in most bars; after a big leap,
  step back the other way. Don't run more than 4–5 notes by step in one direction. Repeat a note
  sometimes. Put the highest note once, about two-thirds of the way in.
- **Rhythm.** Mix lengths: eighths for quick words, quarters, dotted rhythms, long notes at phrase
  ends. A song in all equal notes is a scale exercise, not a song.
- **Harmony.** Choose the chords first, one or two per bar (I, IV, V, vi …). The melody's notes on
  the strong beats belong to the chord; notes between them pass by step. Play the chords on an
  accompaniment track, so the melody sits on harmony.
- **Words.** Put stressed syllables on strong beats. In Japanese, let the pitch follow the word's
  accent where it can (はし "chopsticks" falls, はし "bridge" rises).
- **Range.** About an octave, C4–D5 or so for singing; a melody that stays inside a fifth sounds
  like an exercise.

**Singing.** `"sing": { "engine": "neutrino" }` on the melody track sings its `lyric`s with the
user's NEUTRINO (`"voice"`: a voice they have installed, e.g. "reina" (the default), "merrow"; `"level"`: dB above the accompaniment, default 4). Only one track sings; its
lyrics are kana, one mora per note (`"_"`/`"ー"` holds the vowel). Start the first sung note
a beat or more after the start (the consonant comes before the note), give every note its `len`
and leave rests between phrases to breathe. The other tracks accompany it.

```json
{
  "format": "jinglescript/1",
  "title": "あさのひかり",
  "tempo": 96, "meter": "4/4", "key": "C",
  "length": { "beats": 17 },
  "tracks": [
    { "instrument": "organ", "name": "voice", "sing": { "engine": "neutrino" }, "notes": [
      { "at": 1, "pitch": "E4", "len": 0.5, "lyric": "あ" }, { "at": 1.5, "pitch": "G4", "len": 0.5, "lyric": "さ" },
      { "at": 2, "pitch": "C5", "len": 1.5, "lyric": "の" }, { "at": 3.5, "pitch": "B4", "len": 0.5, "lyric": "ひ" },
      { "at": 4, "pitch": "A4", "len": 1, "lyric": "か" }, { "at": 5, "pitch": "G4", "len": 2, "lyric": "り", "lineEnd": true },
      { "at": 9, "pitch": "F4", "len": 0.5, "lyric": "そ" }, { "at": 9.5, "pitch": "A4", "len": 0.5, "lyric": "ら" },
      { "at": 10, "pitch": "D5", "len": 1.5, "lyric": "に" }, { "at": 11.5, "pitch": "C5", "len": 0.5, "lyric": "う" },
      { "at": 12, "pitch": "B4", "len": 0.5, "lyric": "た" }, { "at": 12.5, "pitch": "D5", "len": 0.5, "lyric": "お" },
      { "at": 13, "pitch": "C5", "len": 2, "lyric": "う" }
    ] },
    { "instrument": "vibraphone", "name": "chords", "gain": -4, "notes": [
      { "at": 0, "chord": "C", "len": 4 }, { "at": 4, "chord": "G", "len": 4 },
      { "at": 8, "chord": "Dm", "len": 4 }, { "at": 12, "chord": "G7", "len": 1 }, { "at": 13, "chord": "C", "len": 3 }
    ] }
  ]
}
```

Two phrases on one motif (a rising leap E–G–C, then down by step): the first ends open on G over
G, the second takes the motif a step higher (F–A–D) and lands on C.

### Sheet music (teaching and reading music)

A score can also be shown as sheet music, for a lesson: a scale, a rhythm, a song to sing along to.
The score only needs the fields below; how the player shows it is chosen **in the renderScore call,
not in the score**: `{ "action": "renderScore", "score": { … }, "view": "notation", "autoplay": true,
"notifyWhenDone": true }`. `"view": "notation"` shows the notes on staves with a cursor that
follows playback; `"autoplay": true` starts it by itself; `"notifyWhenDone": true` sends you a
message when the user has heard it to the end, so you can ask about it or go on to the next
exercise. Say what to listen for before renderScore, and say nothing while it plays: speech over
the music drowns it out. In a voice chat the player waits until you have answered the render and
fallen quiet; `"autoplayDelay": n` makes it wait n seconds after it appears instead. The sound is the same either way: sheet music is drawn from the score you
wrote.

- Set `"meter"` ("4/4", "3/4", "2/4", "6/8") and `"key"` ("C", "G", "F", "D", "Bb", "Am", "Em" …).
  They only change the page; still write every note's real pitch ("F#4" in G major, "Bb4" in F).
- `"pickup": n` when the tune starts before the first full bar ("Hap-py" of Happy Birthday is a
  pickup of 1 beat in 3/4; many songs start this way). Bar lines fall at pickup, pickup + a bar, …
- For a triplet, `len` is a third of the beat it shares (0.333 for a triplet eighth). Triplets are
  written in 2/4, 3/4, 4/4 and 2/2, filling a quarter note (don't mix 0.25 and 0.333 within one);
  6/8 has none.
- Time in beats (quarter notes), on the grid: whole beats, halves, quarters (0.25), eighths of a
  beat, or triplets (12, 12.333, 12.667). Use a tempo and plain beat numbers rather than seconds
  or cues. In 6/8 a bar is still 3 beats: six eighths are 0.5 beats each.
- Give every note its written length with `len` in beats (1 a quarter, 2 a half, 1.5 a dotted
  quarter, 0.5 an eighth). Without it a note is written up to the next one.
- One line of notes per track: a melody track and an accompaniment track. Chords (`pitch` lists)
  are fine; notes that overlap at different times are not (the later one cuts the earlier).
- Piano music: a "right hand" and a "left hand" track, both `grandpiano`, side by side, become
  one grand staff. A track mostly below A3 gets a bass clef (or set `"clef"`).
- `lyric`s are printed under their notes. A chord written by name (`chord`) prints its symbol
  above the staff.
- Sound effects are never drawn; `"notation": false` on a track leaves it off the page too.
- checkScore with `"view": "notation"` warns about notes off the grid or held into the next note;
  fix them so the page shows what you meant.

```json
{
  "format": "jinglescript/1",
  "title": "Twinkle, Twinkle (first line)",
  "tempo": 100, "meter": "4/4", "key": "C",
  "length": { "beats": 10 },
  "tracks": [
    { "instrument": "grandpiano", "name": "right hand", "notes": [
      { "at": 0, "pitch": "C4", "len": 1, "lyric": "Twin-" }, { "at": 1, "pitch": "C4", "len": 1, "lyric": "kle" },
      { "at": 2, "pitch": "G4", "len": 1, "lyric": "twin-" }, { "at": 3, "pitch": "G4", "len": 1, "lyric": "kle" },
      { "at": 4, "pitch": "A4", "len": 1, "lyric": "lit-" }, { "at": 5, "pitch": "A4", "len": 1, "lyric": "tle" },
      { "at": 6, "pitch": "G4", "len": 2, "lyric": "star" }
    ] },
    { "instrument": "grandpiano", "name": "left hand", "gain": -4, "notes": [
      { "at": 0, "pitch": ["C3", "G3"], "len": 4 },
      { "at": 4, "pitch": ["F2", "C3"], "len": 2 },
      { "at": 6, "pitch": ["C3", "G3"], "len": 2 }
    ] }
  ]
}
```

### What makes a jingle work

- A **question and an answer**: three rising notes that end open (e.g. G4 C5 E5 on eighths), then
  a short answer that resolves.
- **The hit**: a full chord (C5 E5 G5 C6) with a low bass (C3 + G3) on a separate track, at velocity
  1.0, exactly on the cue the animation lands on.
- Keep the notes short: about 2 s of notes is plenty for a 5 s sting. After the hit, one soft
  echo note (vel 0.35, an octave up) at most; leave the tail for the voice-over.
- Stay in one key; major keys and the pentatonic scale sound friendly. (This is for a short
  sting; a song needs more — see **Songs and melodies**.)

### Example

```json
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
```

### Output

`title`, `author` and `copyright` (all optional) are written into the audio file's tags
(WAV, MP3, OGG) and the MIDI file. Fill in `author` and `copyright` only with what the user
gave you — never invent a name, a company or a year.

Rendering gives audio and a timing map (`jinglescript-timing/1`): every cue, beat and note in
seconds, `audibleUntil`, and — when the score has lyrics — every line and syllable with its
time (`lyrics`). The animation reads cue times from it by name.

<!-- guide:end -->

## Singing (NEUTRINO)

A track with `"sing": { "engine": "neutrino", "voice": "reina", "level": 4 }` is sung, from its notes'
kana `lyric`s, by [NEUTRINO](https://studio-neutrino.com/) installed by you, through the ordinary `render()`, CLI and MCP — the score alone decides; there is no
separate API (Node only; the browser build throws `SingerUnavailableError`). It is looked for in `/Applications/NEUTRINO`, or where `NEUTRINO_DIR` in a
`.env` file in the project directory (or the environment) says. `level` is the vocal's loudness over
the other tracks in LU (default 4); the track's `gain` adds to it. A missing NEUTRINO or voice is an
error, never a silent fallback. Details (in Japanese): [docs/singing-neutrino.md](docs/singing-neutrino.md).

## Licence

MIT — except the score files in `examples/piano/`, which carry their own CC BY 4.0 or
CC BY-SA 4.0 licence ([examples/piano/README.md](examples/piano/README.md)).
