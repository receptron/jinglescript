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

A score can also be passed as a file (`path` instead of `score`). The plugin reads it through the
host's `files.byPath` capability — the one presentDocument uses — so the host decides what a path
may reach and what a relative path is relative to. A host that does not provide `files.byPath` to
`manageJingleScript` gets an error asking for the score inline.

- **`"@gui-chat-plugin/jinglescript"`** (main entry, Node): `TOOL_DEFINITION`, `pluginCore`
  (`execute` renders on the host's server). The audio is embedded as a data URI — MP3 when ffmpeg
  is on the server, otherwise 16-bit WAV — so no file serving is needed.
- **`"@gui-chat-plugin/jinglescript/vue"`** (browser): `plugin` with `viewComponent` and
  `previewComponent`. It does not load the library.

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
npm install
npm run typecheck   # vue-tsc, against the library's source
npm test            # vitest, against the library's source
npm run build       # dist/: index.js (Node), vue.js + style.css (browser)
npm run definition  # regenerate src/definition.json from the library's zod schema
npm run demo-data && npm run demo   # a page with the player for three examples
```
