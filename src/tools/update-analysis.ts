import type { AnalysisStore } from "../core/analysis-store.js";
import {
  has,
  nullableString,
  optionalString,
  rejectUnknownFields,
  requireString,
  requireStringArray,
  textResult,
  type Args,
  type MutationResult,
} from "./types.js";

const EDITABLE = ["title", "summary", "request_text", "request_source"] as const;

/** Met à jour le titre, le résumé et la demande initiale d'une analyse. */
export function updateAnalysis(store: AnalysisStore, args: Args): MutationResult {
  rejectUnknownFields(args, ["analysis_id", ...EDITABLE]);
  const id = requireString(args, "analysis_id");
  const given = EDITABLE.filter((field) => has(args, field));
  if (given.length === 0) {
    throw new Error(`Give at least one field to change: ${EDITABLE.join(", ")}.`);
  }

  const title = optionalString(args, "title");
  const summary = has(args, "summary") ? requireStringArray(args, "summary") : undefined;
  const requestText = nullableString(args, "request_text");
  const requestSource = nullableString(args, "request_source");
  if (requestText === null && typeof requestSource === "string") {
    throw new Error(`"request_text" is null (request removed), so "request_source" cannot be set.`);
  }

  const analysis = store.mutate(id, "agent", (draft) => {
    if (title !== undefined) draft.title = title;
    if (summary !== undefined) draft.summary = summary;
    if (requestText === null) {
      draft.request = null;
    } else if (requestText !== undefined) {
      draft.request = { text: requestText, source: requestSource !== undefined ? requestSource : (draft.request?.source ?? null) };
    } else if (requestSource !== undefined) {
      if (draft.request === null) {
        throw new Error(`Analysis "${id}" has no initial request to attach a source to: give "request_text" too.`);
      }
      draft.request = { ...draft.request, source: requestSource };
    }
  });

  const changes: string[] = [];
  if (title !== undefined) changes.push(`title "${analysis.title}"`);
  if (summary !== undefined) changes.push(`summary (${analysis.summary.length} bullet(s))`);
  if (requestText !== undefined || requestSource !== undefined) {
    changes.push(analysis.request === null ? "initial request removed" : "initial request");
  }
  return {
    result: textResult(
      `Updated analysis ${analysis.id}: ${changes.join(", ")}. Revision ${analysis.revision}.
` +
        `Next: record problems and missing requirements with add_findings.`
    ),
    analysisId: analysis.id,
  };
}
