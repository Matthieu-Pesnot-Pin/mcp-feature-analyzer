import type { AnalysisStore } from "../core/analysis-store.js";
import { markFeedbackProcessed as markProcessed } from "../core/review-actions.js";
import { optionalString, rejectUnknownFields, requireString, textResult, type Args, type MutationResult } from "./types.js";

/**
 * Marque traité, au nom de l'agent, le retour soumis d'une analyse, avec la date
 * et une note facultative. Le retour reste lisible avec get_review_feedback.
 */
export function markFeedbackProcessed(store: AnalysisStore, args: Args): MutationResult {
  rejectUnknownFields(args, ["analysis_id", "note"]);
  const id = requireString(args, "analysis_id");
  const note = optionalString(args, "note") ?? null;

  const { analysis: updated, replaced } = markProcessed(store, id, "agent", note);
  const processed = updated.review.processed!;
  const lines = [
    `Marked the feedback of "${updated.title}" (${updated.id}), submitted at ${updated.review.submittedAt}, as processed at ${processed.at}.`,
    `Note: ${processed.note ?? "none"}.`,
  ];
  if (replaced !== null) lines.push(`This replaces the processing mark of ${replaced}.`);
  lines.push("The feedback stays readable with get_review_feedback. If the reviewer changes the review, it becomes pending again.");
  return { result: textResult(lines.join("\n")), analysisId: updated.id };
}
