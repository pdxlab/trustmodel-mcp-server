import { z } from "zod";
import { getAgentCertVerify } from "../client.js";

export const agentCertVerifyToolName = "agentcert_verify";

export const agentCertVerifyToolDescription =
  "Verify an AI agent's AgentCert via the public TrustModel verify endpoint. " +
  "Checks the cryptographic signature and revocation status and returns the agent's current (live) " +
  "TrustScore (0–100), validation_level (DV/OV/EV), and liveness/freshness. Verification is " +
  "continuous: a cert whose live score has drifted below threshold — or which was auto-revoked on " +
  "telemetry drift — verifies as verified=false even with an intact signature. " +
  "Public — no API key required.";

export const agentCertVerifyToolSchema = {
  agent: z
    .string()
    .describe(
      "Agent to verify — its ANS name (e.g. 'helpbot.cisco.com') or the subject_agent_id used at issuance."
    ),
};

export async function handleAgentCertVerify(args: { agent: string }): Promise<unknown> {
  return getAgentCertVerify(args.agent);
}
