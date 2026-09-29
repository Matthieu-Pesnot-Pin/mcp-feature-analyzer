import type { AnalysisStore } from "../core/analysis-store.js";
import type { Overview } from "../../shared/schemas/analysis.schema.js";
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

const EDITABLE = [
  "title",
  "project",
  "summary",
  "objective",
  "approach",
  "attention_points",
  "request_text",
  "request_source",
] as const;

/** Modification de la vue d'ensemble demandée par l'agent. */
type OverviewInput =
  | { remove: true }
  | { remove: false; objective?: string; approach?: string; attentionPoints?: string[] }
  | undefined;

/**
 * Lit `objective`, `approach` et `attention_points`. `objective: null` retire
 * toute la vue d'ensemble et exclut les deux autres champs.
 */
function readOverview(args: Args): OverviewInput {
  const objective = nullableString(args, "objective");
  const approach = optionalString(args, "approach");
  const attentionPoints = has(args, "attention_points") ? requireStringArray(args, "attention_points") : undefined;
  if (objective === null) {
    if (approach !== undefined || attentionPoints !== undefined) {
      throw new Error(`"objective" is null (overview removed), so "approach" and "attention_points" cannot be set.`);
    }
    return { remove: true };
  }
  if (objective === undefined && approach === undefined && attentionPoints === undefined) return undefined;
  return { remove: false, objective, approach, attentionPoints };
}

/**
 * Applique la modification de la vue d'ensemble : sans vue d'ensemble existante,
 * `objective` et `approach` sont requis pour la créer ; sinon chaque champ donné
 * remplace le précédent et les autres sont conservés.
 */
function nextOverview(id: string, current: Overview | null, input: Exclude<OverviewInput, undefined>): Overview | null {
  if (input.remove) return null;
  if (current === null) {
    const missing = (["objective", "approach"] as const).filter((field) => input[field] === undefined);
    if (missing.length > 0) {
      throw new Error(
        `Analysis "${id}" has no overview yet: give ${missing.map((field) => `"${field}"`).join(" and ")} too ` +
          `to create it ("attention_points" is optional and defaults to an empty list).`
      );
    }
    return { objective: input.objective!, approach: input.approach!, attentionPoints: input.attentionPoints ?? [] };
  }
  return {
    objective: input.objective ?? current.objective,
    approach: input.approach ?? current.approach,
    attentionPoints: input.attentionPoints ?? current.attentionPoints,
  };
}

/** Met à jour le titre, le projet, la vue d'ensemble, le résumé et la demande initiale d'une analyse. */
export function updateAnalysis(store: AnalysisStore, args: Args): MutationResult {
  rejectUnknownFields(args, ["analysis_id", ...EDITABLE]);
  const id = requireString(args, "analysis_id");
  const given = EDITABLE.filter((field) => has(args, field));
  if (given.length === 0) {
    throw new Error(`Give at least one field to change: ${EDITABLE.join(", ")}.`);
  }

  const title = optionalString(args, "title");
  const project = optionalString(args, "project");
  const summary = has(args, "summary") ? requireStringArray(args, "summary") : undefined;
  const overview = readOverview(args);
  const requestText = nullableString(args, "request_text");
  const requestSource = nullableString(args, "request_source");
  if (requestText === null && typeof requestSource === "string") {
    throw new Error(`"request_text" is null (request removed), so "request_source" cannot be set.`);
  }

  let previousProject = "";
  const analysis = store.mutate(id, "agent", (draft) => {
    previousProject = draft.project;
    if (title !== undefined) draft.title = title;
    if (project !== undefined) draft.project = project;
    if (summary !== undefined) draft.summary = summary;
    if (overview !== undefined) draft.overview = nextOverview(id, draft.overview, overview);
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
  if (project !== undefined) {
    changes.push(project === previousProject ? `project "${project}" (unchanged)` : `project "${previousProject}" -> "${project}"`);
  }
  if (summary !== undefined) changes.push(`summary (${analysis.summary.length} bullet(s))`);
  if (overview !== undefined) {
    changes.push(
      analysis.overview === null
        ? "overview removed"
        : `overview (${analysis.overview.attentionPoints.length} attention point(s))`
    );
  }
  if (requestText !== undefined || requestSource !== undefined) {
    changes.push(analysis.request === null ? "initial request removed" : "initial request");
  }

  const missing: string[] = [];
  if (analysis.overview === null) missing.push("the overview (objective, approach, attention_points)");
  if (analysis.summary.length === 0) missing.push("the summary");
  const next =
    missing.length > 0
      ? `Next: write ${missing.join(" and ")} with update_analysis, then record problems and missing requirements with add_findings.`
      : `Next: record problems and missing requirements with add_findings.`;
  return {
    result: textResult(`Updated analysis ${analysis.id}: ${changes.join(", ")}. Revision ${analysis.revision}.\n${next}`),
    analysisId: analysis.id,
  };
}
