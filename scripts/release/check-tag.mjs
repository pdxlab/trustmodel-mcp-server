#!/usr/bin/env node
// TRUS-2500: a vX.Y.Z tag may release only if every version field equals X.Y.Z
// and the npm package and registry entry name each other. Run by release.yml's
// verify job; prints every mismatch, naming the file, then exits 1.
//
// Usage: node scripts/release/check-tag.mjs <tag> [repo dir]
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [tag, dir = "."] = process.argv.slice(2);
const read = (file) => JSON.parse(readFileSync(join(dir, file), "utf8"));

const errors = [];
const match = /^v(\d+\.\d+\.\d+)$/.exec(tag ?? "");
if (!match) {
  errors.push(`tag "${tag ?? ""}" is not vX.Y.Z`);
} else {
  const version = match[1];
  const packageJson = read("package.json");
  const serverJson = read("server.json");
  const manifest = read("manifest.json");
  const fields = [
    ["package.json version", packageJson.version],
    ["server.json version", serverJson.version],
    ["server.json packages[0].version", serverJson.packages?.[0]?.version],
    ["manifest.json version", manifest.version],
  ];
  for (const [field, value] of fields) {
    if (value !== version) errors.push(`${field} is ${JSON.stringify(value)}, tag is ${tag}`);
  }
  if (packageJson.mcpName !== serverJson.name) {
    errors.push(`package.json mcpName ${JSON.stringify(packageJson.mcpName)} != server.json name ${JSON.stringify(serverJson.name)}`);
  }
  if (serverJson.packages?.[0]?.identifier !== packageJson.name) {
    errors.push(`server.json packages[0].identifier ${JSON.stringify(serverJson.packages?.[0]?.identifier)} != package.json name ${JSON.stringify(packageJson.name)}`);
  }
}

for (const error of errors) console.error(`::error::${error}`);
if (errors.length) process.exit(1);
console.log(`${tag}: all version fields and identities agree`);
