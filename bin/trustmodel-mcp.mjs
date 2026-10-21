#!/usr/bin/env node

import { ensureSupportedNodeVersion } from "./check-node.mjs";

if (!ensureSupportedNodeVersion()) {
  process.exit(1);
}

// dist/index.js only auto-starts stdio when it is argv[1] (so that importing it
// from the hosted HTTP server does not start stdio). Launched through this bin
// it is an import, not argv[1], so start it explicitly.
const { main } = await import("../dist/index.js");

main().catch((err) => {
  console.error("Fatal error starting TrustModel MCP Server:", err);
  process.exit(1);
});
