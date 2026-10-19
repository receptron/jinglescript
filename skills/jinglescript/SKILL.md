---
name: jinglescript
description: Make a jingle, a short piece of music or a sound effect (audio plus a timing map for syncing animation) with the JingleScript CLI through npx. Use when the user asks for a jingle, an intro/outro sting, a notification sound, a sound effect track, or music that lands on given moments of a video ("a 5-second ukulele opening with a hit at 1.5 s").
---

# Make a jingle with JingleScript

JingleScript turns a JSON score into audio and a `timing.json` that says when each cue, beat and
note happens. You write the score; the CLI checks and renders it. Everything runs through
`npx -y jinglescript` (Node 22.12 or newer), so nothing needs to be installed or configured.

## Steps

1. **Read the guide once per session**, before writing a score:
   `npx -y jinglescript guide`. It is written for you: cues first, then tempo and length, then the
   music on the cues. For the exact format: `npx -y jinglescript schema`. For what can play:
   `npx -y jinglescript instruments` (and `npx -y jinglescript instruments <name>` for one).
2. **Turn the request into cues.** Every moment the user names (a logo, a hit, a cut, a voice-over
   start) becomes a cue in seconds. Ask only if the request gives no length at all.
3. **Write the score to a file**: `jingles/<short-name>.json` in the user's project (create `jingles/`
   if needed), unless they name another place. Pick a `<short-name>` whose `.json`, `.mp3`, `.wav`
   and `.timing.json` do not exist yet; ask before overwriting any file you did not write in this
   session. Fill `author` / `copyright` only with what the user gave; never invent them.
4. **Check until it passes**: `npx -y jinglescript check jingles/<short-name>.json`.
   Fix every error it prints (each has a JSON path and a hint), then check again. Do not render a
   score that fails the check.
5. **Render**: `npx -y jinglescript render jingles/<short-name>.json -o jingles/<short-name>.mp3`.
   MP3 needs ffmpeg; if the CLI says ffmpeg is missing, render `.wav` instead. The timing map is
   written next to the audio as `<short-name>.timing.json`.
6. **Report**: the audio file, the timing file, and each cue's time (the check prints them), plus
   the loudness line the render prints. Then ask the user to listen. You cannot hear the result:
   do not describe how it sounds. Change the score only on the user's listening feedback, then
   check and render again to the same files.

## Notes

- `grandpiano` and the recorded effects (ding, glass, door, dice, applause, coin, …) use recordings. The piano's
  are downloaded on first use (about 1.2 MB per note, cached in `~/.cache/jinglescript`), so the
  first render of a piano piece needs the network and takes longer.
- The same score and seed always render the same audio, so a change the user did not ask for is a
  change in the score.
- To hear an instrument across its range before choosing it:
  `npx -y jinglescript demo <instrument> -o jingles/demo/`.
- To try a score in the browser instead: https://receptron.github.io/jinglescript/ (paste the JSON).
