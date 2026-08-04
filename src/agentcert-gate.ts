/**
 * AgentCert verification gate (TRUS-1582, MCP side) + policy (TRUS-1589).
 *
 * The demand-side primitive an MCP server calls to refuse revoked / unrated /
 * below-threshold agents before granting access to its tools. Looks up the
 * agent's TrustModel reputation (TrustScore + cert status) by ANS name and
 * applies a policy → allow / challenge / block. Mirrors the Python SDK gate so
 * a trust decision is identical across MCP and the web/CDN rail (TRUS-1592).
 */

const BASE_URL = process.env.TRUSTMODEL_BASE_URL ?? "https://api.trustmodel.ai";

export const ALLOW = "allow";
export const CHALLENGE = "challenge";
export const BLOCK = "block";

export interface AgentReputation {
  found: boolean;
  ans_name?: string;
  trust_score?: number | null;
  cert_tier?: string | null;
  validation_level?: string | null;
  verified?: boolean;
  revoked?: boolean;
  recommended_action?: string;
  reason?: string;
}

export interface GatePolicy {
  minScore?: number; // allow at/above (default 70)
  blockBelow?: number; // block below (default 40)
  allowedTiers?: string[]; // only these validation tiers; empty/undefined = any
  blockOnRevoked?: boolean; // default true
  blockUnknown?: boolean; // unknown agent -> block (true) vs challenge (default false)
}

export interface GateDecision {
  action: string; // allow | challenge | block
  allowed: boolean;
  reason: string;
  reputation: AgentReputation;
}

export async function getReputation(
  agent: string,
  opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<AgentReputation> {
  const base = (opts.baseUrl ?? BASE_URL).replace(/\/$/, "");
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${base}/v1/reputation/${encodeURIComponent(agent)}/`, {
    headers: { accept: "application/json" },
  });
  return (await res.json()) as AgentReputation;
}

export function evaluate(rep: AgentReputation, policy: GatePolicy = {}): GateDecision {
  const minScore = policy.minScore ?? 70;
  const blockBelow = policy.blockBelow ?? 40;
  const blockOnRevoked = policy.blockOnRevoked ?? true;
  const blockUnknown = policy.blockUnknown ?? false;

  if (!rep.found) {
    const action = blockUnknown ? BLOCK : CHALLENGE;
    return { action, allowed: false, reason: "unknown_agent", reputation: rep };
  }
  if (blockOnRevoked && rep.revoked) {
    return { action: BLOCK, allowed: false, reason: "revoked", reputation: rep };
  }
  if (policy.allowedTiers?.length && !policy.allowedTiers.includes(rep.validation_level ?? "")) {
    return { action: CHALLENGE, allowed: false, reason: "tier_not_allowed", reputation: rep };
  }
  const score = rep.trust_score ?? 0;
  if (score < blockBelow) {
    return { action: BLOCK, allowed: false, reason: "low_trust_score", reputation: rep };
  }
  if (score < minScore) {
    return { action: CHALLENGE, allowed: false, reason: "medium_trust_score", reputation: rep };
  }
  return { action: ALLOW, allowed: true, reason: "ok", reputation: rep };
}

export async function gate(
  agent: string,
  policy: GatePolicy = {},
  opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<GateDecision> {
  return evaluate(await getReputation(agent, opts), policy);
}
