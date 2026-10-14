# Sound effects and a jingle on a real video

JingleScript does not read video. It writes audio plus a **timing map**, and ffmpeg puts that
audio on the video. Instead of nudging sounds by ear, you name the moments in the video as
**cues** (in seconds), place each sound on its cue, and the sounds land on those frames.

This walk-through adds footsteps, a whoosh on a cut, four "bonks" ending in a metal clang, and a
short xylophone jingle to two shots of *Big Buck Bunny*. You need Node 22.12 or newer and ffmpeg.
Every command runs from the root of a clone of this repository.

## 1. Get the video

*Big Buck Bunny* is © Blender Foundation, www.bigbuckbunny.org, released under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/): you may use and change it as long as
you credit it. Neither the video nor anything made from it goes into this repository; `out/` is
git-ignored.

```sh
mkdir -p out/bbb/source
curl -fL -o out/bbb/source/bbb.zip \
  https://download.blender.org/peach/bigbuckbunny_movies/BigBuckBunny_320x180.mp4.zip
unzip -o out/bbb/source/bbb.zip -d out/bbb/source   # BigBuckBunny_320x180.mp4, 320×180, 24 fps
```

## 2. Find the moments

A contact sheet of frames with their timestamps shows where things happen. Start with one frame
every 2 s for a minute of the film:

```sh
mkdir -p out/bbb/sheets
ffmpeg -ss 120 -t 60 -i out/bbb/source/BigBuckBunny_320x180.mp4 \
  -vf "fps=1/2,scale=160:90,drawtext=text='%{pts\:hms\:120}':x=2:y=2:fontsize=12:fontcolor=yellow:box=1:boxcolor=black@0.6,tile=6x5" \
  -frames:v 1 out/bbb/sheets/min2.png
```

Then zoom in on a candidate at the frame rate (`fps=24`, a shorter `-t`) until you can see the
exact frame something lands. This example uses two shots:

| shot | in the film | what happens |
|---|---|---|
| walk | 1:52.5 – 1:58.0 | the bunny walks away across the meadow, about a step every 0.5 s |
| bonks | 2:53.5 – 2:57.5 | nuts hit his head at 2:54.625, 2:55.250, 2:55.583 and 2:55.833 |

Joined, they make a 9.5 s clip, so a moment's time **in the clip** is its time in its shot plus
the length of the shots before it: the cut is at 5.5 s, the first bonk at
5.5 + (174.625 − 173.5) = 6.625 s, and so on.

## 3. Write the score

[`docs/video/big-buck-bunny.json`](video/big-buck-bunny.json) names those moments as cues and puts
a sound on each:

- **cues** `cut` 5.5 s and `bonk1`–`bonk4` at 6.625, 7.25, 7.583, 7.833 s, in seconds, exactly as
  measured
- **footsteps** (`"variant": "carpet"`, soft enough for grass) every 0.5 s from 0.5 s, getting
  quieter (`vel` 0.9 → 0.3) as the bunny walks away
- **whoosh** with `"end": "cut"`, so it finishes on the cut rather than starting on it
- **knock** (`"variant": "table"`) on the first three bonks, **metal** (the "clang") on the last
- **xylophone**: a rising C–E–G at the start and a falling G–F♯–F one beat after the clang

Check it: every cue is printed with its time, so a mistyped number shows up here.

```sh
npx -y jinglescript check docs/video/big-buck-bunny.json
```

## 4. Render the sounds

```sh
npx -y jinglescript render docs/video/big-buck-bunny.json -o out/bbb/sfx.wav
```

This writes `out/bbb/sfx.wav` (9.5 s, the length of the clip) and `out/bbb/sfx.timing.json` with
the cue times.

## 5. Put them on the video

One ffmpeg command cuts the two shots out of the film, joins them, keeps the film's own sound at
30 % and mixes the effects over it. The `trim` / `atrim` times are the shots from step 2.

```sh
ffmpeg -i out/bbb/source/BigBuckBunny_320x180.mp4 -i out/bbb/sfx.wav -filter_complex "\
[0:v]trim=112.5:118,setpts=PTS-STARTPTS[v1];[0:a]atrim=112.5:118,asetpts=PTS-STARTPTS[a1];\
[0:v]trim=173.5:177.5,setpts=PTS-STARTPTS[v2];[0:a]atrim=173.5:177.5,asetpts=PTS-STARTPTS[a2];\
[v1][a1][v2][a2]concat=n=2:v=1:a=1[v][orig];[orig]volume=0.3[quiet];\
[quiet][1:a]amix=inputs=2:duration=first:normalize=0[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k \
  out/bbb/big-buck-bunny-sfx.mp4
```

To replace the film's sound instead of mixing under it, map the effects alone: drop the
`[0:a]…` parts and `amix`, and use `-map 1:a`.

## 6. Check that it lines up

Grab the frame at each cue; the nut should be touching the bunny's head in each bonk frame:

```sh
for t in 6.625 7.25 7.583 7.833; do
  ffmpeg -v error -y -ss $t -i out/bbb/big-buck-bunny-sfx.mp4 -frames:v 1 out/bbb/bonk-$t.png
done
```

Then watch it and listen. If a sound is early or late, change its cue in the score and render
again; the video command does not change.

## 7. Add telops and karaoke captions

The timing map that put the sounds on the frames can place text on them too. ffmpeg burns in
[ASS](https://github.com/libass/libass) subtitles (`-vf subtitles=…`; ffmpeg must be built with
libass, as Homebrew's and most Linux builds are), and
[`docs/video/make-captions.ts`](video/make-captions.ts) writes them from a timing map:

- **telops**: short captions that pop in on a cue, from a list like
  [`docs/video/big-buck-bunny-telops.json`](video/big-buck-bunny-telops.json)
  (`at` is a cue name or seconds, `hold` how long it stays);
- **karaoke**: when the score has lyrics, each line appears at its first syllable and fills syllable
  by syllable, each on its own note.

The script runs from a clone (Node 22.18 or newer runs it directly). Japanese needs a font that has
it: the default is macOS's `Hiragino Maru Gothic ProN`; elsewhere pass one you have, such as
`--font "Noto Sans CJK JP"`.

```sh
mkdir -p out/captions
node docs/video/make-captions.ts out/bbb/sfx.timing.json docs/video/big-buck-bunny-telops.json \
  > out/captions/big-buck-bunny.ass
ffmpeg -i out/bbb/big-buck-bunny-sfx.mp4 -vf "subtitles=out/captions/big-buck-bunny.ass" \
  -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a copy out/captions/big-buck-bunny-telops.mp4
```

"てくてく…" runs over the walk, "コツン!" pops on each knock and "ガチャン!!" on the clang.

Karaoke for a score with lyrics, here on a plain background:

```sh
npx -y jinglescript render examples/lyrics-hatena.json -o out/captions/lyrics.wav
node docs/video/make-captions.ts out/captions/lyrics.timing.json > out/captions/lyrics.ass
ffmpeg -f lavfi -i "color=c=0x1b2a4a:s=1280x720:r=30:d=6" -i out/captions/lyrics.wav \
  -vf "subtitles=out/captions/lyrics.ass" -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac -shortest \
  out/captions/lyrics-karaoke.mp4
```

The look (font size, colours, outline, position, the pop) is in the two `Style:` lines and the
telop's override tags in `captions.ts`; change them there. For captions that move more than ASS
can, the same timing map can drive a motion-graphics tool instead.

## The same idea on any video

- **One shot, one jingle**: render the jingle, read the cue from its timing map, and start the
  audio so the cue lands on the video's moment, with `adelay`:

  ```sh
  HIT=$(node -p 'require("./out/jingle.timing.json").cues.hit')   # e.g. 1.5
  MS=$(node -p "Math.round((6.0 - $HIT) * 1000)")                  # the hit lands at 6.0 s
  ffmpeg -i input.mp4 -i out/jingle.wav -filter_complex \
    "[1:a]adelay=${MS}|${MS}[j];[0:a]volume=0.5[v];[v][j]amix=inputs=2:duration=first:normalize=0[a]" \
    -map 0:v -map "[a]" -c:v copy -c:a aac out/with-jingle.mp4
  ```

- **Many effects on one video**: make the score as long as the video and give every moment a cue
  in seconds, as above; then mix the render over the video with no delay.
- An LLM can write the score: hand it the list of moments and the guide
  (`npx -y jinglescript guide`), or use the [Claude Code skill](../skills/jinglescript/SKILL.md).
