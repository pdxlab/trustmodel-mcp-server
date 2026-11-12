// TRUS-2500: every runtime dependency must be imported by the code that ships
// (src/ compiles to dist/; bin/ ships as-is). node-fetch sat in `dependencies`
// from the first commit without a single import, and every `npm i` / `npx` of
// 0.2.2 printed its transitive `node-domexception` deprecation warning and pulled
// in six unused packages.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|mts|js|mjs|cjs)$/.test(name) && !/\.d\.ts$/.test(name) ? [path] : [];
  });
}

// Names imported anywhere in the given source text: static `from`, side-effect
// `import "x"`, dynamic `import("x")` and `require("x")`, reduced to the package
// name ("@scope/name" or "name").
export function importedPackages(text) {
  const names = new Set();
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"'./][^"']*)["']/g;
  for (const [, spec] of text.matchAll(re)) {
    const parts = spec.split("/");
    names.add(spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
  }
  return names;
}

test("every runtime dependency is imported by src/ or bin/", () => {
  const { dependencies = {} } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const used = new Set(
    [...sources(join(root, "src")), ...sources(join(root, "bin"))].flatMap((file) => [
      ...importedPackages(readFileSync(file, "utf8")),
    ]),
  );
  const unused = Object.keys(dependencies).filter((name) => !used.has(name));
  assert.deepEqual(unused, [], `in dependencies but never imported: ${unused.join(", ")}`);
});

test("importedPackages reads every import form and reduces to the package name", () => {
  const text = [
    'import { z } from "zod";',
    "import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';",
    'import "side-effect-pkg";',
    'const m = await import("dynamic-pkg/sub");',
    'const r = require("cjs-pkg");',
    'import { local } from "./local.js";',
    'import { parent } from "../parent.js";',
    'import { readFileSync } from "node:fs";',
  ].join("\n");
  assert.deepEqual(
    [...importedPackages(text)].sort(),
    ["@modelcontextprotocol/sdk", "cjs-pkg", "dynamic-pkg", "node:fs", "side-effect-pkg", "zod"],
  );
});
