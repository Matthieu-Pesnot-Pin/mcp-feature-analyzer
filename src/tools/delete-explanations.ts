import type { AnalysisStore } from "../core/analysis-store.js";
import { AnalysisError } from "../core/errors.js";
import { rejectUnknownFields, requireString, requireStringArray, textResult, type Args, type MutationResult } from "./types.js";

/** Supprime des explications par identifiant. Un identifiant inconnu fait échouer l'appel sans rien supprimer. */
export function deleteExplanations(store: AnalysisStore, args: Args): MutationResult {
  rejectUnknownFields(args, ["analysis_id", "explanation_ids"]);
  const id = requireString(args, "analysis_id");
  const ids = [...new Set(requireStringArray(args, "explanation_ids", 1))];

  const updated = store.mutate(id, "agent", (draft) => {
    const known = new Set(draft.explanations.map((explanation) => explanation.id));
    const unknown = ids.filter((explanationId) => !known.has(explanationId));
    if (unknown.length > 0) {
      const existing = draft.explanations.map((explanation) => explanation.id).join(", ") || "none";
      throw new AnalysisError(
        `No explanation was deleted: unknown explanation id(s) ${unknown.join(", ")} in analysis "${id}". Existing explanations: ${existing}.`
      );
    }
    const removed = new Set(ids);
    draft.explanations = draft.explanations.filter((explanation) => !removed.has(explanation.id));
  });

  return {
    result: textResult(
      `Deleted ${ids.length} explanation(s) from "${updated.title}" (${updated.id}): ${ids.join(", ")}. ` +
        `${updated.explanations.length} explanation(s) remain.`
    ),
    analysisId: updated.id,
  };
}
