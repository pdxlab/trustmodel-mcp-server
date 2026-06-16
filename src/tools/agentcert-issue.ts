import { z } from "zod";
import { postAgentCertIssue } from "../client.js";

export const agentCertIssueToolName = "agentcert_issue";

export const agentCertIssueToolDescription =
  "Issue (mint) an AgentCert — a cryptographically verifiable certificate of " +
  "trust for an AI agent (TrustModel SKU 4: Cert + Assurance). The cert binds " +
  "the agent's identity (agent_id / ANS) and org to a trust signal drawn from " +
  "an evaluation. Supply the agent_id plus EITHER an evaluation_run_id (from " +
  "trustmodel_evaluate, trustmodel_evaluate_agent, or a free scan) OR an " +
  "explicit trust_score; the gateway resolves/validates whichever is present. " +
  "Returns the minted cert (id, signed credential, validation level, issued/" +
  "expiry timestamps) and the verification handle to use with agentcert_verify. " +
  "Unlike a point-in-time PDF, the cert is continuously revalidated against the " +
  "agent's live score.";

export const agentCertIssueToolSchema = {
  agent_id: z
    .string()
    .min(1)
    .describe(
      "Stable agent identifier the cert is bound to (e.g. an ANS name like " +
        "'acme.support.agent' or a registry id). Also used as the <agent> handle for agentcert_verify."
    ),
  agent_name: z
    .string()
    .optional()
    .describe("Optional human-readable display name for the agent."),
  evaluation_run_id: z
    .union([
      z.number().int().positive(),
      z.string().regex(/^\d+$/, "evaluation_run_id must be a positive integer."),
    ])
    .optional()
    .describe(
      "Integer evaluation/scan run id to mint the cert off of (from trustmodel_evaluate, " +
        "trustmodel_evaluate_agent, or a free scan). Provide this OR trust_score."
    ),
  trust_score: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe(
      "Explicit 0-100 TrustScore to mint the cert at, when no evaluation_run_id is available. " +
        "Provide this OR evaluation_run_id."
    ),
  organization: z
    .string()
    .optional()
    .describe("Optional org binding override. Defaults to the org bound to the API key."),
  validation_level: z
    .enum(["DV", "OV", "EV"])
    .optional()
    .describe(
      "Validation tier: DV (domain-validated), OV (org-validated), or EV (extended-validation). " +
        "Defaults to the gateway's policy for the supplied trust signal."
    ),
  metadata: z
    .record(z.unknown())
    .optional()
    .describe("Free-form metadata attached to the cert."),
};

export async function handleAgentCertIssue(args: {
  agent_id: string;
  agent_name?: string;
  evaluation_run_id?: number | string;
  trust_score?: number;
  organization?: string;
  validation_level?: string;
  metadata?: Record<string, unknown>;
}): Promise<unknown> {
  if (args.evaluation_run_id === undefined && args.trust_score === undefined) {
    throw new Error(
      "agentcert_issue requires either evaluation_run_id or trust_score to mint a cert."
    );
  }
  return postAgentCertIssue({
    agent_id: args.agent_id,
    agent_name: args.agent_name,
    evaluation_run_id:
      args.evaluation_run_id !== undefined ? Number(args.evaluation_run_id) : undefined,
    trust_score: args.trust_score,
    organization: args.organization,
    validation_level: args.validation_level,
    metadata: args.metadata,
  });
}
