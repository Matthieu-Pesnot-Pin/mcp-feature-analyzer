import type { AnalysisStore } from "../core/analysis-store.js";
import { AnalysisError } from "../core/errors.js";
import { rejectUnknownFields, requireString, requireStringArray, textResult, type Args, type MutationResult } from "./types.js";

/**
 * Supprime des constats par identifiant et les retire de la sélection de la
 * revue. Un identifiant inconnu fait échouer l'appel sans rien supprimer.
 */
export function deleteFindings(store: AnalysisStore, args: Args): MutationResult {
  rejectUnknownFields(args, ["analysis_id", "finding_ids"]);
  const id = requireString(args, "analysis_id");
  const ids = [...new Set(requireStringArray(args, "finding_ids", 1))];

  const updated = store.mutate(id, "agent", (draft) => {
    const known = new Set(draft.findings.map((finding) => finding.id));
    const unknown = ids.filter((findingId) => !known.has(findingId));
    if (unknown.length > 0) {
      const existing = draft.findings.map((finding) => finding.id).join(", ") || "none";
      throw new AnalysisError(
        `No finding was deleted: unknown finding id(s) ${unknown.join(", ")} in analysis "${id}". Existing findings: ${existing}.`
      );
    }
    const removed = new Set(ids);
    draft.findings = draft.findings.filter((finding) => !removed.has(finding.id));
    draft.review.selectedFindingIds = draft.review.selectedFindingIds.filter((findingId) => !removed.has(findingId));
  });

  return {
    result: textResult(
      `Deleted ${ids.length} finding(s) from "${updated.title}" (${updated.id}): ${ids.join(", ")}. ` +
        `${updated.findings.length} finding(s) remain.`
    ),
    analysisId: updated.id,
  };
}
