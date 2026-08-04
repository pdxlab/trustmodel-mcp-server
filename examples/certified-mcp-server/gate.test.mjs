import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, gate, ALLOW, BLOCK, CHALLENGE } from "./gate.mjs";

function rep(o = {}) {
  return { found: true, ans_name: "acme.bot.v1", trust_score: 85, revoked: false, ...o };
}

test("gate policy: allow / challenge / block / revoked / unknown", () => {
  assert.equal(decide(rep()).action, ALLOW);
  assert.equal(decide(rep({ trust_score: 55 })).action, CHALLENGE);
  assert.equal(decide(rep({ trust_score: 20 })).action, BLOCK);
  assert.equal(decide(rep({ trust_score: 99, revoked: true })).reason, "revoked");
  assert.equal(decide({ found: false }).action, CHALLENGE);
});

test("gate() fetches then decides — trusted agent allowed", async () => {
  const fake = async () => ({ json: async () => rep({ trust_score: 91 }) });
  const d = await gate("acme.bot.v1", { minScore: 70 }, { fetchImpl: fake });
  assert.equal(d.action, ALLOW);
});

test("gate() blocks a revoked agent", async () => {
  const fake = async () => ({ json: async () => rep({ revoked: true }) });
  const d = await gate("acme.bot.v1", {}, { fetchImpl: fake });
  assert.equal(d.action, BLOCK);
});
