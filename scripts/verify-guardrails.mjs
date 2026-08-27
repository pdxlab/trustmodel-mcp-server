#!/usr/bin/env node

process.env.TRUSTMODEL_API_KEY = "tm-dev-contract_00000000000000000000000000";
process.env.TRUSTMODEL_BASE_URL = "https://gateway.test";
process.env.TRUSTMODEL_GUARDRAIL_FAIL_MODE = "fail_closed";

let nextDecision = "allow";
let transportFailure = false;
let httpRefusalStatus = null;
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  if (transportFailure) throw new Error("sensitive transport detail");
  calls.push({ url: String(url), init });
  if (httpRefusalStatus !== null) {
    return {
      ok: false,
      status: httpRefusalStatus,
      statusText: "Forbidden",
      async json() {
        return { detail: "sensitive refusal detail" };
      },
      async text() {
        return '{"detail":"sensitive refusal detail"}';
      },
    };
  }
  return {
    ok: true,
    status: 200,
    statusText: "OK",
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
function check(name, condition, extra = "") {
  if (condition) console.log("  ✓", name);
  else {
    console.log("  ✗", name, extra ? `(${extra})` : "");
    failures += 1;
  }
}

let result = await handleGuardrails({
  agent_id: "agent-one",
  action_type: "send_email",
  action_payload: { recipient: "customer" },
});
const request = calls[0];
const body = JSON.parse(request.init.body);
check(
  "uses the SDK guardrail endpoint without a trailing slash",
  request.url.endsWith("/sdk/v1/guardrails/check"),
  request.url,
);
check("uses POST", request.init.method === "POST");
check("sends bearer authentication", request.init.headers.Authorization.startsWith("Bearer "));
check("defaults subject_id", body.subject_id === "");
check("defaults policy_name", body.policy_name === "default");
check("forwards action payload", body.action_payload.recipient === "customer");
check("literal allow authorizes", result.allowed === true);

for (const decision of ["deny", "redact", "unknown", "ALLOW", ""]) {
  nextDecision = decision;
  result = await handleGuardrails({ agent_id: "agent-one", action_type: "test" });
  check(`${JSON.stringify(decision)} blocks`, result.allowed === false);
}

transportFailure = true;
result = await handleGuardrails({ agent_id: "agent-one", action_type: "test" });
check("transport failure blocks by default", result.allowed === false);
check("transport failure is explicit", result.decision === "transport_error");
check(
  "transport details are not exposed",
  !JSON.stringify(result).includes("sensitive transport detail"),
);

process.env.TRUSTMODEL_GUARDRAIL_FAIL_MODE = "fail_open";
result = await handleGuardrails({ agent_id: "agent-one", action_type: "test" });
check("explicit fail-open authorizes transport failure", result.allowed === true);
check("fail-open still returns canonical allow", result.decision === "allow");

transportFailure = false;
httpRefusalStatus = 403;
result = await handleGuardrails({ agent_id: "agent-one", action_type: "test" });
check("HTTP refusal blocks under fail-open", result.allowed === false);
check("HTTP refusal is distinct from transport failure", result.decision === "refused");
check("HTTP refusal exposes only its status", result.evidence.http_status === 403);
check("HTTP refusal is marked as authoritative", result.evidence.http_refusal === true);
check(
  "HTTP refusal details are not exposed",
  !JSON.stringify(result).includes("sensitive refusal detail"),
);

if (failures) {
  console.error(`\n${failures} guardrail contract check(s) failed`);
  process.exit(1);
}
console.log("\nGuardrail MCP contract checks passed.");
