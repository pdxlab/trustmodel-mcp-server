import { z } from "zod";
import { getAgentCertVerify } from "../client.js";

export const agentCertVerifyToolName = "agentcert_verify";

export const agentCertVerifyToolDescription =
  "Verify an AI agent's AgentCert via the public /v1/verify/<agent> endpoint " +
  "(TrustModel SKU 4: Cert + Assurance). Checks the cert signature and " +
  "revocation status and returns the agent's verified status, its live 0-100 " +
  "TrustScore, and cert freshness (how recently the cert was revalidated). " +
  "Because certs are continuously revalidated rather than point-in-time, a " +
  "previously-issued cert can read as not-verified if the agent's live score " +
  "has drifted below threshold or the cert was revoked. This endpoint is " +
  "public and needs no API key — pass the agent_id used at issuance.";

export const agentCertVerifyToolSchema = {
  agent: z
    .string()
    .min(1)
    .describe(
      "The agent identifier (agent_id / ANS handle) to verify — the same value passed to agentcert_issue."
    ),
};

export async function handleAgentCertVerify(args: {
  agent: string;
}): Promise<unknown> {
  return getAgentCertVerify(args.agent);
}
