// yarn release: publishes to npm whichever of the two packages has a version npm does not have yet —
// jinglescript first, then @gui-chat-plugin/jinglescript (its peer needs the new library) — and
// tags the release. Both packages always carry the same version, and the plugin's peer is
// ^<that version>; this refuses to publish when they do not.
//
// Runs only from a clean main that matches origin/main, so what is published is what is merged.
// `yarn release --dry-run` checks everything and says what it would publish, without publishing.
// npm asks for a one-time password itself when the account needs one.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const root = join(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");

const Manifest = z.object({
  name: z.string(),
  version: z.string(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
});

function fail(message: string): never {
  console.error(`release: ${message}`);
  process.exit(1);
}

/** Runs a command and returns its stdout; fails the release when it fails. */
function run(command: string, args: string[], cwd = root): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed:\n${result.stderr.trim()}`);
  return result.stdout.trim();
}

/** Runs a command with the terminal attached (npm publish may ask for a one-time password). */
function runAttached(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed in ${cwd}`);
}

/** Whether npm has this exact version of the package. */
function published(name: string, version: string): boolean {
  const result = spawnSync("npm", ["view", `${name}@${version}`, "version"], { cwd: root, encoding: "utf8" });
  if (result.status === 0) return result.stdout.trim() === version;
  if (result.stderr.includes("E404")) return false;
  return fail(`cannot ask npm about ${name}@${version}:\n${result.stderr.trim()}`);
}

const manifest = (dir: string) => Manifest.parse(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")));

// What is published is what is merged.
const branch = run("git", ["branch", "--show-current"]);
if (branch !== "main") fail(`run it on main (this is ${branch || "a detached HEAD"})`);
const dirty = run("git", ["status", "--porcelain"]);
if (dirty !== "") fail(`the working tree is not clean:\n${dirty}`);
run("git", ["fetch", "--quiet", "origin", "main"]);
if (run("git", ["rev-parse", "HEAD"]) !== run("git", ["rev-parse", "origin/main"])) fail("main is not the same as origin/main: pull (or push) first");

// One version for both, and the plugin's peer on it.
const library = { dir: root, ...manifest(root) };
const plugin = { dir: join(root, "gui-plugin"), ...manifest(join(root, "gui-plugin")) };
if (plugin.version !== library.version) fail(`${library.name} is ${library.version} but ${plugin.name} is ${plugin.version}: give both the same version`);
const peer = plugin.peerDependencies?.[library.name];
if (peer !== `^${library.version}`) fail(`${plugin.name}'s peer ${library.name} is ${peer ?? "missing"}; it should be ^${library.version}`);

const pending = [library, plugin].filter((pkg) => !published(pkg.name, pkg.version));
if (pending.length === 0) {
  console.log(`release: ${library.name} and ${plugin.name} ${library.version} are both on npm already: nothing to publish`);
  process.exit(0);
}
const names = pending.map((pkg) => pkg.name + "@" + pkg.version);
console.log(`release: to publish: ${names.join(", ")}`);
if (dryRun) {
  for (const pkg of pending) runAttached("npm", ["publish", "--dry-run"], pkg.dir);
  console.log("release: dry run, nothing published");
  process.exit(0);
}
for (const pkg of pending) {
  runAttached("npm", ["publish"], pkg.dir);
  console.log(`release: published ${pkg.name}@${pkg.version}`);
}

const tag = `v${library.version}`;
if (run("git", ["tag", "--list", tag]) === "") {
  run("git", ["tag", "-a", tag, "-m", `${library.name} and ${plugin.name} ${library.version}`]);
  run("git", ["push", "--quiet", "origin", tag]);
  console.log(`release: tagged ${tag} and pushed the tag`);
}
