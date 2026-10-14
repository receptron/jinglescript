// The repository's examples, bundled as separate chunks and loaded when picked.
const modules = import.meta.glob<unknown>(["../../examples/*.json", "../../examples/piano/*.json"], { import: "default" });

export interface Example {
  /** File name without .json, as the player's fallback title. */
  name: string;
  group: "Examples" | "Piano classics";
  load: () => Promise<unknown>;
}

export function exampleOf(path: string, load: () => Promise<unknown>): Example {
  const name =
    path
      .split("/")
      .pop()
      ?.replace(/\.json$/, "") ?? path;
  return { name, group: path.includes("/piano/") ? "Piano classics" : "Examples", load };
}

export const EXAMPLES: readonly Example[] = Object.entries(modules)
  .map(([path, load]) => exampleOf(path, load))
  .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));

export const DEFAULT_EXAMPLE = "hatena-marumo-a";
