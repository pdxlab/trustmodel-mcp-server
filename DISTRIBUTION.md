# Distribution checklist (TRUS-1087)

What's in this repo and what still needs a human click.

## In-repo artifacts (done)
- `manifest.json` + `scripts/build-mcpb.sh` → one-click `.mcpb` for Claude Desktop.
- `smithery.yaml` → Smithery stdio listing + config schema.
- `glama.json` → Glama ownership/analytics.
- README install badges (VS Code / Cursor) + one-click section.

## Maintainer steps (need accounts / web forms)
1. **Build + attach the bundle:** `./scripts/build-mcpb.sh` → upload `trustmodel.mcpb` to a GitHub Release.
2. **Smithery:** connect the GitHub repo at https://smithery.ai/new (reads `smithery.yaml`).
3. **Glama:** auto-indexes public MCP repos; `glama.json` claims ownership. Confirm at https://glama.ai/mcp/servers.
4. **mcp.so:** submit at https://mcp.so/submit (web form).
5. **PulseMCP & GitHub MCP Registry:** auto-syndicate from the official MCP Registry — no separate submission once TRUS-1086 publishes.

## awesome-mcp list PRs (open once the public repo + npm publish land)
- `wong2/awesome-mcp-servers`
- `punkpeye/awesome-mcp-servers`
- `mcpservers.org`

Suggested entry:

```markdown
- [TrustModel](https://github.com/karlmehta/trustmodel-mcp) — Trust evaluation, red-team & governance for AI agents. Local no-key TrustScore across 10 dimensions + policy-pack governance; calibrated cloud scoring with a free key.
```
