#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

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

console.log(`npm package contains ${packedFiles.size} files and all entrypoints are guarded.`);
