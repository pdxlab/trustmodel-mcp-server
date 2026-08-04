# Reference "certified" MCP server (TRUS-1584)

A minimal MCP server with a **protected tool** that only *trusted* agents may
call. Before serving, it runs the calling agent through the **TrustModel
reputation gate** and refuses revoked / unrated / low-trust agents. This is the
demand-side loop made concrete — the "here's how you refuse untrusted agents"
example to hand to a design-partner MCP server.

## Run
```bash
npm install
node server.mjs          # stdio MCP server
```
Env: `MIN_SCORE` (default 70), `TRUSTMODEL_BASE_URL` (default https://api.trustmodel.ai).

## What it demonstrates
The server exposes one tool, `get_customer_record`. On each call it:
1. Reads the caller's declared ANS identity (`agent`).
2. Looks up its reputation (`/v1/reputation/<ans>/`, TRUS-1593) and applies the
   gate policy.
3. **allow** (TrustScore ≥ `MIN_SCORE`) → returns the protected record.
   **challenge / block** (unknown, low, or revoked) → returns a denial with the
   reason and the agent's TrustScore.

Try it: call with a high-TrustScore agent (served) vs a revoked / unknown one
(denied). Swap `get_customer_record` for your real sensitive tool and you have a
gated MCP server.

## Notes
- Cryptographic identity binding at the transport layer is the companion ticket
  (stapled assertion, TRUS-1585); this example takes the agent identity as an
  argument to focus on the gate decision.
- `gate.mjs` mirrors the shipped SDK gate (trustmodel-python-sdk#35) and MCP
  `agentcert_gate` tool (trustmodel-mcp-server#39) — same policy, same decision.
- `npm test` runs the gate policy tests.
