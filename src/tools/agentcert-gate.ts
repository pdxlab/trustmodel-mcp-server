import { z } from "zod";
import { gate } from "../agentcert-gate.js";

export const agentCertGateToolName = "agentcert_gate";

export const agentCertGateToolDescription =
  "Decide allow / challenge / block for a calling AI agent before granting access to your MCP " +
  "tools. Looks up the agent's TrustModel reputation (0–100 TrustScore + cert status) by ANS " +
  "name and applies a policy: a revoked cert or a very-low score → block; a mid score or an " +
  "unknown/unrated agent → challenge; a high score → allow. This is the demand-side gate that " +
  "lets an MCP server refuse untrusted agents. Public — no API key required.";

export const agentCertGateToolSchema = {
  agent: z.string().describe("Agent to gate — its ANS name (e.g. 'acme.support-bot.v1')."),
  min_score: z.number().optional().describe("Allow at/above this TrustScore (default 70)."),
  block_below: z.number().optional().describe("Block below this TrustScore (default 40)."),
  allowed_tiers: z
    .array(z.string())
    .optional()
    .describe("Only allow these validation tiers (DV/OV/EV/IV); omit for any."),
  block_unknown: z
    .boolean()
    .optional()
    .describe("Block unknown/unrated agents instead of challenging (default false)."),
};

export async function handleAgentCertGate(args: {
  agent: string;
  min_score?: number;
  block_below?: number;
  allowed_tiers?: string[];
  block_unknown?: boolean;
}): Promise<unknown> {
  if (!args.agent) {
    throw new Error("agentcert_gate: `agent` is required");
  }
  return gate(args.agent, {
    minScore: args.min_score,
    blockBelow: args.block_below,
    allowedTiers: args.allowed_tiers,
    blockUnknown: args.block_unknown,
  });
}
