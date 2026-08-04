// Offline AgentCert verification tests (TRUS-1575, MCP side).
// Generates a throwaway root -> issuing CA -> agent leaf (with the same
// custom-OID trust extensions the gateway CAS backend stamps) and checks the
// offline verifier. Run with: npm run build && node --test tests/agentcert-verify-offline.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import * as x509 from "@peculiar/x509";
import { verifyCertificate, OID_ARC } from "../dist/agentcert-pki.js";

x509.cryptoProvider.set(globalThis.crypto);
const ALG = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" };
const DAY = 86_400_000;

function hexSerial() {
  const a = new Uint8Array(8);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function derUtf8(s) {
  const body = new TextEncoder().encode(s);
  let header;
  if (body.length < 0x80) {
    header = Uint8Array.of(0x0c, body.length);
  } else {
    let len = body.length;
    const out = [];
    while (len) {
      out.unshift(len & 0xff);
      len >>= 8;
    }
    header = Uint8Array.of(0x0c, 0x80 | out.length, ...out);
  }
  return new Uint8Array([...header, ...body]);
}

async function genKeys() {
  return globalThis.crypto.subtle.generateKey(ALG, false, ["sign", "verify"]);
}

async function makeCa(cn, signer) {
  const keys = await genKeys();
  const now = Date.now();
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: hexSerial(),
    subject: `CN=${cn}`,
    issuer: signer ? signer.cert.subject : `CN=${cn}`,
    notBefore: new Date(now - DAY),
    notAfter: new Date(now + 365 * DAY),
    signingAlgorithm: ALG,
    publicKey: keys.publicKey,
    signingKey: signer ? signer.key : keys.privateKey,
    extensions: [new x509.BasicConstraintsExtension(true, undefined, true)],
  });
  return { cert, key: keys.privateKey };
}

async function makeLeaf(ans, issuer, { notAfterDays = 90 } = {}) {
  const keys = await genKeys();
  const now = Date.now();
  return x509.X509CertificateGenerator.create({
    serialNumber: hexSerial(),
    subject: `CN=${ans}`,
    issuer: issuer.cert.subject,
    notBefore: new Date(now - DAY),
    notAfter: new Date(now + notAfterDays * DAY),
    signingAlgorithm: ALG,
    publicKey: keys.publicKey,
    signingKey: issuer.key,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.SubjectAlternativeNameExtension([{ type: "url", value: `ans:${ans}` }]),
      new x509.Extension(`${OID_ARC}.1`, false, derUtf8("88.00")),
      new x509.Extension(`${OID_ARC}.2`, false, derUtf8("OV")),
      new x509.Extension(`${OID_ARC}.3`, false, derUtf8("https://api.trustmodel.ai/v1/agentcert/transparency/deadbeef")),
      new x509.Extension(`${OID_ARC}.4`, false, derUtf8('{"accuracy":80.0,"safety":90.0}')),
    ],
  });
}

async function chain() {
  const root = await makeCa("TrustModel Agent Trust Root");
  const issuing = await makeCa("TrustModel AgentCert Issuing CA", root);
  return { root, issuing };
}

test("valid leaf verifies and parses extensions", async () => {
  const { root, issuing } = await chain();
  const leaf = await makeLeaf("acme.support-bot.v1", issuing);

  const res = await verifyCertificate(leaf.toString("pem"), {
    chainPem: issuing.cert.toString("pem"),
    rootPem: root.cert.toString("pem"),
  });

  assert.equal(res.verified, true);
  assert.equal(res.chain_verified, true);
  assert.equal(res.offline, true);
  assert.equal(res.status, "active");
  assert.equal(res.trust_score, 88);
  assert.equal(res.validation_level, "OV");
  assert.equal(res.ans_name, "acme.support-bot.v1");
  assert.ok(res.transparency_url.endsWith("/deadbeef"));
  assert.deepEqual(res.dimension_scores, { accuracy: 80, safety: 90 });
});

test("wrong root fails the chain", async () => {
  const { root, issuing } = await chain();
  void root;
  const leaf = await makeLeaf("acme.bot.v1", issuing);
  const other = await makeCa("Someone Else Root");

  const res = await verifyCertificate(leaf.toString("pem"), {
    chainPem: issuing.cert.toString("pem"),
    rootPem: other.cert.toString("pem"),
  });

  assert.equal(res.chain_verified, false);
  assert.equal(res.verified, false);
});

test("expired leaf is not verified", async () => {
  const { root, issuing } = await chain();
  const leaf = await makeLeaf("acme.bot.v1", issuing, { notAfterDays: -1 });

  const res = await verifyCertificate(leaf.toString("pem"), {
    chainPem: issuing.cert.toString("pem"),
    rootPem: root.cert.toString("pem"),
  });

  assert.equal(res.status, "expired");
  assert.equal(res.verified, false);
});

test("missing trust anchor throws", async () => {
  const { issuing } = await chain();
  const leaf = await makeLeaf("acme.bot.v1", issuing);
  delete process.env.TRUSTMODEL_AGENTCERT_ROOT_PEM;

  await assert.rejects(
    () => verifyCertificate(leaf.toString("pem"), { chainPem: issuing.cert.toString("pem") }),
    /No TrustModel AgentCert root configured/,
  );
});
