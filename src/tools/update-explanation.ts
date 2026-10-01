import type { AnalysisStore } from "../core/analysis-store.js";
import { AnalysisError } from "../core/errors.js";
import { resolveExplanationLocation } from "../core/locations.js";
import { explanationLine } from "./format.js";
import { readExplanationLocation } from "./inputs.js";
import { has, optionalString, rejectUnknownFields, requireString, requireText, textResult, type Args, type MutationResult } from "./types.js";

const EDITABLE = ["title", "body", "path", "side", "start_line", "end_line"] as const;

/**
 * Modifie une explication. Un nouvel emplacement est résolu sur le snapshot et
 * remet une explication `outdated` à `current`.
 */
export function updateExplanation(store: AnalysisStore, args: Args): MutationResult {
  rejectUnknownFields(args, ["analysis_id", "explanation_id", ...EDITABLE]);
  const id = requireString(args, "analysis_id");
  const explanationId = requireString(args, "explanation_id");
  const given = EDITABLE.filter((field) => has(args, field));
  if (given.length === 0) {
    throw new Error(`Give at least one field to change: ${EDITABLE.join(", ")}.`);
  }

  const title = optionalString(args, "title");
  const body = has(args, "body") ? requireText(args, "body") : undefined;
  const location = readExplanationLocation(args);

  const analysis = store.get(id);
  const current = analysis.explanations.find((explanation) => explanation.id === explanationId);
  if (!current) {
    const known = analysis.explanations.map((explanation) => explanation.id).join(", ") || "none";
    throw new AnalysisError(`Explanation "${explanationId}" not found in analysis "${id}". Existing explanations: ${known}.`);
  }
  const resolved = location === undefined ? undefined : resolveExplanationLocation(store.getSnapshot(id), analysis.files, location);

  const previousStatus = current.status;
  const updated = store.mutate(id, "agent", (draft) => {
    if (draft.snapshotAt !== analysis.snapshotAt) {
      throw new AnalysisError(`The diff of analysis "${id}" was recomputed while the explanation was validated. Send the update again.`);
    }
    const explanation = draft.explanations.find((entry) => entry.id === explanationId);
    if (!explanation) throw new AnalysisError(`Explanation "${explanationId}" was deleted in the meantime from analysis "${id}".`);
    if (title !== undefined) explanation.title = title;
    if (body !== undefined) explanation.body = body;
    if (resolved) {
      const { anchorText, ...newLocation } = resolved;
      explanation.location = newLocation;
      explanation.anchorText = anchorText;
      explanation.status = "current";
    }
  });

  const explanation = updated.explanations.find((entry) => entry.id === explanationId)!;
  const lines = [`Updated explanation ${explanationId} (${given.join(", ")}):`, `  ${explanationLine(explanation)}`];
  if (previousStatus === "outdated" && explanation.status === "current") {
    lines.push("It was outdated; the new location made it current again.");
  } else if (explanation.status === "outdated") {
    lines.push(
      "It is still outdated: re-read the code with get_diff, then give its new location (path, side, start_line) and rewrite the body if the code changed, or delete it with delete_explanations."
    );
  }
  return { result: textResult(lines.join("\n")), analysisId: updated.id };
}
