#!/usr/bin/env node
/**
 * Guardrail MCP tool — contract regression (TRUS-1326, Surface D).
 *
 * Drives the trustmodel_guardrails_check handler with `fetch` stubbed,
 * asserting the outgoing URL + request shape against the gateway contract
 * (aurora-gateway sdk/guardrails_views.py → agt_adapter GuardrailsCheckView):
 *
 *   - POST /sdk/v1/guardrails/check  (NO trailing slash), Bearer auth.
 *   - body = agent_id / action_type / action_payload / subject_id / policy_name,
 *     with action_payload defaulting to {}, subject_id to "", policy_name to "default".
 *   - the handler adds a derived `allowed` flag: true only for decision "allow";
 *     "deny"/"redact" (and any unknown verdict) are a block (allowed=false).
 *
 * No network and no API key round-trip required — this is the CI gate. The live
 * check against a real gateway policy is covered manually / by e2e.
 */

process.env.TRUSTMODEL_API_KEY = "tm-dev-contract_00000000000000000000000000";
process.env.TRUSTMODEL_BASE_URL = "https://gateway.test";

let nextDecision = "allow";
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        decision: nextDecision,
        policy_id: "p-1",
        reason: "stub",
        trust_score: 850,
        evidence: {},
        latency_ms: 3,
      };
    },
    async text() {
      return "{}";
    },
  };
};

const { handleGuardrails } = await import("../dist/tools/guardrails.js");

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) {
    console.log("  ✓", name);
  } else {
    console.log("  ✗", name, extra ? `(${extra})` : "");
    failures++;
  }
}

// ── request contract + allow verdict ────────────────────────────────────────
calls.length = 0;
nextDecision = "allow";
let res = await handleGuardrails({
  agent_id: "spiffe://trustmodel.ai/agent/x",
  action_type: "hiring_decision",
  action_payload: { candidate_id: "c-99" },
});
const call = calls[0];
const body = JSON.parse(call.init.body);
check(
  "POST /sdk/v1/guardrails/check (no trailing slash)",
  call.url.endsWith("/sdk/v1/guardrails/check") && call.init.method === "POST",
  call.url
);
check("sends Bearer auth", String(call.init.headers?.Authorization || "").startsWith("Bearer "));
check("body.agent_id", body.agent_id === "spiffe://trustmodel.ai/agent/x");
check("body.action_type", body.action_type === "hiring_decision");
check("body.action_payload forwarded", body.action_payload?.candidate_id === "c-99");
check("body.subject_id defaults to empty string", body.subject_id === "");
check("body.policy_name defaults to 'default'", body.policy_name === "default");
check("allow → allowed=true", res.allowed === true, JSON.stringify(res.allowed));
check("allow → decision preserved", res.decision === "allow");

// ── defaults when action_payload omitted ────────────────────────────────────
calls.length = 0;
nextDecision = "deny";
res = await handleGuardrails({ agent_id: "a", action_type: "noop" });
const body2 = JSON.parse(calls[0].init.body);
check("action_payload defaults to {}", JSON.stringify(body2.action_payload) === "{}");
check("deny → allowed=false (fail-closed)", res.allowed === false);

// ── redact is a block, not an allow ─────────────────────────────────────────
nextDecision = "redact";
res = await handleGuardrails({ agent_id: "a", action_type: "noop" });
check("redact → allowed=false (block)", res.allowed === false);

// ── an UNKNOWN verdict is a block (fail-closed) ─────────────────────────────
nextDecision = "weird";
res = await handleGuardrails({ agent_id: "a", action_type: "noop" });
check("unknown verdict → allowed=false (fail-closed)", res.allowed === false);
check("unknown decision preserved", res.decision === "weird");

// ── a transport throw propagates (the tool wrapper surfaces it as isError) ──
const _origFetch = globalThis.fetch;
let _threw = false;
globalThis.fetch = async () => {
  throw new Error("Network timeout");
};
try {
  await handleGuardrails({ agent_id: "a", action_type: "noop" });
} catch (err) {
  _threw = err instanceof Error;
}
globalThis.fetch = _origFetch;
check("transport throw → handler rejects (never silently allows)", _threw === true);

if (failures) {
  console.error(`\n${failures} guardrail contract check(s) failed`);
  process.exit(1);
}
console.log("\nGuardrail MCP contract checks passed ✅");
