// Renders off the page's thread: a long piano piece takes seconds, and the page stays responsive.
import { checkScore, loadSamples, parseScore, render, tagsOf, toPlayerData, toWav } from "jinglescript/browser";
import type { RenderReply, RenderRequest } from "./messages.ts";

const reply = (message: RenderReply): void => self.postMessage(message, { transfer: message.kind === "done" ? [message.wav] : [] });

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
  reply({ id, kind: "rendering", seconds: check.duration ?? 0 });
  const result = await render(score, { samples });
  const wav = toWav(result.audio, result.sampleRate, 16, tagsOf(score));
  const player = toPlayerData(score, result, name, { audio: "", mimeType: "audio/wav" });
  return { id, kind: "done", player, wav: wav.buffer, warnings: check.warnings, downloads, ms: Math.round(performance.now() - started) };
}

self.addEventListener("message", (event: MessageEvent<RenderRequest>) => {
  renderRequest(event.data).then(reply, (error: unknown) =>
    reply({ id: event.data.id, kind: "failed", message: error instanceof Error ? error.message : String(error) }),
  );
});
