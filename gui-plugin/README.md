# @gui-chat-plugin/jinglescript

A [GUI Chat Protocol](https://github.com/receptron/gui-chat-protocol/blob/main/spec/GUI_CHAT_PROTOCOL.md) plugin for JingleScript. It offers
the same single tool as the MCP server, **`manageJingleScript`** (actions `getGuide`, `getSchema`,
`listInstruments`, `getInstrument`, `checkScore`, `renderScore`), and adds a **player view**: a
successful `renderScore` returns the jingle as `data`, and the view plays it with its waveform,
beat grid, named cues (click one to jump there) and a lane of notes per track; effects with a
length (risers, whooshes) show as bars. When the score has lyrics, the view shows them
karaoke-style: the line being played and the next, each syllable filling in as its note plays.
The audio and the music as MIDI (the library's `scoreToMidi`) can be downloaded from the view;
the data also carries the score that was rendered. Every other action answers the LLM in text and shows no card.

**Sheet music, for teaching.** `renderScore` takes three options for the view:

- `view`: `"waveform"` (default) or `"notation"`: sheet music drawn by
  [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org/) from the library's MusicXML, with a
  cursor on the note being played and a bar to seek. A score that sets `meter`, `key` or `pickup`
  carries its sheet music either way, and the view offers a Waveform / Sheet music switch; the
  MusicXML can be downloaded. The renderer is loaded only when sheet music is shown.
- `autoplay: true`: the card starts playing when it appears. Only a fresh render does (one made in
  the last two minutes), and only once: the card remembers it in the result's `viewState`, so a
  chat reopened or replayed never plays old cards. When the browser wants a click first, the card
  says "Press play to listen". In a voice host that passes `isAudioPlaying`, it waits for the
  model's spoken answer to the render (up to 3.5 s after the card appears, or after the voice it
  appeared during), then until the voice has been quiet for 1.5 s, and pauses while the voice speaks
  again; once the user clicks play, the bar or a cue, the voice no longer pauses it.
- `autoplayDelay: n`: wait n seconds (0–30) after the card appears before playing by itself,
  instead of waiting for the answer; in any host.
- `notifyWhenDone: true`: when playback first reaches the end, the view sends the chat one message
  (`"<title>" finished playing (12.0 s): the user has heard it to the end.`) through the host's
  `sendTextMessage`, so the LLM can go on — ask a question, play the next exercise. Also
  remembered in `viewState`, so it is sent once. The view writes `viewState` through
  `onUpdateResult` with the whole result, as hosts expect.

**The card before the audio.** Rendering a long piece, or a vocal sung by NEUTRINO, takes seconds
to minutes. In a host that gives the view a runtime (`dispatch`) and tells `execute` so with
`deferredAudio: true` in its context, `renderScore` waits at most a second for the audio: a short
jingle comes back finished as before; a longer one comes back at once as a `pending` card that
shows the score, its lanes, cues, lyrics and sheet music, says "Rendering the audio…", and keeps
play disabled. The view collects the finished audio through the host's dispatch (a request that
reaches the same `execute`), saves it into the result with `onUpdateResult` (so the chat keeps it),
and only then plays. `autoplay` waits for the audio in the same way, and counts as fresh from when
it was ready; the voice rules above still apply. If the audio cannot be made after all, the card
says why and, for a fresh render, tells the LLM once. A render kept for collection lives in the
server's memory for 30 minutes after it finishes; a card replayed after a restart says it is gone.
A host that does not set `deferredAudio` gets the finished card, as before.

A score can also be passed as a file (`path` instead of `score`). The plugin reads it through the
host's `files.byPath` capability — the one presentDocument uses — so the host decides what a path
may reach and what a relative path is relative to. A host that does not provide `files.byPath` to
`manageJingleScript` gets an error asking for the score inline.

- **`"@gui-chat-plugin/jinglescript"`** (main entry, Node): `TOOL_DEFINITION`, `pluginCore`
  (`execute` renders on the host's server, on a worker thread, so the server keeps answering). The
  audio is embedded as a data URI — MP3 when ffmpeg is on the server, otherwise 16-bit WAV — so no
  file serving is needed.
- **`"@gui-chat-plugin/jinglescript/vue"`** (browser): `plugin` with `viewComponent` and
  `previewComponent`. It does not load the library. `opensheetmusicdisplay` is a dependency the
  host's bundler resolves (it is not bundled in), loaded on demand.

## Adding it to MulmoTerminal

The library is a peer dependency (the host's server runs the tool), so a host installs both:

1. `yarn add jinglescript @gui-chat-plugin/jinglescript`
2. `plugins/plugins.json`: add `"@gui-chat-plugin/jinglescript"` to `packages`.
3. `src/plugins-registry.ts`: import `plugin` from `@gui-chat-plugin/jinglescript/vue` and its
   `style.css?inline`, and add a `PACKAGES` entry. To show the card before a long render's audio,
   wrap the view in the runtime provider —
   `wrapWithPluginRuntime("jinglescript", plugin.toolDefinition.name, viewOf(...))` — and on the
   server add `manageJingleScript: { deferredAudio: true }` to `EXTRA_CONTEXT_BY_TOOL`
   (`server/infra/tools/plugins-registry.ts`). Do both or neither: `deferredAudio` without the
   runtime leaves a long render's card without its audio. With neither, `viewOf(...)` alone works
   as before.
4. `common/toolGroups.ts`: put `manageJingleScript` in the `media` group.
5. Rebuild the frontend (`yarn build`) and restart MulmoTerminal (the server loads plugins at boot).

## Development

```sh
yarn install
yarn typecheck   # vue-tsc, against the library's source
yarn test        # vitest, against the library's source
yarn build       # dist/: index.js (Node), vue.js + style.css (browser)
yarn definition  # regenerate src/definition.json from the library's zod schema
yarn demo-data && yarn demo   # a page with the player for three examples
yarn playground                # the GitHub Pages playground, rendering in the browser
yarn playground:build          # ../out/playground: what the Pages workflow deploys
```
