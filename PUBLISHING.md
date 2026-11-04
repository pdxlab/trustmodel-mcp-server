# Publishing the TrustModel MCP server

This repo is the canonical home of the npm package `@trustmodel/mcp-server` and
of its listing in the official MCP Registry, `io.github.pdxlab/trustmodel-mcp`.

## Identity: three fields that must agree

| Field | Value |
|---|---|
| `package.json` `name` / `server.json` `packages[0].identifier` | `@trustmodel/mcp-server` |
| `package.json` `mcpName` / `server.json` `name` | `io.github.pdxlab/trustmodel-mcp` |
| `package.json` `version` / `server.json` `version` + `packages[0].version` / `manifest.json` `version` | the release version |

The registry accepts a publish only when the npm package's `mcpName` equals
`server.json`'s `name`, and only from a GitHub identity that owns the name's
namespace. `io.github.pdxlab/*` can be published by members of the `pdxlab`
GitHub org and by GitHub Actions workflows running in `pdxlab` repos (OIDC).
`npm run verify:package` checks all of the above.

Access to the `@trustmodel` npm org does **not** grant registry access; they are
separate systems.

## How a release happens

Releases are meant to come from a `vX.Y.Z` tag on `main`, through a release
workflow that publishes to npm (Trusted Publishing, no token) and then to the
MCP Registry (`mcp-publisher login github-oidc`). That workflow is a follow-up
under TRUS-2460 and does not exist yet.

Until it does, a manual publish needs the release approved on its Jira ticket
first, from a clean checkout of `main`:

```bash
npm ci
npm test
npm run verify:package
npm publish --access public          # needs publish rights on @trustmodel/mcp-server

# mcp-publisher: see github.com/modelcontextprotocol/registry (pin a release, verify its signature)
mcp-publisher login github           # as a member of the pdxlab GitHub org
mcp-publisher publish                # reads ./server.json; npm must already show the version
```

Verify:

```bash
npm view @trustmodel/mcp-server dist-tags.latest
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=trustmodel" \
  | jq '.servers[] | {name: .server.name, version: .server.version}'
```

`server.json` is validated against its `$schema` at publish time. If the schema
has moved on, run `mcp-publisher validate` and update the file.

## Previous listing

Releases up to 0.2.0 were listed as `io.github.karlmehta/trustmodel-mcp`. Only
that GitHub account can change it; once `io.github.pdxlab/trustmodel-mcp` is
live, it is deprecated with:

```bash
mcp-publisher status --status deprecated --all-versions \
  --message "Moved to io.github.pdxlab/trustmodel-mcp" io.github.karlmehta/trustmodel-mcp
```

## Notes
- PulseMCP and the GitHub MCP Registry auto-syndicate from the official
  registry; no separate submission is needed once the registry publish lands.
- The Python MCP server (PyPI `trustmodel`, server name
  `io.github.karlmehta/trustmodel-mcp-py`) publishes from the `karlmehta/trustmodel`
  repo and is not covered here.
