#!/usr/bin/env node
/**
 * AgentCert MCP tools — contract regression (TRUS-1229).
 *
 * Drives the agentcert_issue / agentcert_verify handlers with `fetch`
 * stubbed, asserting the exact outgoing URL + request shape against the
 * deployed gateway contract (agentcert/docs/api-v0.md):
 *
 *   - agentcert_issue  → POST /sdk/v1/agentcert/issue/, Bearer auth,
 *     evaluation_run_id coerced to a number, fields = ans_name /
 *     evaluation_run_id / subject_agent_id / auditor_slug / validity_days.
 *   - agentcert_verify → GET /v1/verify/<agent>/, PUBLIC (no Authorization
 *     header), trailing slash, agent path segment URL-encoded.
 *
 * No network and no API key required — this is the CI gate. The live
 * round-trip against a real gateway is covered manually / by e2e.
 */

process.env.TRUSTMODEL_API_KEY = "tm-dev-contract_00000000000000000000000000";
process.env.TRUSTMODEL_BASE_URL = "https://gateway.test";

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  return {
    ok: true,
    status: 200,
    async json() {
      return { found: true, verified: true, status: "active", validation_level: "DV" };
    },
    async text() {
      return "{}";
    },
  };
};

const { handleAgentCertIssue } = await import("../dist/tools/agentcert-issue.js");
const { handleAgentCertVerify } = await import("../dist/tools/agentcert-verify.js");

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) {
    console.log("  ✓", name);
  } else {
    console.log("  ✗", name, extra ? `(${extra})` : "");
    failures++;
  }
}

// ── agentcert_issue ───────────────────────────────────────────────────────────
calls.length = 0;
await handleAgentCertIssue({
  ans_name: "helpbot.cisco.com",
  evaluation_run_id: "242", // string on purpose — must coerce to number
  subject_agent_id: "helpbot",
});
const issue = calls[0];
const issueBody = JSON.parse(issue.init.body);
check("issue → POST /sdk/v1/agentcert/issue/", issue.url.endsWith("/sdk/v1/agentcert/issue/") && issue.init.method === "POST", issue.url);
check("issue sends Bearer auth", String(issue.init.headers?.Authorization || "").startsWith("Bearer "));
check("issue body.ans_name", issueBody.ans_name === "helpbot.cisco.com");
check("issue coerces evaluation_run_id to number", issueBody.evaluation_run_id === 242, JSON.stringify(issueBody.evaluation_run_id));
check("issue body.subject_agent_id", issueBody.subject_agent_id === "helpbot");

// ── agentcert_verify ──────────────────────────────────────────────────────────
calls.length = 0;
await handleAgentCertVerify({ agent: "helpbot.cisco.com" });
const verify = calls[0];
check("verify → GET /v1/verify/<agent>/ (trailing slash)", verify.url.endsWith("/v1/verify/helpbot.cisco.com/"), verify.url);
check("verify is PUBLIC (no Authorization header)", !(verify.init.headers && verify.init.headers.Authorization));
check("verify uses GET (no method override)", verify.init.method === undefined || verify.init.method === "GET");

// agent path segment must be URL-encoded
calls.length = 0;
await handleAgentCertVerify({ agent: "a/b agent" });
check("verify URL-encodes the agent segment", calls[0].url.endsWith("/v1/verify/a%2Fb%20agent/"), calls[0].url);

if (failures) {
  console.error(`\n${failures} AgentCert contract check(s) failed`);
  process.exit(1);
}
console.log("\nAgentCert MCP contract checks passed ✅");
