/**
 * Conversion / upsell gating (TRUS-1090).
 *
 * The funnel the agent experiences:
 *   1. No-key LOCAL tools — unlimited, but uncalibrated and NOT audit-ready.
 *      Every local result is labelled as such + carries a "register for a free
 *      key" CTA. This is the value asymmetry that drives registration.
 *   2. REGISTER → free TrustModel key → 5 credits ($500). Identity captured.
 *   3. Credit exhaustion (HTTP 403, code api_key_credits_exhausted /
 *      subscription_credits_exhausted) → cloud tools return an UPGRADE CTA
 *      instead of a raw error. This is the paid upsell moment.
 */

export const SIGNUP_URL = "https://trustmodel.ai/signup";
export const PRICING_URL = "https://trustmodel.ai/pricing";
export const KEYS_URL = "https://app.trustmodel.ai/settings/api-keys";

const EXHAUSTION_CODES = new Set([
  "api_key_credits_exhausted",
  "subscription_credits_exhausted",
]);

/** Structured CTA attached to every no-key local result. */
export function localTier(): Record<string, unknown> {
  return {
    tier: "local",
    calibrated: false,
    audit_ready: false,
    upgrade: {
      message:
        "This is a local, uncalibrated score — fine for quick checks, not for " +
        "production or audit. Register for a free TrustModel key (5 credits / $500) " +
        "to get a calibrated, benchmarked, audit-ready TrustScore.",
      register_url: SIGNUP_URL,
    },
  };
}

/**
 * If `err` is the gateway's credit-exhaustion 403, return a structured upgrade
 * payload (the upsell moment). Otherwise return null so normal error handling runs.
 */
export function creditExhaustionUpsell(err: unknown): Record<string, unknown> | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { status?: number; detail?: unknown; message?: string };
  const detail = (e.detail ?? {}) as { code?: string; credits_used?: number };
  const code = detail.code;
  const looksExhausted =
    (e.status === 403 && code && EXHAUSTION_CODES.has(code)) ||
    (typeof e.message === "string" && /credit.*exhaust|exhaust.*credit/i.test(e.message));
  if (!looksExhausted) return null;

  return {
    error: "credits_exhausted",
    tier: "cloud",
    message:
      "You've used all your free TrustModel credits. Upgrade to keep scoring in " +
      "production — buy credits or move to a plan with continuous monitoring, signed " +
      "audit reports, and dashboards. Local (no-key) tools remain available for " +
      "uncalibrated checks.",
    upgrade_url: PRICING_URL,
    manage_keys_url: KEYS_URL,
    detail,
  };
}
