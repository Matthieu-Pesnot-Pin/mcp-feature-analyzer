import type { AnalysisStore } from "../core/analysis-store.js";
import { detachFollowUp } from "../core/follow-ups.js";
import { rejectUnknownFields, requireString, textResult, type Args, type MutationResult } from "./types.js";

/**
 * Supprime une analyse et son snapshot de diff. Sa revue de suivi, si elle en a
 * une, est conservée et devient une première revue.
 */
export function deleteAnalysis(store: AnalysisStore, args: Args): MutationResult {
  rejectUnknownFields(args, ["analysis_id"]);
  const id = requireString(args, "analysis_id");
  store.get(id);
  const detached = detachFollowUp(store, id);
  store.delete(id);
  const lines = [`Deleted analysis ${id} and its diff snapshot. The repository is untouched.`];
  if (detached !== null) lines.push(`Its follow-up review ${detached} is kept and no longer refers to it.`);
  return { result: textResult(lines.join("\n")), analysisId: id };
}
