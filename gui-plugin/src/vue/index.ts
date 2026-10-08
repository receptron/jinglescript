// Vue entry (browser): the player view and the card preview. It does not load the library (which
// needs Node); the tool runs on the host's server through the core entry.
import type { ToolPlugin } from "gui-chat-protocol/vue";
import type { PlayerData } from "jinglescript";
import { TOOL_DEFINITION } from "../definition.ts";
import Preview from "./Preview.vue";
import View from "./View.vue";

export const plugin: ToolPlugin<PlayerData, never, object> = {
  toolDefinition: TOOL_DEFINITION,
  // Hosts run manageJingleScript on their server (the package's main entry); a browser-only host
  // has no way to render audio here.
  execute: () => Promise.resolve({ message: "manageJingleScript runs on the host's server (import the package's main entry there)." }),
  generatingMessage: "Rendering the jingle…",
  isEnabled: () => true,
  viewComponent: View,
  previewComponent: Preview,
};

export { View, Preview };
export default { plugin };
