import { z } from "zod";
import { postGuardrailsCheck } from "../client.js";

export const guardrailsToolName = "trustmodel_guardrails_check";

export const guardrailsToolDescription =
  "Pre-execution guardrail check for a single agent action against the org's " +
  "TrustModel policy (cloud, calibrated). Returns a decision — allow, deny, or " +
  "redact — plus the policy id, reason, trust score, and evidence. Call this " +
  "BEFORE an agent performs a sensitive action (a tool call, an external request, " +
  "a decision that affects a person) and honor the verdict: only `allow` should " +
  "proceed; treat `deny`/`redact` as a block. Fail-closed — if no policy is loaded " +
  "or the engine errors, the org's configured fail-mode decides.";

export const guardrailsToolSchema = {
  agent_id: z
    .string()
    .describe("Identifier of the agent taking the action (free-form; no registration required)."),
  action_type: z
    .string()
    .describe("The kind of action being attempted, e.g. 'tool_call', 'hiring_decision', 'send_email'."),
  action_payload: z
    .record(z.unknown())
    .optional()
    .describe("The action's parameters — the data the policy evaluates against."),
  subject_id: z
    .string()
    .optional()
    .describe("Optional id of the subject the action affects (e.g. a candidate or customer id)."),
  policy_name: z
    .string()
    .optional()
    .describe("Policy to evaluate against; defaults to the org's 'default' policy."),
};

export async function handleGuardrails(args: {
  agent_id: string;
  action_type: string;
  action_payload?: Record<string, unknown>;
  subject_id?: string;
  policy_name?: string;
}): Promise<unknown> {
  const result = await postGuardrailsCheck({
    agent_id: args.agent_id,
    action_type: args.action_type,
    action_payload: args.action_payload ?? {},
    subject_id: args.subject_id ?? "",
    policy_name: args.policy_name ?? "default",
  });
  // Surface an explicit allow flag so callers don't have to know the vocab:
  // only `allow` proceeds; `deny`/`redact`/anything else is a block.
  return { ...result, allowed: result.decision === "allow" };
}
