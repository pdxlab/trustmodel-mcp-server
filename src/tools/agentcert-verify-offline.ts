import { z } from "zod";
import { verifyCertificate } from "../agentcert-pki.js";

export const agentCertVerifyOfflineToolName = "agentcert_verify_offline";

export const agentCertVerifyOfflineToolDescription =
  "Verify an AgentCert X.509 certificate fully client-side — no network call. " +
  "Chains the leaf to the bundled TrustModel Agent Trust Root, checks the validity " +
  "window, and reads the TrustScore (0–100), validation_level (DV/OV/EV), " +
  "transparency-log URL, and per-dimension scores from the certificate's custom-OID " +
  "extensions. AgentCert is a private PKI, so the trust anchor ships with the tool " +
  "(set TRUSTMODEL_AGENTCERT_ROOT_PEM, or pass root_pem, if it is not bundled). Use " +
  "this for offline / air-gapped verification; use agentcert_verify for the live, " +
  "server-side continuous check.";

export const agentCertVerifyOfflineToolSchema = {
  leaf_pem: z
    .string()
    .describe("PEM-encoded AgentCert leaf certificate to verify."),
  chain_pem: z
    .string()
    .optional()
    .describe("PEM issuer chain returned at issuance (if not in the bundled anchor)."),
  root_pem: z
    .string()
    .optional()
    .describe("Override the TrustModel root trust anchor (else env / bundled root)."),
};

export async function handleAgentCertVerifyOffline(args: {
  leaf_pem: string;
  chain_pem?: string;
  root_pem?: string;
}): Promise<unknown> {
  if (!args.leaf_pem) {
    throw new Error("agentcert_verify_offline: `leaf_pem` is required");
  }
  return verifyCertificate(args.leaf_pem, {
    chainPem: args.chain_pem,
    rootPem: args.root_pem,
  });
}
