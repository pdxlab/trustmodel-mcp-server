#!/usr/bin/env bash
# Build a one-click .mcpb bundle (Claude Desktop drag-and-drop install) from
# manifest.json using the official MCP Bundle tool.
#
#   ./scripts/build-mcpb.sh   ->   trustmodel.mcpb
#
# The .mcpb is a zip of manifest.json + dist/ + the runtime node_modules. Attach
# it to a GitHub Release so users can drag it into Claude Desktop with no JSON.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "› Building TypeScript…"
npm ci
npm run build

echo "› Packing .mcpb (via @anthropic-ai/mcpb)…"
npx -y @anthropic-ai/mcpb pack . trustmodel.mcpb

echo "✓ trustmodel.mcpb ready — attach it to a GitHub Release."
