import { z } from "zod";
import { getAgenticEvaluation } from "../client.js";

export const agentScoreToolName = "trustmodel_score_agent";

export const agentScoreToolDescription =
  "Get details (status, completion percentage, overall score, grade, per-category scores, summary) " +
  "for an agentic trace evaluation run previously created via trustmodel_evaluate_agent.";

export const agentScoreToolSchema = {
  evaluation_run_id: z
    .union([
      z.number().int().positive(),
      z.string().regex(/^\d+$/, "evaluation_run_id must be a positive integer."),
    ])
    .describe(
      "Integer evaluation_run_id returned by trustmodel_evaluate_agent."
    ),
};

export async function handleAgentScore(args: {
  evaluation_run_id: number | string;
}): Promise<unknown> {
  return getAgenticEvaluation(Number(args.evaluation_run_id));
}

interface ComplianceFrameworkSummary {
  slug?: string;
  name?: string;
  overall_status?: string | null;
  compliance_percentage?: number | null;
}

/**
 * Build a short, human-readable per-framework compliance summary from an
 * agentic evaluation result. Returns an empty string when the result carries
 * no compliance view, so callers can append it unconditionally.
 */
export function formatComplianceSummary(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const frameworks = (result as { compliance_frameworks?: unknown }).compliance_frameworks;
  if (!Array.isArray(frameworks) || frameworks.length === 0) return "";

  const lines = (frameworks as ComplianceFrameworkSummary[]).map((fw) => {
    const slug = fw.slug ?? fw.name ?? "unknown";
    const status = fw.overall_status ?? "pending";
    const pct =
      typeof fw.compliance_percentage === "number" ? `${fw.compliance_percentage}%` : "n/a";
    return `  - ${slug}: ${status} (${pct})`;
  });

  const reportUrl = (result as { compliance_report_url?: unknown }).compliance_report_url;
  if (typeof reportUrl === "string" && reportUrl.length > 0) {
    lines.push(`  report: ${reportUrl}`);
  }

  return `\n\nCompliance:\n${lines.join("\n")}`;
}
