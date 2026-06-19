import { z } from "zod";
import { postAgentCertIssue } from "../client.js";

export const agentCertIssueToolName = "agentcert_issue";

export const agentCertIssueToolDescription =
  "Mint a verifiable AgentCert for an AI agent off a completed TrustModel evaluation run. " +
  "AgentCert is the Certificate Authority for AI agents: it binds the agent's identity (its ANS " +
  "name) and owning org to its TrustScore in a cryptographically signed, continuously-revalidated " +
  "credential (W3C Verifiable Credential + X.509). Mint off an evaluation_run_id produced by " +
  "trustmodel_evaluate / trustmodel_evaluate_agent. Requires TRUSTMODEL_API_KEY. " +
  "Returns the signed cert: serial, status, validation_level (DV/OV/EV), the live TrustScore " +
  "snapshot (0–100), dimension scores, and the vc_jsonld + x509_pem documents. " +
  "Verify it any time (no key needed) with agentcert_verify.";

export const agentCertIssueToolSchema = {
  ans_name: z
    .string()
    .describe(
      "Agent Naming Service name to bind the cert to, e.g. 'helpbot.cisco.com'. Required."
    ),
  evaluation_run_id: z
    .union([
      z.number().int().positive(),
      z.string().regex(/^\d+$/, "evaluation_run_id must be a positive integer."),
    ])
    .describe(
      "Integer evaluation run id to mint the cert from (e.g. an id returned by trustmodel_evaluate). " +
        "Must belong to your organization. Required."
    ),
  subject_agent_id: z
    .string()
    .optional()
    .describe("Optional agent identifier to bind; derived from the eval run when omitted."),
  auditor_slug: z
    .string()
    .optional()
    .describe("Optional auditor slug to link the cert to a registered Auditor."),
  validity_days: z
    .number()
    .int()
    .min(1)
    .max(825)
    .optional()
    .describe("Optional cert lifetime in days (1–825). Backend default is 90."),
};

export async function handleAgentCertIssue(args: {
  ans_name: string;
  evaluation_run_id: number | string;
  subject_agent_id?: string;
  auditor_slug?: string;
  validity_days?: number;
}): Promise<unknown> {
  return postAgentCertIssue({
    ans_name: args.ans_name,
    evaluation_run_id: Number(args.evaluation_run_id),
    subject_agent_id: args.subject_agent_id,
    auditor_slug: args.auditor_slug,
    validity_days: args.validity_days,
  });
}
