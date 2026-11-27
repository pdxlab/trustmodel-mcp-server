import { z } from "zod";
import { buildGuardrailsCheckRequest, GuardrailsRequestBuildError } from "../client.js";

export const guardrailsToolName = "trustmodel_guardrails_check";

export const guardrailsToolDescription =
  "Check a proposed agent action against the organization's TrustModel policy " +
  "before execution. Only the literal decision `allow` may proceed; deny, " +
  "redact, unknown decisions, configuration errors, and transport failures block " +
  "when fail-closed.";

export const guardrailsToolSchema = {
  agent_id: z
    .string()
    .describe("Identifier of the agent proposing the action."),
  action_type: z
    .string()
    .describe("Action kind, for example 'tool_call', 'send_email', or 'decision'."),
  action_payload: z
    .record(z.unknown())
    .optional()
    .describe("Parameters or data the policy must evaluate."),
  subject_id: z
    .string()
    .optional()
    .describe("Optional identifier for the person or resource affected."),
  policy_name: z
    .string()
    .optional()
    .describe("Policy name; defaults to the organization's default policy."),
};

/** TRUS-2550. The request had no timeout, so a hung Aurora held the tool call
 *  until undici's own limits (minutes). */
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 120_000;

/** TRUS-2550. Positive evidence that Aurora or the network was unavailable: the
 *  only no-answer failures TRUSTMODEL_GUARDRAIL_FAIL_MODE=fail_open may turn into
 *  an allow. Same set as the Node SDK's OUTAGE_CAUSE_CODES (trustmodel-node-sdk
 *  src/http.ts) and the Python SDK's outage rule (TRUS-2170).
 *
 *  Deliberately absent: ENOTFOUND (a mistyped host fails on every call), TLS
 *  errors (a certificate that fails verification may mean interception), and
 *  any error without a code (nothing may have been sent). */
const OUTAGE_CAUSE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
]);

/** An identifier-shaped error code is safe to report; free text is not. */
const SAFE_TOKEN = /^[A-Za-z0-9_]{1,64}$/;

type GuardrailResult = Record<string, unknown>;

function failOpenSelected(): boolean {
  return (
    (process.env.TRUSTMODEL_GUARDRAIL_FAIL_MODE ?? "fail_closed").toLowerCase() === "fail_open"
  );
}

function timeoutMs(): number {
  const raw = process.env.TRUSTMODEL_GUARDRAIL_TIMEOUT_MS;
  if (raw === undefined || raw === "") return DEFAULT_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    throw new GuardrailsRequestBuildError(
      `TRUSTMODEL_GUARDRAIL_TIMEOUT_MS must be an integer from 1 to ${MAX_TIMEOUT_MS}`
    );
  }
  return value;
}

function causeCode(error: unknown): string | undefined {
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === "string" && SAFE_TOKEN.test(code) ? code : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Nothing was sent. Blocks in both fail modes. */
function configurationError(stage: string): GuardrailResult {
  return {
    decision: "transport_error",
    allowed: false,
    reason: "guardrail_configuration_error",
    trust_score: null,
    evidence: { configuration_error: true, stage },
  };
}

/** An HTTP response is a decision about this call, not an outage. */
function httpRefusal(status: number): GuardrailResult {
  return {
    decision: "refused",
    allowed: false,
    reason: "guardrail_http_refusal",
    trust_score: null,
    evidence: { http_refusal: true, http_status: status },
  };
}

/** Aurora could not give a decision: an outage, a 5xx, or a 2xx body that could
 *  not be read or is not JSON. fail_open allows; fail_closed blocks. */
function unavailable(
  failOpen: boolean,
  evidence: Record<string, unknown>
): GuardrailResult {
  return {
    decision: failOpen ? "allow" : "transport_error",
    allowed: failOpen,
    reason: failOpen
      ? "guardrail_transport_failure_fail_open"
      : "guardrail_transport_failure_fail_closed",
    trust_score: null,
    evidence: { transport_failure: true, ...(failOpen ? { fail_open: true } : {}), ...evidence },
  };
}

/**
 * Failure rule (TRUS-2550, same as the Python SDK after TRUS-2159 and TRUS-2170):
 *
 * - The request can't be built (no key, unusable URL or timeout): blocks, nothing sent.
 * - Aurora answered with a decision: only the literal `allow` proceeds.
 * - Aurora answered 4xx / 429 / 3xx, or 2xx JSON that is not an object: blocks.
 * - Aurora unavailable: fail_open allows, fail_closed blocks. "Unavailable" means
 *   no answer with outage evidence (OUTAGE_CAUSE_CODES or this tool's own
 *   timeout), a 5xx, or a 2xx body that can't be read or isn't JSON.
 * - No answer without outage evidence (NXDOMAIN, TLS, no code): blocks.
 *
 * Under fail_closed, a 5xx keeps its earlier `guardrail_http_refusal` result.
 * No result carries the server's body, the URL or an error message.
 */
export async function handleGuardrails(args: {
  agent_id: string;
  action_type: string;
  action_payload?: Record<string, unknown>;
  subject_id?: string;
  policy_name?: string;
}): Promise<GuardrailResult> {
  const failOpen = failOpenSelected();

  let request: { url: string; init: RequestInit };
  let limitMs: number;
  try {
    limitMs = timeoutMs();
    request = buildGuardrailsCheckRequest({
      agent_id: args.agent_id,
      action_type: args.action_type,
      action_payload: args.action_payload ?? {},
      subject_id: args.subject_id ?? "",
      policy_name: args.policy_name ?? "default",
    });
  } catch (error) {
    return configurationError(
      error instanceof GuardrailsRequestBuildError ? error.stage : "request could not be built"
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limitMs);
  try {
    let res: Response;
    try {
      res = await fetch(request.url, { ...request.init, signal: controller.signal });
    } catch (error) {
      const timedOut = controller.signal.aborted;
      const code = causeCode(error);
      const evidence = {
        ...(timedOut ? { timed_out: true } : {}),
        ...(code ? { cause: code } : {}),
      };
      if (timedOut || (code !== undefined && OUTAGE_CAUSE_CODES.has(code))) {
        return unavailable(failOpen, evidence);
      }
      // No evidence of an outage: a host that doesn't resolve, a TLS failure,
      // or an error that may never have left this process. Blocks in both modes.
      return {
        decision: "transport_error",
        allowed: false,
        reason: failOpen
          ? "guardrail_transport_failure_not_an_outage"
          : "guardrail_transport_failure_fail_closed",
        trust_score: null,
        evidence: { transport_failure: true, ...evidence },
      };
    }

    if (!res.ok) {
      // The body is server free text; it is never read into the result.
      await res.body?.cancel().catch(() => undefined);
      if (failOpen && res.status >= 500) {
        return unavailable(true, { http_status: res.status });
      }
      return httpRefusal(res.status);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await res.text());
    } catch {
      // A 2xx whose body could not be read in full, or is not JSON: nothing was
      // decided (TRUS-2159).
      return unavailable(failOpen, { unreadable_response: true });
    }
    if (!isPlainObject(parsed)) {
      // Valid JSON that is not an object is an answer, and not a decision.
      return {
        decision: "refused",
        allowed: false,
        reason: "guardrail_malformed_response",
        trust_score: null,
        evidence: { malformed_response: true },
      };
    }
    return {
      ...parsed,
      // Never rely on truthiness or an unfamiliar verdict. Only the exact
      // canonical allow value can authorize execution.
      allowed: parsed.decision === "allow",
    };
  } finally {
    clearTimeout(timer);
  }
}
