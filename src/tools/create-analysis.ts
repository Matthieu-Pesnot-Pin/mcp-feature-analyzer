import type { AnalysisStore } from "../core/analysis-store.js";
import { computeSnapshot } from "../core/git.js";
import { ANALYSIS_MODES } from "../../shared/schemas/analysis.schema.js";
import { fileLine, fileTotals, snapshotLabel } from "./format.js";
import {
  optionalString,
  rejectUnknownFields,
  requireEnum,
  requireString,
  textResult,
  type Args,
  type MutationResult,
} from "./types.js";

const FIELDS = ["repo_path", "title", "mode", "base", "head", "request_text", "request_source"] as const;

/** Calcule et fige le diff du dépôt, puis crée l'analyse. */
export async function createAnalysis(store: AnalysisStore, args: Args): Promise<MutationResult> {
  rejectUnknownFields(args, FIELDS);
  const repoPath = requireString(args, "repo_path");
  const title = requireString(args, "title");
  const mode = requireEnum(args, "mode", ANALYSIS_MODES);
  const base = optionalString(args, "base");
  const head = optionalString(args, "head");
  const requestText = optionalString(args, "request_text");
  const requestSource = optionalString(args, "request_source");
  if (requestSource !== undefined && requestText === undefined) {
    throw new Error(`"request_source" describes the initial request: give "request_text" too.`);
  }

  const computed = await computeSnapshot({ repoPath, mode, base, head });
  const analysis = store.create(
    { title, request: requestText === undefined ? null : { text: requestText, source: requestSource ?? null } },
    computed
  );

  const lines = [
    `Created analysis "${analysis.title}" (id: ${analysis.id}).`,
    `Repository: ${analysis.repoPath}`,
    `Diff: ${snapshotLabel(analysis)}`,
    "",
  ];
  if (analysis.files.length === 0) {
    lines.push(
      "Changed files: none — the diff is empty. Check the mode and refs; delete this analysis with delete_analysis and create it again with the right ones."
    );
  } else {
    lines.push(`Changed files (${fileTotals(analysis.files)}):`, ...analysis.files.map((file) => `  ${fileLine(file)}`));
  }
  lines.push(
    "",
    "Next steps:",
    `1. Read the frozen diff with get_diff (analysis_id "${analysis.id}"); anchor findings on its new-side line numbers.`,
    "2. Describe what the feature does with update_analysis (summary bullets).",
    "3. Record problems with add_findings, including requirement_gap findings for requested behaviour that is missing.",
    "4. Add a diagram with set_diagram when a picture helps the reviewer.",
    "5. Ask the user to review the analysis in the GUI, then read the outcome with get_review_feedback."
  );

  return { result: textResult(lines.join("\n")), analysisId: analysis.id };
}
