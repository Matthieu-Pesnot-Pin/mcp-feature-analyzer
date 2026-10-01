import type { AnalysisStore } from "../core/analysis-store.js";
import { AnalysisError } from "../core/errors.js";
import { itemId } from "../core/ids.js";
import { resolveExplanationLocation } from "../core/locations.js";
import type { Explanation } from "../../shared/schemas/analysis.schema.js";
import { explanationLine } from "./format.js";
import { readExplanationLocation, readItemId } from "./inputs.js";
import {
  rejectUnknownFields,
  requireArray,
  requireObject,
  requireString,
  requireText,
  textResult,
  type Args,
  type MutationResult,
} from "./types.js";

export const EXPLANATION_INPUT_FIELDS = ["id", "title", "body", "path", "side", "start_line", "end_line"] as const;

/** Explication validée, sans identifiant généré, statut ni date. */
type PreparedExplanation = Omit<Explanation, "id" | "createdAt" | "status"> & { id: string | undefined };

/**
 * Ajoute un lot d'explications. Tout le lot est validé (champs, identifiants,
 * emplacements résolus sur le snapshot) avant l'écriture : une seule explication
 * invalide et rien n'est ajouté.
 */
export function addExplanations(store: AnalysisStore, args: Args): MutationResult {
  rejectUnknownFields(args, ["analysis_id", "explanations"]);
  const id = requireString(args, "analysis_id");
  const items = requireArray(args, "explanations", 1);
  const analysis = store.get(id);
  const snapshot = store.getSnapshot(id);

  const taken = new Set(analysis.explanations.map((explanation) => explanation.id));
  const batchIds = new Set<string>();
  const prepared: PreparedExplanation[] = [];
  const errors: string[] = [];

  items.forEach((raw, index) => {
    try {
      const item = requireObject(raw, `explanations[${index}]`);
      rejectUnknownFields(item, EXPLANATION_INPUT_FIELDS);
      const explanationId = readItemId(item, "id");
      if (explanationId !== undefined) {
        if (taken.has(explanationId)) throw new Error(`id "${explanationId}" is already used by another explanation of this analysis.`);
        if (batchIds.has(explanationId)) throw new Error(`id "${explanationId}" appears twice in this batch.`);
        batchIds.add(explanationId);
      }
      const title = requireString(item, "title");
      const body = requireText(item, "body");
      const location = readExplanationLocation(item);
      if (location === undefined) {
        throw new Error(`an explanation describes lines of code: give "path" and "start_line" (and "side": "old" for removed code).`);
      }
      const { anchorText, ...resolved } = resolveExplanationLocation(snapshot, analysis.files, location);
      prepared.push({ id: explanationId, title, body, location: resolved, anchorText });
    } catch (err) {
      errors.push(`- explanations[${index}]: ${(err as Error).message}`);
    }
  });

  if (errors.length > 0) {
    throw new AnalysisError(
      `No explanation was added: ${errors.length} of ${items.length} explanation(s) are invalid. Fix them and send the whole batch again.\n` +
        errors.join("\n")
    );
  }

  const added: Explanation[] = [];
  const updated = store.mutate(id, "agent", (draft) => {
    if (draft.snapshotAt !== analysis.snapshotAt) {
      throw new AnalysisError(`The diff of analysis "${id}" was recomputed while the explanations were validated. Send the batch again.`);
    }
    const ids = new Set([...draft.explanations.map((explanation) => explanation.id), ...batchIds]);
    const now = new Date().toISOString();
    for (const explanation of prepared) {
      const newId = explanation.id ?? itemId("explanation", ids);
      ids.add(newId);
      const created: Explanation = { ...explanation, id: newId, status: "current", createdAt: now };
      added.push(created);
      draft.explanations.push(created);
    }
  });

  const lines = [
    `Added ${added.length} explanation(s) to "${updated.title}" (${updated.id}):`,
    ...added.map((explanation) => `  ${explanationLine(explanation)}`),
    `The analysis has ${updated.explanations.length} explanation(s). The reviewer reads them in the diff, above the lines they describe.`,
  ];
  return { result: textResult(lines.join("\n")), analysisId: updated.id };
}
