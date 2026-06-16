#!/usr/bin/env node
/**
 * TRUS-1249 acceptance — agentcert_issue + agentcert_verify wiring.
 *
 * AgentCert (SKU 4) MCP tools. The backend issuance/verify endpoints are
 * still in flight (TRUS-1241 epic), so this script does NOT hit the network.
 * It stubs `fetch` and asserts the client builds the correct requests, and
 * that the tool handlers validate inputs the way the schemas advertise:
 *
 *   - agentcert_issue  → POST /sdk/v1/agentcert/issue/, Bearer auth,
 *     trigger_source=mcp, evaluation_run_id coerced to a number.
 *   - agentcert_issue  → throws when neither evaluation_run_id nor
 *     trust_score is supplied.
 *   - agentcert_verify → GET /v1/verify/<agent>, PUBLIC (no Authorization
 *     header), agent path segment URL-encoded.
 */
import { handleAgentCertIssue } from "../dist/tools/agentcert-issue.js";
import { handleAgentCertVerify } from "../dist/tools/agentcert-verify.js";

// client.ts captures BASE_URL at module-load time, so we assert on the path
// suffix rather than the full URL (the default host is fine for a stubbed
// fetch). Only the API key needs to be present for the Bearer-auth assertion.
process.env.TRUSTMODEL_API_KEY = "tm-test-0000_dummy";

let failures = 0;
function check(label, ok, detail) {
  const tag = ok ? "✓" : "✗";
  console.log(`${tag} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

function stubFetch(captured) {
  globalThis.fetch = async (url, init = {}) => {
    captured.url = url;
    captured.init = init;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return { ok: true };
      },
      async text() {
        return "{}";
      },
    };
  };
}

// ── Case 1: agentcert_issue with evaluation_run_id ──────────────────────────
{
  const cap = {};
  stubFetch(cap);
  await handleAgentCertIssue({
    agent_id: "acme.support.agent",
    evaluation_run_id: "42",
    validation_level: "OV",
  });
  check(
    "issue → POST /sdk/v1/agentcert/issue/",
    cap.url.endsWith("/sdk/v1/agentcert/issue/") && cap.init.method === "POST",
    cap.url,
  );
  const auth = cap.init.headers?.Authorization;
  check("issue sends Bearer auth", auth === "Bearer tm-test-0000_dummy");
  const body = JSON.parse(cap.init.body);
  check(
    "issue coerces evaluation_run_id to number",
    body.evaluation_run_id === 42,
    `got ${JSON.stringify(body.evaluation_run_id)}`,
  );
  check("issue sets trigger_source=mcp", body.trigger_source === "mcp");
}

// ── Case 2: agentcert_issue with neither signal → validation error ──────────
{
  let caught;
  try {
    await handleAgentCertIssue({ agent_id: "acme.support.agent" });
  } catch (e) {
    caught = e;
  }
  check(
    "issue rejects missing trust signal",
    caught instanceof Error &&
      /evaluation_run_id or trust_score/.test(caught.message),
    caught?.message,
  );
}

// ── Case 3: agentcert_verify is public + URL-encodes the agent ──────────────
{
  const cap = {};
  stubFetch(cap);
  await handleAgentCertVerify({ agent: "acme/support agent" });
  check(
    "verify → GET /v1/verify/<agent> (url-encoded)",
    cap.url.endsWith("/v1/verify/acme%2Fsupport%20agent") &&
      (cap.init.method === undefined || cap.init.method === "GET"),
    cap.url,
  );
  check(
    "verify sends NO Authorization header (public)",
    cap.init.headers?.Authorization === undefined,
  );
}

console.log("");
if (failures > 0) {
  console.error(`agentcert verify: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log("agentcert verify: all checks passed.");
