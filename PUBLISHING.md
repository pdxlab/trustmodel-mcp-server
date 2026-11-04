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
namespace. `io.github.pdxlab/*` can be published by:

- an **Owner** of the `pdxlab` GitHub org, by hand (`mcp-publisher login github`).
  Plain org members are refused.
- a GitHub Actions workflow running in a `pdxlab` repo (`mcp-publisher login github-oidc`).

`npm run verify:package` checks that the fields above agree, that the name is in
the `io.github.pdxlab` namespace, that the repository links and id point at this
repo, and that the description fits the registry's 100-character limit. It
cannot check who is allowed to publish.

Access to the `@trustmodel` npm org does **not** grant registry access; they are
separate systems.

## How a release happens

Releases are meant to come from a `vX.Y.Z` tag on `main`, through a release
workflow that publishes to npm (Trusted Publishing, no token) and then to the
MCP Registry (`mcp-publisher login github-oidc`). That workflow is a follow-up
under TRUS-2460 and does not exist yet.

Until it does, a release can be published by hand. This section is removed by
the pull request that adds the release workflow.

Before starting:

- the release is approved in a comment on its Jira ticket by a `pdxlab` org
  Owner other than the person publishing;
- the publisher is a `pdxlab` org Owner with publish rights on
  `@trustmodel/mcp-server`;
- `mcp-publisher` is a pinned release from github.com/modelcontextprotocol/registry
  with its signature verified.

Every check runs **before** `npm publish`, because an npm version cannot be
republished and the registry publish only works once npm has the version:

```bash
git fetch origin
git switch --detach origin/main
test -z "$(git status --porcelain)"   # no local changes or stray files
npm ci
npm test
npm run verify:mcp-handshake          # the server reports package.json's version
npm run verify:package
mcp-publisher validate                # server.json against its $schema

npm publish --access public
mcp-publisher login github            # as a pdxlab org Owner
mcp-publisher publish                 # reads ./server.json
```

Verify that npm and the registry agree, and that the listing points at this
package and repo:

```bash
npm view @trustmodel/mcp-server dist-tags.latest
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=trustmodel" \
  | jq '.servers[] | {name: .server.name, version: .server.version,
                      package: .server.packages[0].identifier,
                      repo: .server.repository.url}'
```

If `mcp-publisher validate` reports that the schema has moved on, update
`server.json` in a pull request first.

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
