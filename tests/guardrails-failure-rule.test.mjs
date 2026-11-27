// TRUS-2550: which guardrails failures may fail open.
//
// Real fetch against stub servers started inside each test, never a stubbed fetch.
// All data synthetic. Network use is loopback only, except the NXDOMAIN case, which
// resolves a `.invalid` name (RFC 6761: never resolves) and skips if this machine's
// resolver cannot say so.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as dns } from "node:dns";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { handleGuardrails } from "../dist/tools/guardrails.js";

const KEY = "synthetic-guardrails-test-key";
const MARKER = "SYNTHETIC-SERVER-TEXT-7f3a";
const ACTION = {
  agent_id: "synthetic-agent",
  action_type: "send_email",
  action_payload: { to: "synthetic@example.invalid" },
};
const ENV_KEYS = [
  "TRUSTMODEL_API_KEY",
  "TRUSTMODEL_BASE_URL",
  "TRUSTMODEL_GUARDRAIL_FAIL_MODE",
  "TRUSTMODEL_GUARDRAIL_TIMEOUT_MS",
];
const MODES = ["fail_open", "fail_closed"];

/** Run the tool with this environment; capture anything it logs. */
async function check(vars) {
  const settings = {
    TRUSTMODEL_API_KEY: KEY,
    TRUSTMODEL_GUARDRAIL_TIMEOUT_MS: "2000",
    ...vars,
  };
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) {
    if (settings[k] === undefined) delete process.env[k];
    else process.env[k] = settings[k];
  }
  const logs = [];
  const originals = {};
  for (const method of ["log", "info", "warn", "error", "debug"]) {
    originals[method] = console[method];
    console[method] = (...a) => logs.push(a.map(String).join(" "));
  }
  try {
    const result = await handleGuardrails(ACTION);
    return { result, logs: logs.join("\n") };
  } finally {
    Object.assign(console, originals);
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

/** A loopback HTTP server that records every request it receives. */
async function stub(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers });
    handler(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return {
    port,
    base: `http://127.0.0.1:${port}`,
    requests,
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

function reply(status, body, contentType = "application/json") {
  return (_req, res) => {
    res.writeHead(status, { "Content-Type": contentType });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
}

/** A port nothing listens on: bind, read the port, close. */
async function closedPort() {
  const s = await stub(() => {});
  await s.close();
  return s.port;
}

function assertNoLeak({ result, logs }, ...secrets) {
  const text = JSON.stringify(result) + logs;
  for (const secret of secrets) assert.ok(!text.includes(secret), `leaked ${secret}`);
}

// ── Aurora answered with a decision ─────────────────────────────────────────

test("an allow decision allows and sends the documented request", async () => {
  const s = await stub(reply(200, { decision: "allow", policy_id: "p-1" }));
  try {
    const { result } = await check({ TRUSTMODEL_BASE_URL: s.base });
    assert.equal(result.allowed, true);
    assert.equal(result.decision, "allow");
    assert.equal(s.requests.length, 1);
    assert.equal(s.requests[0].method, "POST");
    assert.equal(s.requests[0].url, "/sdk/v1/guardrails/check");
    assert.equal(s.requests[0].headers.authorization, `Bearer ${KEY}`);
  } finally {
    await s.close();
  }
});

for (const mode of MODES) {
  test(`${mode}: a deny decision blocks`, async () => {
    const s = await stub(reply(200, { decision: "deny" }));
    try {
      const { result } = await check({ TRUSTMODEL_BASE_URL: s.base, TRUSTMODEL_GUARDRAIL_FAIL_MODE: mode });
      assert.equal(result.allowed, false);
    } finally {
      await s.close();
    }
  });
}

// ── Configuration errors: never an allow, nothing sent (Part A) ─────────────

for (const mode of MODES) {
  test(`SECURITY ${mode}: no API key → configuration error, no request sent`, async () => {
    const s = await stub(reply(200, { decision: "allow" }));
    try {
      const { result } = await check({
        TRUSTMODEL_API_KEY: undefined,
        TRUSTMODEL_BASE_URL: s.base,
        TRUSTMODEL_GUARDRAIL_FAIL_MODE: mode,
      });
      assert.equal(result.allowed, false);
      assert.equal(result.decision, "transport_error");
      assert.equal(result.reason, "guardrail_configuration_error");
      assert.equal(result.evidence.stage, "TRUSTMODEL_API_KEY is not set");
      assert.equal(s.requests.length, 0);
    } finally {
      await s.close();
    }
  });

  test(`SECURITY ${mode}: base URL without a scheme → configuration error, no request sent`, async () => {
    const s = await stub(reply(200, { decision: "allow" }));
    try {
      // "host:port" parses as a URL whose scheme is the host name.
      for (const base of ["api.trustmodel.invalid", `localhost:${s.port}`]) {
        const { result } = await check({ TRUSTMODEL_BASE_URL: base, TRUSTMODEL_GUARDRAIL_FAIL_MODE: mode });
        assert.equal(result.allowed, false, base);
        assert.equal(result.reason, "guardrail_configuration_error", base);
      }
      assert.equal(s.requests.length, 0);
    } finally {
      await s.close();
    }
  });

  test(`SECURITY ${mode}: base URL with credentials → configuration error; credentials not echoed`, async () => {
    const s = await stub(reply(200, { decision: "allow" }));
    try {
      const out = await check({
        TRUSTMODEL_BASE_URL: `http://svc:${MARKER}@127.0.0.1:${s.port}`,
        TRUSTMODEL_GUARDRAIL_FAIL_MODE: mode,
      });
      assert.equal(out.result.allowed, false);
      assert.equal(out.result.reason, "guardrail_configuration_error");
      assert.equal(s.requests.length, 0);
      assertNoLeak(out, MARKER);
    } finally {
      await s.close();
    }
  });

  test(`SECURITY ${mode}: an unusable timeout setting → configuration error`, async () => {
    for (const value of ["abc", "0", "-5", "1.5", "120001"]) {
      const { result } = await check({
        TRUSTMODEL_BASE_URL: "http://127.0.0.1:9",
        TRUSTMODEL_GUARDRAIL_FAIL_MODE: mode,
        TRUSTMODEL_GUARDRAIL_TIMEOUT_MS: value,
      });
      assert.equal(result.allowed, false, value);
      assert.equal(result.reason, "guardrail_configuration_error", value);
    }
  });
}

// ── No answer, no outage evidence: never an allow (Part A) ──────────────────

for (const mode of MODES) {
  test(`SECURITY ${mode}: TLS protocol mismatch (https to a plain-HTTP port) → blocks`, async () => {
    const s = await stub(reply(200, { decision: "allow" }));
    try {
      const { result } = await check({
        TRUSTMODEL_BASE_URL: `https://127.0.0.1:${s.port}`,
        TRUSTMODEL_GUARDRAIL_FAIL_MODE: mode,
      });
      assert.equal(result.allowed, false);
      assert.equal(result.decision, "transport_error");
      assert.equal(
        result.reason,
        mode === "fail_open"
          ? "guardrail_transport_failure_not_an_outage"
          : "guardrail_transport_failure_fail_closed"
      );
      assert.equal(s.requests.length, 0);
    } finally {
      await s.close();
    }
  });
}

test("SECURITY fail_open: a certificate that fails verification → blocks", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "trus2550-"));
  try {
    try {
      execFileSync("openssl", [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
        "-subj", "/CN=127.0.0.1",
        "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
      ], { stdio: "ignore" });
    } catch {
      t.skip("openssl is not available to make a self-signed certificate");
      return;
    }
    const requests = [];
    const server = https.createServer(
      { key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) },
      (req, res) => {
        requests.push(req.url);
        reply(200, { decision: "allow" })(req, res);
      }
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const { result } = await check({
        TRUSTMODEL_BASE_URL: `https://127.0.0.1:${server.address().port}`,
        TRUSTMODEL_GUARDRAIL_FAIL_MODE: "fail_open",
      });
      assert.equal(result.allowed, false);
      assert.equal(result.reason, "guardrail_transport_failure_not_an_outage");
      assert.equal(requests.length, 0);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SECURITY fail_open: a host name that does not resolve (NXDOMAIN) → blocks", async (t) => {
  const host = "api-trustmodel.invalid";
  const probe = await dns.lookup(host).then(() => "resolved", (e) => e.code);
  if (probe !== "ENOTFOUND") {
    t.skip(`this resolver answers ${probe} for ${host}, not NXDOMAIN`);
    return;
  }
  const { result } = await check({
    TRUSTMODEL_BASE_URL: `https://${host}`,
    TRUSTMODEL_GUARDRAIL_FAIL_MODE: "fail_open",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "guardrail_transport_failure_not_an_outage");
  assert.equal(result.evidence.cause, "ENOTFOUND");
});

// ── Aurora unavailable: fail_open allows, fail_closed blocks (Part B) ───────

for (const mode of MODES) {
  const open = mode === "fail_open";

  test(`${mode}: connection refused → ${open ? "allow" : "blocks"}`, async () => {
    const port = await closedPort();
    const { result } = await check({
      TRUSTMODEL_BASE_URL: `http://127.0.0.1:${port}`,
      TRUSTMODEL_GUARDRAIL_FAIL_MODE: mode,
    });
    assert.equal(result.allowed, open);
    assert.equal(result.decision, open ? "allow" : "transport_error");
    assert.equal(
      result.reason,
      open ? "guardrail_transport_failure_fail_open" : "guardrail_transport_failure_fail_closed"
    );
    assert.equal(result.evidence.cause, "ECONNREFUSED");
  });

  test(`${mode}: Aurora accepts and never answers → returns within the timeout, ${open ? "allow" : "blocks"}`, async () => {
    const s = await stub(() => {}); // never responds
    try {
      const started = Date.now();
      const { result } = await check({
        TRUSTMODEL_BASE_URL: s.base,
        TRUSTMODEL_GUARDRAIL_FAIL_MODE: mode,
        TRUSTMODEL_GUARDRAIL_TIMEOUT_MS: "300",
      });
      assert.ok(Date.now() - started < 2000, "did not honour the timeout");
      assert.equal(result.allowed, open);
      assert.equal(result.evidence.timed_out, true);
      assert.equal(s.requests.length, 1);
    } finally {
      await s.close();
    }
  });

  test(`${mode}: a 5xx → ${open ? "allow" : "HTTP refusal, as before"}; server text not exposed`, async () => {
    const s = await stub(reply(503, { detail: MARKER }));
    try {
      const out = await check({ TRUSTMODEL_BASE_URL: s.base, TRUSTMODEL_GUARDRAIL_FAIL_MODE: mode });
      assert.equal(out.result.allowed, open);
      assert.equal(out.result.evidence.http_status, 503);
      if (open) {
        assert.equal(out.result.decision, "allow");
        assert.equal(out.result.evidence.fail_open, true);
      } else {
        assert.equal(out.result.decision, "refused");
        assert.equal(out.result.reason, "guardrail_http_refusal");
      }
      assertNoLeak(out, MARKER);
    } finally {
      await s.close();
    }
  });

  test(`${mode}: a 2xx whose body is not JSON → ${open ? "allow" : "blocks"}; body not exposed`, async () => {
    const s = await stub(reply(200, `<html>${MARKER}</html>`, "text/html"));
    try {
      const out = await check({ TRUSTMODEL_BASE_URL: s.base, TRUSTMODEL_GUARDRAIL_FAIL_MODE: mode });
      assert.equal(out.result.allowed, open);
      assert.equal(out.result.evidence.unreadable_response, true);
      assertNoLeak(out, MARKER);
    } finally {
      await s.close();
    }
  });
}

// ── Aurora answered with a refusal: never an allow ──────────────────────────

for (const mode of MODES) {
  for (const status of [400, 401, 403, 429]) {
    test(`SECURITY ${mode}: HTTP ${status} → refusal; server text not exposed`, async () => {
      const s = await stub(reply(status, { detail: MARKER }));
      try {
        const out = await check({ TRUSTMODEL_BASE_URL: s.base, TRUSTMODEL_GUARDRAIL_FAIL_MODE: mode });
        assert.equal(out.result.allowed, false);
        assert.equal(out.result.decision, "refused");
        assert.equal(out.result.evidence.http_status, status);
        assertNoLeak(out, MARKER);
      } finally {
        await s.close();
      }
    });
  }

  test(`SECURITY ${mode}: 2xx JSON that is not an object → refusal`, async () => {
    for (const body of [["allow"], "allow", null, 1]) {
      const s = await stub(reply(200, JSON.stringify(body)));
      try {
        const { result } = await check({ TRUSTMODEL_BASE_URL: s.base, TRUSTMODEL_GUARDRAIL_FAIL_MODE: mode });
        assert.equal(result.allowed, false, JSON.stringify(body));
        assert.equal(result.reason, "guardrail_malformed_response");
      } finally {
        await s.close();
      }
    }
  });
}
