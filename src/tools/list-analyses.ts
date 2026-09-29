import type { AnalysisStore } from "../core/analysis-store.js";
import type { AnalysisSummary } from "../../shared/schemas/analysis.schema.js";
import { refsLabel, severityCountsLabel } from "./format.js";
import { rejectUnknownFields, textResult, type Args, type ToolResult } from "./types.js";

function reviewLabel(summary: AnalysisSummary): string {
  if (summary.reviewState === "submitted") return `submitted (${summary.decision}) — read it with get_review_feedback`;
  return "pending";
}

/** Liste les analyses, de la plus récemment modifiée à la plus ancienne, et les fichiers illisibles. */
export function listAnalyses(store: AnalysisStore, args: Args): ToolResult {
  rejectUnknownFields(args, []);
  const { analyses, unreadable } = store.list();
  const lines: string[] = [];

  if (analyses.length === 0) {
    lines.push(
      "No analyses yet. Create one with create_analysis once the feature is developed: it freezes the diff of a branch or of the working tree for human review."
    );
  } else {
    lines.push(`${analyses.length} analysis(es), most recently updated first:`);
    for (const summary of analyses) {
      lines.push(
        "",
        `- ${summary.id} — "${summary.title}"`,
        `  ${refsLabel(summary)} | files reviewed ${summary.reviewedCount}/${summary.fileCount} | ` +
          `open findings: ${severityCountsLabel(summary.openFindings)} | diagrams: ${summary.diagramCount}`,
        `  review: ${reviewLabel(summary)} | updated ${summary.updatedAt}`
      );
    }
  }

  if (unreadable.length > 0) {
    lines.push(
      "",
      `${unreadable.length} analysis file(s) could not be read. Fix the file or remove it with delete_analysis:`,
      ...unreadable.map((entry) => `- ${entry.id}: ${entry.error}`)
    );
  }
  return textResult(lines.join("\n"));
}
