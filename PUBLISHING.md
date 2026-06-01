# Publishing the TrustModel MCP server

This repo is the public canonical home of the npm package `@trustmodel/mcp-server`
and its listing in the official MCP Registry under the GitHub-OAuth namespace
`io.github.karlmehta/*`. **No DNS / no Cloudflare** is involved.

The `mcpName` field in `package.json` and the `name` in `server.json` must match
exactly (`io.github.karlmehta/trustmodel-mcp`) — that's how the registry verifies
the npm package and the registry entry are the same owned server.

## 1. Publish the npm package

Requires npm auth for the `@trustmodel` org (`npm login`).

```bash
npm ci
npm run build
npm publish --access public        # publishes @trustmodel/mcp-server@0.2.0
```

Verify: `npm view @trustmodel/mcp-server version` → `0.2.0`, and the package page
shows the `mcpName` and `repository`/`homepage` links.

## 2. Publish to the official MCP Registry

Requires the registry CLI and a GitHub login for the namespace.

```bash
# Install the publisher CLI (see github.com/modelcontextprotocol/registry)
#   e.g. via Go:  go install github.com/modelcontextprotocol/registry/cmd/mcp-publisher@latest
#   or download a release binary and put it on PATH.

mcp-publisher login github          # interactive GitHub OAuth → verifies io.github.karlmehta
mcp-publisher publish               # reads ./server.json
```

Verify: the registry v0 servers search endpoint returns the entry, e.g.

```bash
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=trustmodel" | jq '.servers[].name'
```

`server.json` is validated against the schema at publish time. If the schema has
moved on, regenerate with `mcp-publisher init` and re-apply the values above.

## Notes
- PulseMCP and the GitHub MCP Registry auto-syndicate from the official registry —
  no separate submission needed for those once step 2 lands.
- The Python MCP server (PyPI `trustmodel`, server name
  `io.github.karlmehta/trustmodel-mcp-py`) publishes from the `karlmehta/trustmodel`
  repo — see its `server.json` + `PUBLISHING.md`.
