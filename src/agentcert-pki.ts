/**
 * Offline AgentCert verification (TRUS-1575, MCP side).
 *
 * Verifies an AgentCert X.509 leaf entirely client-side against the TrustModel
 * Agent Trust Root — no server round-trip. Confirms the leaf chains to our root,
 * is inside its validity window, and reads the TrustScore / validation level /
 * transparency-log URL / dimension scores from the custom-OID extensions the
 * issuing CA stamps (EPIC TRUS-1568). Mirrors the Python SDK verifier.
 *
 * AgentCert is a private PKI, so the trust anchor is distributed with the tool
 * (the Let's-Encrypt model). Root resolution: explicit `rootPem` ->
 * TRUSTMODEL_AGENTCERT_ROOT_PEM env (a PEM value or a path) -> the bundled
 * data/trustmodel_agentcert_root.pem.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as x509 from "@peculiar/x509";

// Use Node's native WebCrypto as the crypto provider.
x509.cryptoProvider.set(globalThis.crypto as Crypto);

// Kept in lockstep with aurora-gateway AGENTCERT_OID_ARC (provisional; TRUS-1570).
export const OID_ARC = "1.3.6.1.4.1.58888.1";
export const OID_TRUST_SCORE = `${OID_ARC}.1`;
export const OID_VALIDATION_LEVEL = `${OID_ARC}.2`;
export const OID_TRANSPARENCY_URL = `${OID_ARC}.3`;
export const OID_DIMENSION_SCORES = `${OID_ARC}.4`;

const ROOT_ENV = "TRUSTMODEL_AGENTCERT_ROOT_PEM";
const PACKAGED_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "data",
  "trustmodel_agentcert_root.pem",
);

export interface OfflineVerification {
  found: boolean;
  verified: boolean;
  chain_verified: boolean;
  offline: true;
  status: string | null;
  trust_score: number | null;
  validation_level: string | null;
  transparency_url: string | null;
  dimension_scores: Record<string, number>;
  ans_name: string | null;
  serial: string | null;
  expires_at: string | null;
}

export class TrustAnchorError extends Error {}

/** Decode an ASN.1 DER UTF8String (tag 0x0C) written by the issuer. */
function derReadUtf8(bytes: Uint8Array): string {
  if (bytes.length === 0 || bytes[0] !== 0x0c) {
    throw new Error("extension value is not a DER UTF8String");
  }
  let idx = 1;
  let len = bytes[idx++];
  if (len & 0x80) {
    const num = len & 0x7f;
    len = 0;
    for (let i = 0; i < num; i++) len = (len << 8) | bytes[idx++];
  }
  return new TextDecoder().decode(bytes.subarray(idx, idx + len));
}

function resolveRootPem(rootPem?: string): string {
  if (rootPem) return rootPem;
  const envVal = process.env[ROOT_ENV];
  if (envVal) {
    if (envVal.includes("BEGIN CERTIFICATE")) return envVal;
    if (existsSync(envVal)) return readFileSync(envVal, "utf8");
  }
  if (existsSync(PACKAGED_ROOT)) {
    const data = readFileSync(PACKAGED_ROOT, "utf8");
    if (data.includes("BEGIN CERTIFICATE")) return data;
  }
  throw new TrustAnchorError(
    `No TrustModel AgentCert root configured. Pass rootPem, set ${ROOT_ENV}, ` +
      "or ship data/trustmodel_agentcert_root.pem.",
  );
}

function loadCerts(pem?: string): x509.X509Certificate[] {
  if (!pem) return [];
  const matches =
    pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  return matches.map((m) => new x509.X509Certificate(m));
}

async function chainToRoot(
  leaf: x509.X509Certificate,
  intermediates: x509.X509Certificate[],
  roots: x509.X509Certificate[],
): Promise<boolean> {
  const pool = [...intermediates, ...roots];
  let current = leaf;
  for (let hops = 0; hops <= pool.length + 1; hops++) {
    for (const root of roots) {
      if (
        current.issuer === root.subject &&
        (await current.verify({ publicKey: root, signatureOnly: true }))
      ) {
        return true;
      }
    }
    const issuer = pool.find((c) => c.subject === current.issuer);
    if (!issuer) return false;
    if (!(await current.verify({ publicKey: issuer, signatureOnly: true }))) return false;
    current = issuer;
  }
  return false;
}

function extString(cert: x509.X509Certificate, oid: string): string | null {
  const ext = cert.getExtension(oid);
  if (!ext) return null;
  try {
    return derReadUtf8(new Uint8Array(ext.value));
  } catch {
    return null;
  }
}

function ansName(cert: x509.X509Certificate): string | null {
  const san = cert.getExtension(x509.SubjectAlternativeNameExtension);
  if (!san) return null;
  for (const name of san.names.toJSON()) {
    if (name.type === "url" && name.value.startsWith("ans:")) {
      return name.value.slice("ans:".length);
    }
  }
  return null;
}

export async function verifyCertificate(
  leafPem: string,
  opts: { chainPem?: string; rootPem?: string; atTime?: Date } = {},
): Promise<OfflineVerification> {
  const leaf = loadCerts(leafPem)[0];
  if (!leaf) throw new Error("leafPem did not contain a certificate");
  const intermediates = loadCerts(opts.chainPem);
  const roots = loadCerts(resolveRootPem(opts.rootPem));

  const chainOk = await chainToRoot(leaf, intermediates, roots);

  const now = opts.atTime ?? new Date();
  const expired = now > leaf.notAfter;
  const notYetValid = now < leaf.notBefore;
  const status = expired ? "expired" : chainOk ? "active" : null;

  const scoreStr = extString(leaf, OID_TRUST_SCORE);
  const dimsStr = extString(leaf, OID_DIMENSION_SCORES);
  let dimensionScores: Record<string, number> = {};
  if (dimsStr) {
    try {
      const parsed = JSON.parse(dimsStr) as Record<string, unknown>;
      dimensionScores = Object.fromEntries(
        Object.entries(parsed).map(([k, v]) => [k, Number(v)]),
      );
    } catch {
      dimensionScores = {};
    }
  }

  return {
    found: true,
    verified: chainOk && !expired && !notYetValid,
    chain_verified: chainOk,
    offline: true,
    status,
    trust_score: scoreStr !== null ? Number(scoreStr) : null,
    validation_level: extString(leaf, OID_VALIDATION_LEVEL),
    transparency_url: extString(leaf, OID_TRANSPARENCY_URL),
    dimension_scores: dimensionScores,
    ans_name: ansName(leaf),
    serial: leaf.serialNumber,
    expires_at: leaf.notAfter.toISOString(),
  };
}
