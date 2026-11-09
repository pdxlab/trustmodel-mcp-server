#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const packResult = JSON.parse(execFileSync(
  "npm",
  ["pack", "--dry-run", "--json", "--ignore-scripts"],
  { encoding: "utf8" },
));
const packedFiles = new Set(packResult[0].files.map((file) => file.path));

for (const requiredFile of [
  "bin/check-node.mjs",
  "bin/trustmodel-mcp.mjs",
  "dist/index.js",
  "package.json",
]) {
  assert.ok(packedFiles.has(requiredFile), `${requiredFile} is missing from the npm tarball`);
}

// TRUS-2460: dist/ and *.js are git-ignored, and tsc never deletes old output,
// so a clean `git status` can still pack leftovers from another branch into a
// tarball that cannot be unpublished. Every packed bin/ file must be tracked,
// and every packed dist/ file must come from a src/*.ts that exists.
const trackedBin = new Set(
  execFileSync("git", ["ls-files", "bin"], { encoding: "utf8" }).split("\n").filter(Boolean),
);
for (const file of packedFiles) {
  if (file.startsWith("bin/")) {
    assert.ok(trackedBin.has(file), `${file} is packed but not tracked in git`);
  } else if (file.startsWith("dist/")) {
    const source = file.replace(/^dist\//, "src/").replace(/(\.d)?\.(js|ts)(\.map)?$/, ".ts");
    assert.ok(source !== file && existsSync(source), `${file} is packed but ${source} does not exist`);
  }
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const serverJson = JSON.parse(readFileSync("server.json", "utf8"));
const smithery = readFileSync("smithery.yaml", "utf8");

assert.equal(packageJson.bin["trustmodel-mcp"], "./bin/trustmodel-mcp.mjs");
assert.equal(packageJson.engines.node, ">=22.12.0");
assert.equal(manifest.server.entry_point, "bin/trustmodel-mcp.mjs");
assert.deepEqual(manifest.server.mcp_config.args, ["${__dirname}/bin/trustmodel-mcp.mjs"]);
assert.match(smithery, /args: \['bin\/trustmodel-mcp\.mjs'\]/);
assert.equal(manifest.version, packageJson.version);
assert.equal(serverJson.version, packageJson.version);
assert.equal(serverJson.packages[0].version, packageJson.version);

// TRUS-2460: the MCP Registry accepts a publish only when the npm package's
// mcpName equals server.json's name, and only from a GitHub identity that owns
// the name's namespace. io.github.pdxlab is what this repo's CI can prove.
assert.equal(packageJson.mcpName, serverJson.name, "package.json mcpName must equal server.json name");
assert.match(serverJson.name, /^io\.github\.pdxlab\//, "server.json name must be in the io.github.pdxlab namespace");
assert.equal(serverJson.packages[0].identifier, packageJson.name);
const canonicalRepo = "https://github.com/pdxlab/trustmodel-mcp-server";
assert.equal(serverJson.repository.url, canonicalRepo);
assert.equal(packageJson.repository.url, `git+${canonicalRepo}.git`);
assert.equal(manifest.repository.url, canonicalRepo);
assert.equal(packageJson.bugs.url, `${canonicalRepo}/issues`);
assert.equal(manifest.documentation, canonicalRepo);
// The repository's numeric id ties the listing to this repo, not to whatever
// repo next holds the pdxlab/trustmodel-mcp-server name.
assert.equal(serverJson.repository.id, "1187674238", "server.json repository.id must be this repo's GitHub id");
// The registry rejects a description over 100 characters (422), and that
// rejection would land after npm publish, which cannot be undone. The registry
// counts code points (JSON Schema maxLength), and so does [...s]. s.length
// counts UTF-16 code units, which over-counts emoji and other astral
// characters and would reject descriptions the registry accepts.
assert.ok(
  [...serverJson.description].length <= 100,
  `server.json description is ${[...serverJson.description].length} characters; the MCP Registry allows 100`,
);

console.log(`npm package contains ${packedFiles.size} files and all entrypoints are guarded.`);
