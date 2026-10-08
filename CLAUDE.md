# CLAUDE.md — jinglescript

Working notes for AI coding agents in this repo. What to build and in what order is in
**PLAN.md** — read it first and keep its Progress section up to date. What the project is and how
to use it will be in **README.md** once it exists. The sister project `../avatarscript` uses the
same conventions; when in doubt about setup, look at how it does it.

## Audio

- **You cannot hear the output; the user can.** Never mark an instrument, example or milestone as
  sounding good on your own judgement. Do every check that does not need ears (PLAN.md lists
  them: no NaN/Inf, peak and loudness targets, no DC, no aliasing partials, no clicks, onsets on
  the timing map), then hand the user a folder of rendered MP3s and ask. Report what you
  measured, not how you think it sounds.
- **Deterministic or it's a bug.** Every random component (mallet clicks, reverb noise, humanize)
  draws from the score's seeded PRNG. `Math.random`, `Date.now` and anything machine-dependent
  are not used in rendering. The same score and seed must give bit-identical PCM; golden tests
  hash it, on Ubuntu and macOS and on Node 22 and 24 in CI.
- **No engine math in src/.** Math.sin, Math.exp, Math.pow, `**` and friends differ between
  Node versions and CPUs (found the hard way: Node 22 and 24 disagree on pow). Use
  `src/dsp/math.ts` (fdlibm-style, only +−×÷ and sqrt); for oscillators prefer
  `addDampedSine` (rotation and repeated multiplication, no per-sample sin/exp). Lint enforces it.
- **Beats or seconds in the score, seconds in the output.** Scores say `at` in beats, as
  `{ "seconds": n }`, or as a cue name (optionally `"cue+beats"`); cues are given in seconds or
  beats. The timing map and audio use seconds. Convert in exactly one module that everything
  imports.
- **The score language is the product; an LLM is its main author.** Judge format changes by the
  LLM evaluation's first-try pass rate (PLAN.md, LLM authoring), and write errors and schema
  descriptions for an LLM to act on.
- **The timing map is computed, never measured** — except `audibleUntil`, which is measured on the
  final output. Its shape is the public contract video tools sync to; changing it is a breaking
  change.
- **No third-party audio in the repo** — no samples, loops or reference recordings. Rendered
  output goes to `out/` (git-ignored). The jingle analysed during prototyping belongs to another
  of the user's brands and must never be added.
- **`reference/prototype/` is provenance, not code.** Port its sound (mode ratios, decays,
  envelopes, levels) faithfully; don't port its structure, don't import it, don't edit it.
- **An instrument or sound effect ships only when it renders cleanly across its stated range and
  every variant.** Say plainly in docs and `jinglescript instruments` output which instruments
  sound synthetic (piccolo, trumpet).

## TypeScript

- **Package manager: npm** (package-lock.json). Add dependencies with `npm install` /
  `npm install --save-dev`; don't hand-edit the dependency lists in package.json. Prefer no
  runtime dependencies beyond zod and `@modelcontextprotocol/sdk` (loaded only by the `mcp`
  command); DSP and loudness are implemented here.
- Run after changes: `npm run format`, `npm run lint`, `npm run typecheck`, `npm test`, and — when
  packaging or the CLI is affected — the pack-install-render smoke script CI runs.
- **Type-checking covers the whole repo only if the tsconfig says so.** `tsconfig.json` must include
  `src`, `tests`, `scripts` and `examples`. A new top-level folder of `.ts` files must be added
  there, or nothing type-checks it and nothing tells you.
- **Tests must run without network or ffmpeg.** ffmpeg is only for MP3/OGG encoding; skip those
  tests when it is absent, never fail for it.
- **Import modules at module scope in tests, never inside a test.** An `await import(...)` inside
  an `it` loads the module's whole graph during that test and bills it against the test timeout.
  The exception is a module that must be evaluated after a non-hoisted mock (`vi.doMock`,
  `vi.resetModules`).
- **Share a type or value that two places decide from; never mirror it.** When the library and the
  CLI (or two modules) depend on the same shape, constant or enum, it lives in one module both
  import — not in two copies with a "keep these in sync" comment.
- **Validate untyped data with zod; never cast it.** Score files, timing files and CLI input go
  through a zod schema where they enter, and their TypeScript type is `z.infer` of that schema.
  The published JSON Schema is generated from the same zod schema. `as` casts and `!` are lint
  errors (tests excepted); narrow instead.
- **Lint warnings do not exist here.** `eslint.config.js` raises every preset rule to error. A rule
  that must not fail the build is turned off by name, for the files it concerns, with the reason;
  inline `eslint-disable` comments are not used.
- **Custom instruments are data, never code.** A score's `instruments` definitions are validated
  by zod and interpreted by the engine; nothing in a score is evaluated. The engine — not the
  definition — guarantees band-limiting, minimum attack, end fades, DC blocking and level caps.
- **Make a missing case a type error.** The instrument registry is a `Record<InstrumentName, …>`;
  per-member tables are written the same way, so adding a member without handling it fails
  `typecheck` instead of being silently skipped.

## Process

- **Ask before anything outward-facing:** creating the GitHub repository, pushing, publishing to
  npm, downloading sample libraries (PLAN.md M5). PLAN.md's Open questions are the user's to answer.
- Don't start optional milestones (M5, M6, M7) without the user saying so.

## GUI plugin (gui-plugin/)

- **A separate package** (Vue + vite) with its own `package.json`, lockfile, typecheck, tests and
  build; the root's lint, typecheck and vitest skip it. Its typecheck and tests resolve
  `jinglescript` to `../src/index.ts`, so they never test a stale `dist/`.
- **Two entries, two worlds.** The main entry runs in the host's Node server and may use the whole
  library; the `/vue` entry runs in the browser and must not import the library's index (it pulls
  in ffmpeg and fs). Share data through `src/definition.json` (generated by `npm run definition`
  from the library's zod schema; a test fails when it is stale) and type-only imports.
- **The tool is the library's `manage()`** — the MCP server and the plugin are two carriers of the
  same `manageJingleScript`; change behaviour in `src/manage.ts`, not in either carrier.

