import type { AnalysisStore } from "../core/analysis-store.js";
import { AnalysisError } from "../core/errors.js";
import { rejectUnknownFields, requireString, textResult, type Args, type MutationResult } from "./types.js";

/** Supprime un schéma d'une analyse. */
export function deleteDiagram(store: AnalysisStore, args: Args): MutationResult {
  rejectUnknownFields(args, ["analysis_id", "diagram_id"]);
  const id = requireString(args, "analysis_id");
  const diagramId = requireString(args, "diagram_id");

  let title = "";
  const updated = store.mutate(id, "agent", (draft) => {
    const diagram = draft.diagrams.find((entry) => entry.id === diagramId);
    if (!diagram) {
      const existing = draft.diagrams.map((entry) => entry.id).join(", ") || "none";
      throw new AnalysisError(`Diagram "${diagramId}" not found in analysis "${id}". Existing diagrams: ${existing}.`);
    }
    title = diagram.title;
    draft.diagrams = draft.diagrams.filter((entry) => entry.id !== diagramId);
  });

  return {
    result: textResult(
      `Deleted diagram ${diagramId} ("${title}") from "${updated.title}" (${updated.id}). ${updated.diagrams.length} diagram(s) remain.`
    ),
    analysisId: updated.id,
  };
}
