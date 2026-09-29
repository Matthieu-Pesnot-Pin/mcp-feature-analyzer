import type { AnalysisStore } from "../core/analysis-store.js";
import { rejectUnknownFields, requireString, textResult, type Args, type MutationResult } from "./types.js";

/** Supprime une analyse et son snapshot de diff. */
export function deleteAnalysis(store: AnalysisStore, args: Args): MutationResult {
  rejectUnknownFields(args, ["analysis_id"]);
  const id = requireString(args, "analysis_id");
  store.delete(id);
  return {
    result: textResult(`Deleted analysis ${id} and its diff snapshot. The repository is untouched.`),
    analysisId: id,
  };
}
