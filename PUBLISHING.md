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
- **any** GitHub Actions workflow run in **any** `pdxlab` repo, on any branch
  (`mcp-publisher login github-oidc`). The registry grants `io.github.<owner>/*`
  from the token's repository owner alone; it does not check the repo, branch,
  workflow or environment. The Owner-only rule above covers the manual path only.

`npm run verify:package` checks that the fields above agree, that the name is in
the `io.github.pdxlab` namespace, that the repository, bugs and documentation
links and the repository id point at this repo, that the description fits the
registry's 100-character limit, and that every packed `bin/` file is tracked in
git and every packed `dist/` file has a `src/` source. It cannot check who is
allowed to publish.

Access to the `@trustmodel` npm org does **not** grant registry access; they are
separate systems.

## How a release happens

A release comes from a `vX.Y.Z` tag on `main`. `.github/workflows/release.yml`
publishes to npm (Trusted Publishing, no token, with a provenance attestation),
then to the MCP Registry (`mcp-publisher login github-oidc`), then creates the
GitHub Release. Nobody publishes from a laptop.

1. **Release PR.** Ticket `TRUS-<n>: release @trustmodel/mcp-server X.Y.Z`,
   branch `TRUS-<n>-release-X.Y.Z`. Set the version in all four places from the
   identity table above: `package.json` (`npm version X.Y.Z --no-git-tag-version`
   also updates `package-lock.json`), `server.json` `version` and
   `packages[0].version`, and `manifest.json`. `npm run verify:package` fails if
   they disagree.
2. **Review and merge** to `main`.
3. **A repository admin tags the merge commit.** Only admins can push `v*` tags.
   ```bash
   git switch main && git pull --ff-only
   git tag -a vX.Y.Z -m "@trustmodel/mcp-server X.Y.Z" && git push origin vX.Y.Z
   ```
4. **Watch the Release run** in the Actions tab: `verify` → `checksum` →
   `publish` → `publish-registry` → `github-release`. The run stops before
   publishing if the tag differs from any version field, the commit is not on
   `main`, or any test or verify script fails.
5. **Check the result** with the commands at the end of this section. On npm,
   `_npmUser` should be GitHub Actions.

If a run fails after npm or the registry accepted the version, **re-run the
failed jobs**. Both publish jobs skip a version that already holds this
release's bytes, so a re-run never publishes twice. Never move a tag that has
published; fix forward with a new patch version.

### Emergency manual release

Use this only when the tag release **cannot run** (for example, GitHub Actions
or npm Trusted Publishing is down) and the release cannot wait for it. It skips
the tag ruleset and the `npm` environment, and the npm version it publishes has
no provenance attestation. Do not use it to finish a run that already published
to npm; re-run the failed jobs instead.

Before starting:

- a `pdxlab` org Owner other than the person publishing approves the release in a
  comment on its Jira ticket, naming the version, the full commit SHA on `main`,
  and why the tag release cannot be used. Only that commit is published;
- the publisher is a `pdxlab` org Owner with publish rights on
  `@trustmodel/mcp-server` and npm two-factor authentication;
- `mcp-publisher` is a pinned release from github.com/modelcontextprotocol/registry
  whose signature has been checked (needs `cosign`; example for v1.8.7 on Apple
  silicon):

  ```bash
  V=v1.8.7; F=mcp-publisher_darwin_arm64.tar.gz
  gh release download "$V" -R modelcontextprotocol/registry -p "$F" -p "$F.sigstore.json"
  cosign verify-blob --bundle "$F.sigstore.json" \
    --certificate-identity "https://github.com/modelcontextprotocol/registry/.github/workflows/release.yml@refs/tags/$V" \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com \
    "$F"
  tar -xzf "$F" mcp-publisher
  MCP_PUBLISHER="$PWD/mcp-publisher"   # the release block runs this binary, not one on PATH
  ```

Publish from a fresh clone, never a working checkout: `dist/` and `*.js` are
git-ignored, so a checkout that looks clean can still hold build output from
another branch, and `npm publish` would ship it. Every check runs **before**
`npm publish`, because an npm version cannot be republished and the registry
publish only works once npm has the version. Paste the block as a whole, in the
shell where `MCP_PUBLISHER` was set above: it runs in a subshell with
`set -euo pipefail`, so the first failing step stops it before anything is
published, and `cd` does not leave your own shell in the clone. The registry
login runs before `npm publish`, so the one step that cannot be undone comes
after every interactive step has succeeded:

```bash
(
set -euo pipefail
SHA=<full commit SHA from the approval>; VERSION=<version from the approval>
test -x "$MCP_PUBLISHER"              # the cosign-verified binary from above
d=$(mktemp -d)
git clone git@github.com:pdxlab/trustmodel-mcp-server.git "$d"
cd "$d"
git merge-base --is-ancestor "$SHA" origin/main   # the approved commit is on main
git switch --detach "$SHA"
test "$(node -p 'require("./package.json").version')" = "$VERSION"
npm ci
npm test
npm run verify:mcp-handshake          # the server reports package.json's version
npm run verify:package                # identity fields and what the tarball ships
"$MCP_PUBLISHER" validate             # server.json against its $schema
"$MCP_PUBLISHER" login github         # as a pdxlab org Owner

npm publish --access public
"$MCP_PUBLISHER" publish              # reads ./server.json
)
```

Afterwards, comment on the Jira ticket with the version and the output of the
check below, and fix whatever stopped the tag release before the next one.

### Check a release

Whichever path published it, npm and the registry must show the same version,
and the listing must point at this package and repo. The two `version` lines
must match:

```bash
npm view @trustmodel/mcp-server dist-tags.latest
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=trustmodel-mcp" \
  | jq '.servers[]
        | select(.server.name == "io.github.pdxlab/trustmodel-mcp" and ._meta["io.modelcontextprotocol.registry/official"].isLatest)
        | {version: .server.version,
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
- This file covers only the npm package. The MCP Registry has no Python
  TrustModel server listed.
