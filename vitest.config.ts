import { configDefaults, defineConfig } from "vitest/config";

// gui-plugin/ is its own package (Vue, its own vitest config); its tests run there.
export default defineConfig({
  // Rendering an instrument across its range takes seconds; CI runners are slower than a laptop.
  test: { exclude: [...configDefaults.exclude, "gui-plugin/**"], testTimeout: 30000 },
});
