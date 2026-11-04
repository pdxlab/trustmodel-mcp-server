#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["bin/trustmodel-mcp.mjs"],
  cwd: projectRoot,
  stderr: "pipe",
});
const client = new Client({ name: "trustmodel-runtime-verifier", version: "1.0.0" });

let stderr = "";
transport.stderr?.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  await client.connect(transport);

  // TRUS-2460: directories that run the server show this version, so it must be
  // the published one, not a hard-coded constant (it said 0.1.0 through 0.2.2).
  const { version: packageVersion } = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    client.getServerVersion()?.version,
    packageVersion,
    "MCP initialize reports a different version from package.json",
  );

  const result = await client.listTools();

  assert.ok(result.tools.length > 0, "MCP server returned no tools");
  assert.ok(
    result.tools.some((tool) => tool.name === "trustmodel_evaluate_local"),
    "default tool profile is missing trustmodel_evaluate_local",
  );
  assert.ok(
    result.tools.some((tool) => tool.name === "trustmodel_guardrails_check"),
    "default tool profile is missing trustmodel_guardrails_check",
  );
  console.log(`MCP initialization succeeded with ${result.tools.length} default tools.`);
} catch (error) {
  if (stderr) console.error(stderr.trim());
  throw error;
} finally {
  await client.close();
}
