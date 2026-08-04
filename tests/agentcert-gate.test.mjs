// AgentCert gate + policy (TRUS-1582 / 1589, MCP side).
// Run with: npm run build && node --test tests/agentcert-gate.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, gate, ALLOW, BLOCK, CHALLENGE } from "../dist/agentcert-gate.js";

function rep(o = {}) {
  return {
    found: true, ans_name: "acme.bot.v1", trust_score: 85,
    validation_level: "OV", verified: true, revoked: false, ...o,
  };
}

test("high score allows", () => {
  const d = evaluate(rep());
  assert.equal(d.action, ALLOW);
  assert.equal(d.allowed, true);
});

test("mid score challenges", () => {
  assert.equal(evaluate(rep({ trust_score: 55 })).action, CHALLENGE);
});

test("low score blocks", () => {
  const d = evaluate(rep({ trust_score: 20 }));
  assert.equal(d.action, BLOCK);
  assert.equal(d.reason, "low_trust_score");
});

test("revoked blocks regardless of score", () => {
  const d = evaluate(rep({ trust_score: 99, revoked: true }));
  assert.equal(d.action, BLOCK);
  assert.equal(d.reason, "revoked");
});

test("unknown agent challenges by default", () => {
  assert.equal(evaluate({ found: false }).action, CHALLENGE);
});

test("unknown agent blocks when strict", () => {
  assert.equal(evaluate({ found: false }, { blockUnknown: true }).action, BLOCK);
});

test("tier gate challenges a disallowed tier", () => {
  const d = evaluate(rep({ validation_level: "DV" }), { allowedTiers: ["OV", "EV"] });
  assert.equal(d.action, CHALLENGE);
  assert.equal(d.reason, "tier_not_allowed");
});

test("gate() fetches reputation then decides", async () => {
  const fakeFetch = async () => ({ json: async () => rep({ trust_score: 92 }) });
  const d = await gate("acme.bot.v1", {}, { fetchImpl: fakeFetch });
  assert.equal(d.action, ALLOW);
  assert.equal(d.reputation.trust_score, 92);
});
