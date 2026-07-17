#!/usr/bin/env node

import { ensureSupportedNodeVersion } from "./check-node.mjs";

if (!ensureSupportedNodeVersion()) {
  process.exit(1);
}

await import("../dist/index.js");
