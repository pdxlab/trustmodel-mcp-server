#!/usr/bin/env node

import { pathToFileURL } from "node:url";

export const MINIMUM_NODE_VERSION = "22.12.0";

function parseNodeVersion(version) {
  const match = String(version).match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;

  return match.slice(1, 4).map(Number);
}

export function isNodeVersionSupported(version) {
  const actual = parseNodeVersion(version);
  const minimum = parseNodeVersion(MINIMUM_NODE_VERSION);
  if (!actual || !minimum) return false;

  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }

  return true;
}

export function unsupportedNodeMessage(version) {
  const detected = String(version).startsWith("v") ? String(version) : `v${version}`;
  return [
    `TrustModel MCP Server requires Node.js >=${MINIMUM_NODE_VERSION}.`,
    `Detected Node.js ${detected}.`,
    "Upgrade to Node.js 24 LTS (recommended) or Node.js 22.12+ and retry.",
    "With nvm: nvm install 24 && nvm use 24",
  ].join("\n");
}

export function ensureSupportedNodeVersion(
  version = process.versions.node,
  report = console.error,
) {
  if (isNodeVersionSupported(version)) return true;

  report(unsupportedNodeMessage(version));
  return false;
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution && !ensureSupportedNodeVersion()) {
  process.exitCode = 1;
}
