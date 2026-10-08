# @gui-chat-plugin/jinglescript

A [GUI Chat Protocol](../../protocol/spec/GUI_CHAT_PROTOCOL.md) plugin for JingleScript. It offers
the same single tool as the MCP server, **`manageJingleScript`** (actions `getGuide`, `getSchema`,
`listInstruments`, `getInstrument`, `checkScore`, `renderScore`), and adds a **player view**: a
successful `renderScore` returns the jingle as `data`, and the view plays it with its waveform,
beat grid, named cues (click one to jump there) and a lane of notes per track; effects with a
length (risers, whooshes) show as bars. Every other action answers the LLM in text and shows no
card.

- **`"@gui-chat-plugin/jinglescript"`** (main entry, Node): `TOOL_DEFINITION`, `pluginCore`
  (`execute` renders on the host's server). The audio is embedded as a data URI — MP3 when ffmpeg
  is on the server, otherwise 16-bit WAV — so no file serving is needed.
- **`"@gui-chat-plugin/jinglescript/vue"`** (browser): `plugin` with `viewComponent` and
  `previewComponent`. It does not load the library.

## Adding it to MulmoTerminal

1. Install it in MulmoTerminal (`npm install /path/to/jinglescript/gui-plugin` until it is
   published).
2. `plugins/plugins.json`: add `"@gui-chat-plugin/jinglescript"` to `packages`.
3. `src/plugins-registry.ts`: `import { plugin as jinglePlugin } from "@gui-chat-plugin/jinglescript/vue"`
   (and its `style.css?inline`) next to the other packages, and register it like them.

## Development

```sh
npm install
npm run typecheck   # vue-tsc, against the library's source
npm test            # vitest, against the library's source
npm run build       # dist/: index.js (Node), vue.js + style.css (browser)
npm run definition  # regenerate src/definition.json from the library's zod schema
npm run demo-data && npm run demo   # a page with the player for three examples
```
