# JingleScript music video

Turn a JingleScript score into a 3D music video: the score is rendered to a WAV
plus `timing.json`, a deterministic Three.js scene draws any moment `t` on
request, headless Chrome captures it frame by frame, and ffmpeg muxes the MP4.

> **Design a new scene for every video.** `scenes/crystal-stair` is only an
> example of the scene contract and of useful techniques (bloom, reflections,
> note-synced physics). Don't reuse it as-is — if everyone renders the same
> scene, every video looks the same. Instead, the LLM proposes a few visual
> concepts for the piece, the user picks one, and the LLM writes a new
> `scenes/<name>/index.html`, using crystal-stair only as a reference.

![Crystal Stair over Still Water](docs/crystal-stair.jpg)

## Requirements

- Node.js **>= 22.12** (the repo CLI runs TypeScript directly)
- Google Chrome or Chromium (driven by `puppeteer-core`; no browser download)
- ffmpeg

| OS      | Install                                                                                              |
| ------- | ---------------------------------------------------------------------------------------------------- |
| macOS   | `brew install node ffmpeg` and `brew install --cask google-chrome`                                   |
| Windows | `winget install OpenJS.NodeJS.LTS Gyan.FFmpeg Google.Chrome`                                         |
| Linux   | `sudo apt install ffmpeg chromium` (Node 22 via [nodesource](https://github.com/nodesource/distributions) or nvm) |

Chrome is found automatically in its standard install location; otherwise set
`CHROME_PATH=/path/to/chrome`.

## Setup

```sh
yarn install                         # repo root: the JingleScript CLI
cd tools/music-video && yarn install # three (pinned) + puppeteer-core
```

## Workflow: still → clip → full

First write your own scene (see [Designing a theme](#designing-a-theme)) and
pass it with `--scene <name>`; the commands below use the default example scene.
Always look at a still first, then a short clip, and only then render the
whole piece (a full render can take a long time).

```sh
cd tools/music-video
node render.mjs list                                              # pieces in examples/piano
node render.mjs still ../../examples/piano/nocturne-op9-2.json --t 30
node render.mjs clip  ../../examples/piano/nocturne-op9-2.json --t 30 --seconds 15
node render.mjs full  ../../examples/piano/nocturne-op9-2.json --cut 60
```

Output goes to `out/music-video/` at the repo root (git-ignored):
`still-<t>.png`, `clip-<s>s.mp4`, `music-video.mp4`, and `data/`
(`score.json`, `music.wav`, `timing.json`, `notes.json`).

The audio is rendered once per score (about 45 s for a 3.5-minute piece on an
M2 Max); later runs with the same score, `--cut` and `--instrument` reuse
`data/music.wav`. Use a separate `--out` per piece or instrument to keep them
cached side by side.

| Option                       | Meaning                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `--t <s>`                    | still time / clip start                                                       |
| `--seconds <s>`              | clip length (default 15)                                                      |
| `--cut <s>`                  | trim the score to its first `s` seconds, with a fade-out                      |
| `--instrument <name>`        | play every track on another instrument (see below)                            |
| `--w`, `--h`, `--fps`        | resolution and frame rate (default 1920×1080, 30)                             |
| `--cpu`                      | software rendering (SwiftShader) instead of the GPU                           |
| `--workers <n>`              | parallel capture browsers (frames are independent, so they split cleanly)     |
| `--scene <dir>`              | scene under `scenes/` (default `crystal-stair`)                               |
| `--cfg '<json>'`             | look parameters, e.g. `--cfg '{"exposure":2.2,"bloom":0.5}'`                  |
| `--title`, `--subtitle`      | override the on-screen title / composer                                       |
| `--out <dir>`                | output directory                                                              |

### Choosing a piece

Any `examples/piano/*.json` works (`node render.mjs list` prints file, length,
title and composer), as does your own score. The title and composer shown on
screen come from the score's `title`: a trailing `(Composer)` is moved to the
subtitle and expanded (e.g. `Liszt` → `Franz Liszt`); otherwise the composer is
looked up from the title. Use `--title`/`--subtitle` to override.

### Choosing an instrument

The scores play on `grandpiano`. `--instrument <name>` rewrites every track's
`instrument` before rendering. List the available instruments with:

```sh
node src/cli.ts instruments   # from the repo root
```

When swapping, pedals are dropped (only `grandpiano` has dampers) and notes
outside the instrument's range are moved by octaves into it.

## How the timing is used

`node src/cli.ts render score.json -o music.wav` also writes
`music.timing.json`, the exact onset (seconds) of every note. `timing.json` has
no durations, so `notes.json` joins each onset with the score note's
`len.seconds` (default 0.5 s) — that drives how long a light glows. The scene
reads `data/timing.json` and `data/notes.json` and computes everything
analytically from `t`, so any frame can be drawn in any order.

## Designing a theme

The look is decided per video, in conversation: propose a few visual concepts
for the piece, pick one, write it as a scene, then iterate with stills, a short
clip, and finally the full render. Write a new `scenes/<name>/index.html`
for each video. `crystal-stair` (glowing stair spiral over reflecting water,
one step per pitch) is only a reference for the contract and techniques; copy
ideas from it, not the whole look.

### Scene contract

A scene is a directory `scenes/<name>/index.html`, served with:

- `/vendor/three/…` → the pinned `three` package (use an import map:
  `"three": "./vendor/three/build/three.module.js"`,
  `"three/addons/": "./vendor/three/examples/jsm/"`)
- `/data/…` → `timing.json`, `notes.json` (`{title, subtitle, notes:[{t, m, vel, len}]}`)
- URL params `cfg`, `title`, `subtitle`, `fadeEnd`

It must:

1. Initialise from the timing (`init(timing)`: load data, build the scene) and
   then set `window.ready = true` and `window.DURATION` (seconds).
2. Expose `window.renderFrame(t)` that draws time `t` deterministically
   (no clocks, no randomness without a fixed seed, no state carried between
   frames).

### Look parameters (`crystal-stair`)

| Key        | Default | Effect                           |
| ---------- | ------- | -------------------------------- |
| `exposure` | 1.8     | tone-mapping exposure            |
| `bloom`    | 0.7     | bloom strength                   |
| `bloomR`   | 0.55    | bloom radius                     |
| `bloomT`   | 0.62    | bloom threshold                  |
| `aperture` | 0.0002  | depth-of-field aperture          |
| `maxblur`  | 0.006   | depth-of-field maximum blur      |
| `fog`      | 0.02    | fog density                      |
| `env`      | 0.3     | environment-light intensity      |
| `glow`     | 4.5     | emissive intensity of lit notes  |

## GPU vs CPU

By default Chrome uses the GPU (Metal on macOS, D3D11 on Windows); the WebGL
renderer is printed at start. On an Apple M2 Max a 1080p frame takes about
0.05 s. `--cpu` uses SwiftShader, which works anywhere but is roughly 1 frame
per second at 1080p — add `--workers` to use more cores.

## Credit

Scenes show a subtle “Powered by JingleScript” in the bottom-right corner.
Please keep it.

## Examples

Videos made with this pipeline are published on the [MulmoMusic YouTube channel](https://www.youtube.com/@MulmoMusic).
