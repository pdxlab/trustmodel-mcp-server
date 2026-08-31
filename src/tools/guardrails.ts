import { z } from "zod";
import { isTrustModelHttpError, postGuardrailsCheck } from "../client.js";

export const guardrailsToolName = "trustmodel_guardrails_check";

export const guardrailsToolDescription =
  "Check a proposed agent action against the organization's TrustModel policy " +
  "before execution. Only the literal decision `allow` may proceed; deny, " +
  "redact, unknown decisions, and transport failures block when fail-closed.";

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

export async function handleGuardrails(args: {
  agent_id: string;
  action_type: string;
  action_payload?: Record<string, unknown>;
  subject_id?: string;
  policy_name?: string;
}): Promise<Record<string, unknown>> {
  try {
    const result = await postGuardrailsCheck({
      agent_id: args.agent_id,
      action_type: args.action_type,
      action_payload: args.action_payload ?? {},
      subject_id: args.subject_id ?? "",
      policy_name: args.policy_name ?? "default",
    });
    return {
      ...result,
      // Never rely on truthiness or an unfamiliar verdict. Only the exact
      // canonical allow value can authorize execution.
      allowed: result.decision === "allow",
    };
  } catch (error) {
    // An HTTP response is an authoritative refusal from TrustModel, not a
    // transport outage. It must remain blocking even when an operator has
    // explicitly selected fail-open for network failures.
    if (isTrustModelHttpError(error)) {
      return {
        decision: "refused",
        allowed: false,
        reason: "guardrail_http_refusal",
        trust_score: null,
        evidence: {
          http_refusal: true,
          http_status: error.status,
        },
      };
    }

    const failOpen =
      (process.env.TRUSTMODEL_GUARDRAIL_FAIL_MODE ?? "fail_closed").toLowerCase() ===
      "fail_open";
    return {
      decision: failOpen ? "allow" : "transport_error",
      allowed: failOpen,
      reason: failOpen
        ? "guardrail_transport_failure_fail_open"
        : "guardrail_transport_failure_fail_closed",
      trust_score: null,
      evidence: { transport_failure: true },
    };
  }
}
