// Renders off the page's thread: a long piano piece takes seconds, and the page stays responsive.
import { checkScore, loadSamples, parseScore, render, toPlayerData } from "jinglescript/browser";
import type { RenderReply, RenderRequest } from "./messages.ts";

const reply = (message: RenderReply): void => self.postMessage(message);

async function renderRequest({ id, score: input, name, sfxBaseUrl }: RenderRequest): Promise<RenderReply> {
  const check = checkScore(input);
  if (!check.ok) return { id, kind: "invalid", errors: check.errors };
  const started = performance.now();
  const score = parseScore(input);
  let downloads = 0;
  const samples = await loadSamples(score, {
    sfxBaseUrl,
    onDownload: (file) => reply({ id, kind: "downloading", file, count: ++downloads }),
  });
  const player = toPlayerData(score, render(score, { samples }), name);
  return { id, kind: "done", player, warnings: check.warnings, downloads, ms: Math.round(performance.now() - started) };
}

self.addEventListener("message", (event: MessageEvent<RenderRequest>) => {
  renderRequest(event.data).then(reply, (error: unknown) =>
    reply({ id: event.data.id, kind: "failed", message: error instanceof Error ? error.message : String(error) }),
  );
});
