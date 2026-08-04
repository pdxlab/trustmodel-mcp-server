// Self-contained reputation gate for the reference server (TRUS-1584).
// Mirrors the shipped SDK/MCP gate; inlined so the example runs stand-alone.

const BASE_URL = process.env.TRUSTMODEL_BASE_URL ?? "https://api.trustmodel.ai";
export const ALLOW = "allow";
export const CHALLENGE = "challenge";
export const BLOCK = "block";

export async function getReputation(agent, opts = {}) {
  const base = (opts.baseUrl ?? BASE_URL).replace(/\/$/, "");
  const f = opts.fetchImpl ?? fetch;
  const r = await f(`${base}/v1/reputation/${encodeURIComponent(agent)}/`, {
    headers: { accept: "application/json" },
  });
  return r.json();
}

export function decide(rep, policy = {}) {
  const minScore = policy.minScore ?? 70;
  const blockBelow = policy.blockBelow ?? 40;
  if (!rep.found) {
    return { action: policy.blockUnknown ? BLOCK : CHALLENGE, reason: "unknown_agent", reputation: rep };
  }
  if (rep.revoked) return { action: BLOCK, reason: "revoked", reputation: rep };
  const s = rep.trust_score ?? 0;
  if (s < blockBelow) return { action: BLOCK, reason: "low_trust_score", reputation: rep };
  if (s < minScore) return { action: CHALLENGE, reason: "medium_trust_score", reputation: rep };
  return { action: ALLOW, reason: "ok", reputation: rep };
}

export async function gate(agent, policy = {}, opts = {}) {
  return decide(await getReputation(agent, opts), policy);
}
