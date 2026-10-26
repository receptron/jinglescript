import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as browser from "../src/browser.ts";
import * as node from "../src/index.ts";

const ALLOWED_PACKAGES = new Set(["zod"]);

/** An import or export that loads its module at runtime: not `import type`, not only `type` names. */
function loadsAtRuntime(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(node)) return !node.isTypeOnly;
  const clause = node.importClause;
  if (clause === undefined) return true;
  if (clause.isTypeOnly) return false;
  const bindings = clause.namedBindings;
  if (clause.name !== undefined || bindings === undefined || ts.isNamespaceImport(bindings)) return true;
  return bindings.elements.length === 0 || bindings.elements.some((element) => !element.isTypeOnly);
}

function specifiers(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (loadsAtRuntime(node)) found.push(node.moduleSpecifier.text);
    }
    const [argument] = ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments : [];
    if (argument !== undefined) found.push(ts.isStringLiteral(argument) ? argument.text : "<dynamic import of a computed path>");
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Every module `entry` loads at runtime, and every package or built-in it reaches. */
function importGraph(entry: string): { files: Set<string>; external: Set<string> } {
  const files = new Set<string>();
  const external = new Set<string>();
  const visit = (file: string): void => {
    if (files.has(file)) return;
    files.add(file);
    for (const specifier of specifiers(file)) {
      if (specifier.startsWith(".")) visit(resolve(dirname(file), specifier));
      else external.add(specifier);
    }
  };
  visit(resolve(import.meta.dirname, entry));
  return { files, external };
}

describe("jinglescript/browser", () => {
  it("reaches no Node built-in and no package but zod", () => {
    const { files, external } = importGraph("../src/browser.ts");
    expect(files.size).toBeGreaterThan(20);
    expect([...external].filter((name) => !ALLOWED_PACKAGES.has(name))).toEqual([]);
  });

  it("the walk does see Node built-ins (the Node entry reaches them)", () => {
    expect([...importGraph("../src/index.ts").external]).toEqual(expect.arrayContaining(["node:fs/promises", "node:child_process"]));
  });

  it("exports everything the Node entry does except what needs Node, plus its own loader's defaults", () => {
    const nodeOnly = [
      "defaultCacheDir",
      "renderToFiles",
      "manage",
      "ManageInputSchema",
      "manageInputJsonSchema",
      "MANAGE_TOOL",
      "MANAGE_ACTIONS",
      "MANAGE_DESCRIPTION",
      "AUDIO_FORMATS",
      "FfmpegMissingError",
      "NeutrinoMissingError",
      "NeutrinoVoiceMissingError",
      "awaitDeferredPlayer",
      "DEFERRED_KEEP_MS",
    ];
    const browserOnly = ["DEFAULT_SFX_BASE_URL", "DEFAULT_CACHE_NAME"];
    expect(Object.keys(browser).sort()).toEqual([...Object.keys(node).filter((name) => !nodeOnly.includes(name)), ...browserOnly].sort());
    expect(browser.loadSamples).not.toBe(node.loadSamples);
  });
});
