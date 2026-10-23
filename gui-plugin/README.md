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

A score can also be passed as a file (`path` instead of `score`). The plugin reads it through the
host's `files.byPath` capability — the one presentDocument uses — so the host decides what a path
may reach and what a relative path is relative to. A host that does not provide `files.byPath` to
`manageJingleScript` gets an error asking for the score inline.

- **`"@gui-chat-plugin/jinglescript"`** (main entry, Node): `TOOL_DEFINITION`, `pluginCore`
  (`execute` renders on the host's server). The audio is embedded as a data URI — MP3 when ffmpeg
  is on the server, otherwise 16-bit WAV — so no file serving is needed.
- **`"@gui-chat-plugin/jinglescript/vue"`** (browser): `plugin` with `viewComponent` and
  `previewComponent`. It does not load the library. `opensheetmusicdisplay` is a dependency the
  host's bundler resolves (it is not bundled in), loaded on demand.

## Adding it to MulmoTerminal

The library is a peer dependency (the host's server runs the tool), so a host installs both:

1. `yarn add jinglescript @gui-chat-plugin/jinglescript`
2. `plugins/plugins.json`: add `"@gui-chat-plugin/jinglescript"` to `packages`.
3. `src/plugins-registry.ts`: import `plugin` from `@gui-chat-plugin/jinglescript/vue` and its
   `style.css?inline`, and add a `PACKAGES` entry (`viewOf(...)`, no runtime wrapper needed).
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
