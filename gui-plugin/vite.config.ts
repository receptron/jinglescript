import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// Two entries: index (Node, the tool) and vue (browser, the view). The library, the protocol and
// Vue stay external, so the host provides them; so does the sheet-music renderer, which the view
// loads only when it shows sheet music. The protocol's subpaths too: the view injects the host's
// runtime by the protocol's own key (a Symbol), which a bundled copy would not match.
export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: { index: resolve(import.meta.dirname, "src/index.ts"), vue: resolve(import.meta.dirname, "src/vue/index.ts") },
      formats: ["es"],
      fileName: (_format, entry) => `${entry}.js`,
    },
    rollupOptions: {
      external: ["vue", "jinglescript", /^gui-chat-protocol(\/|$)/, "opensheetmusicdisplay", /^node:/],
      output: { assetFileNames: "style.[ext]" },
    },
    cssCodeSplit: false,
  },
});
