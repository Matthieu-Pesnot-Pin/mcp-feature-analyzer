import type { AnalysisStore } from "../core/analysis-store.js";
import { AnalysisError } from "../core/errors.js";
import { optionalString, rejectUnknownFields, requireString, textResult, type Args, type MutationResult } from "./types.js";

/**
 * Marque traité le retour soumis d'une analyse, avec la date et une note
 * facultative. Le retour reste lisible avec get_review_feedback. Refusé tant
 * que la revue n'est pas soumise ; un nouveau marquage remplace le précédent.
 */
export function markFeedbackProcessed(store: AnalysisStore, args: Args): MutationResult {
  rejectUnknownFields(args, ["analysis_id", "note"]);
  const id = requireString(args, "analysis_id");
  const note = optionalString(args, "note") ?? null;

  let replaced: string | null = null;
  const updated = store.mutate(id, "agent", (draft) => {
    const review = draft.review;
    if (review.state !== "submitted") {
      const reopened = review.previousSubmission;
      throw new AnalysisError(
        reopened
          ? `The review of analysis "${id}" is not submitted: the reviewer reopened the feedback submitted at ${reopened.submittedAt} and is changing it. ` +
              `Wait until it is submitted again, then read it with get_review_feedback.`
          : `The review of analysis "${id}" is not submitted yet: there is no feedback to mark processed.`
      );
    }
    replaced = review.processed?.at ?? null;
    review.processed = { at: new Date().toISOString(), note };
  });

  const processed = updated.review.processed!;
  const lines = [
    `Marked the feedback of "${updated.title}" (${updated.id}), submitted at ${updated.review.submittedAt}, as processed at ${processed.at}.`,
    `Note: ${processed.note ?? "none"}.`,
  ];
  if (replaced !== null) lines.push(`This replaces the processing mark of ${replaced}.`);
  lines.push("The feedback stays readable with get_review_feedback. If the reviewer changes the review, it becomes pending again.");
  return { result: textResult(lines.join("\n")), analysisId: updated.id };
}
