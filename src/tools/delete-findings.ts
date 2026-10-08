import type { AnalysisStore } from "../core/analysis-store.js";
import { AnalysisError } from "../core/errors.js";
import { rejectUnknownFields, requireString, requireStringArray, textResult, type Args, type MutationResult } from "./types.js";

/**
 * Supprime des constats par identifiant, avec les remarques du relecteur qui
 * leur répondent, et les retire de la sélection de la revue. Un identifiant
 * inconnu fait échouer l'appel sans rien supprimer.
 */
export function deleteFindings(store: AnalysisStore, args: Args): MutationResult {
  rejectUnknownFields(args, ["analysis_id", "finding_ids"]);
  const id = requireString(args, "analysis_id");
  const ids = [...new Set(requireStringArray(args, "finding_ids", 1))];
  let removedNoteCount = 0;

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
    const removedNotes = new Set(
      draft.notes.filter((note) => note.findingId !== null && removed.has(note.findingId)).map((note) => note.id)
    );
    removedNoteCount = removedNotes.size;
    draft.notes = draft.notes.filter((note) => !removedNotes.has(note.id));
    draft.review.selectedNoteIds = draft.review.selectedNoteIds.filter((noteId) => !removedNotes.has(noteId));
  });

  const notes = removedNoteCount > 0 ? ` ${removedNoteCount} reviewer note(s) answering them were deleted too.` : "";
  return {
    result: textResult(
      `Deleted ${ids.length} finding(s) from "${updated.title}" (${updated.id}): ${ids.join(", ")}. ` +
        `${updated.findings.length} finding(s) remain.${notes}`
    ),
    analysisId: updated.id,
  };
}
