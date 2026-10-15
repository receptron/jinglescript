import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// The playground (GitHub Pages): the library's browser entry from source, the plugin's player view,
// and the recorded effects served next to the page (samples/ is the public folder, so sfx/ is too).
export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [vue(), tailwindcss()],
  publicDir: resolve(import.meta.dirname, "../../samples"),
  resolve: { alias: { "jinglescript/browser": resolve(import.meta.dirname, "../../src/browser.ts") } },
  worker: { format: "es" },
  build: {
    outDir: resolve(import.meta.dirname, "../../out/playground"),
    emptyOutDir: true,
    // Two pages: the JSON playground and the no-code studio.
    rollupOptions: { input: { index: resolve(import.meta.dirname, "index.html"), studio: resolve(import.meta.dirname, "studio.html") } },
  },
});
