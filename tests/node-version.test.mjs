import assert from "node:assert/strict";
import test from "node:test";

import {
  MINIMUM_NODE_VERSION,
  ensureSupportedNodeVersion,
  isNodeVersionSupported,
  unsupportedNodeMessage,
} from "../bin/check-node.mjs";

test("rejects runtimes below the Node.js 22.12 floor", () => {
  for (const version of ["20.11.1", "20.19.0", "21.7.3", "22.0.0", "22.11.0"]) {
    assert.equal(isNodeVersionSupported(version), false, version);
  }
});

test("accepts the floor and newer runtimes", () => {
  for (const version of ["22.12.0", "22.12.1", "23.0.0", "24.0.0", "25.1.0"]) {
    assert.equal(isNodeVersionSupported(version), true, version);
  }
});

test("accepts the version format reported by process.version", () => {
  assert.equal(isNodeVersionSupported("v24.1.0"), true);
});

test("rejects malformed versions", () => {
  for (const version of ["", "22", "22.12", "latest", undefined]) {
    assert.equal(isNodeVersionSupported(version), false, String(version));
  }
});

test("reports an actionable failure without throwing", () => {
  const messages = [];
  assert.equal(ensureSupportedNodeVersion("22.11.0", (message) => messages.push(message)), false);
  assert.equal(messages.length, 1);
  assert.match(messages[0], new RegExp(`requires Node\\.js >=${MINIMUM_NODE_VERSION.replaceAll(".", "\\.")}`));
  assert.match(messages[0], /Detected Node\.js v22\.11\.0/);
  assert.match(messages[0], /Node\.js 24 LTS/);
  assert.match(messages[0], /nvm install 24/);
  assert.doesNotMatch(messages[0], /ERR_REQUIRE_ESM/);
});
