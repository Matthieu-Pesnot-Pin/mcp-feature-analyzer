import type { AnalysisStore } from "../core/analysis-store.js";
import { REVIEW_PROGRESS_STATES, type AnalysisSummary } from "../../shared/schemas/analysis.schema.js";
import { progressLabel, progressStateLabel, refsLabel, severityCountsLabel } from "./format.js";
import { optionalEnum, optionalString, rejectUnknownFields, textResult, type Args, type ToolResult } from "./types.js";

/**
 * Filtre `review_state` : un état d'avancement, ou parmi les revues soumises
 * celles qui restent à traiter (`to_process`) ou n'attendent plus l'agent
 * (`processed` : marquées traitées, ou approuvées).
 */
export const REVIEW_STATE_FILTERS = [...REVIEW_PROGRESS_STATES, "to_process", "processed"] as const;
export type ReviewStateFilter = (typeof REVIEW_STATE_FILTERS)[number];

function matchesReviewState(summary: AnalysisSummary, filter: ReviewStateFilter): boolean {
  const { state, toProcess } = summary.progress;
  if (filter === "to_process") return toProcess;
  if (filter === "processed") return state === "submitted" && !toProcess;
  return state === filter;
}

/** Analyses regroupées par projet, les projets triés par leur analyse la plus récente. */
function groupByProject(analyses: AnalysisSummary[]): Map<string, AnalysisSummary[]> {
  const groups = new Map<string, AnalysisSummary[]>();
  for (const summary of analyses) {
    const group = groups.get(summary.project);
    if (group) group.push(summary);
    else groups.set(summary.project, [summary]);
  }
  return groups;
}

/** `2 analysis(es): 1 in progress, 1 submitted`. */
function projectCounts(analyses: AnalysisSummary[]): string {
  const counts = REVIEW_PROGRESS_STATES.map((state) => [state, analyses.filter((summary) => summary.progress.state === state).length] as const)
    .filter(([, count]) => count > 0)
    .map(([state, count]) => `${count} ${progressStateLabel(state)}`);
  return `${analyses.length} analysis(es): ${counts.join(", ")}`;
}

function analysisLines(summary: AnalysisSummary): string[] {
  const { processed, toProcess } = summary.progress;
  const feedback = toProcess ? " — read it with get_review_feedback" : "";
  const lines = [
    `- ${summary.id} — "${summary.title}"`,
    `  ${refsLabel(summary)} | files reviewed ${summary.reviewedCount}/${summary.fileCount} | ` +
      `open findings: ${severityCountsLabel(summary.openFindings)} | diagrams: ${summary.diagramCount}`,
    `  review: ${progressLabel(summary.progress)}${feedback} | updated ${summary.updatedAt}`,
  ];
  if (processed?.note) lines.push(`  processing note: ${processed.note}`);
  return lines;
}

/**
 * Liste les analyses regroupées par projet (projet le plus récemment modifié en
 * premier, puis analyses de la plus récente à la plus ancienne), éventuellement
 * limitées à un projet et à un état de revue, et les fichiers illisibles.
 */
export function listAnalyses(store: AnalysisStore, args: Args): ToolResult {
  rejectUnknownFields(args, ["project", "review_state"]);
  const project = optionalString(args, "project");
  const reviewState = optionalEnum(args, "review_state", REVIEW_STATE_FILTERS);
  const { analyses: all, unreadable } = store.list();
  const known = new Set(all.map((summary) => summary.project));
  const analyses = reviewState === undefined ? all : all.filter((summary) => matchesReviewState(summary, reviewState));
  const groups = groupByProject(analyses);
  const lines: string[] = [];

  if (project !== undefined && !known.has(project)) {
    const names = [...groupByProject(all).keys()];
    throw new Error(
      names.length === 0
        ? `Unknown project "${project}": there are no analyses yet. Create one with create_analysis.`
        : `Unknown project "${project}". Existing projects: ${names.map((name) => `"${name}"`).join(", ")}. ` +
            `Call list_analyses without project to see them all, or create_analysis to start a new project.`
    );
  }

  const shown = project === undefined ? [...groups] : groups.has(project) ? [[project, groups.get(project)!] as const] : [];
  const scope = project === undefined ? "" : ` in project "${project}"`;
  const filtered = reviewState === undefined ? "" : ` with review state ${reviewState}`;
  if (all.length === 0) {
    lines.push(
      "No analyses yet. Create one with create_analysis once the feature is developed: it freezes the diff of a branch or of the working tree for human review."
    );
  } else if (shown.length === 0) {
    lines.push(`No analysis${scope}${filtered}. Call list_analyses without review_state to see them all.`);
  } else {
    const total = shown.reduce((sum, [, list]) => sum + list.length, 0);
    lines.push(
      project === undefined
        ? `${total} analysis(es)${filtered} in ${groups.size} project(s), most recently updated first:`
        : `${total} analysis(es)${filtered}${scope}, most recently updated first:`
    );
    for (const [name, list] of shown) {
      lines.push("", `## Project "${name}" (${projectCounts(list)})`);
      for (const summary of list) lines.push(...analysisLines(summary));
    }
    lines.push(
      "",
      "To continue the review of a feature, reuse its analysis: update_analysis to rewrite the overview and summary, " +
        "refresh_analysis after changing the code. Create a new analysis only for another feature or another diff."
    );
  }

  if (unreadable.length > 0) {
    lines.push(
      "",
      `${unreadable.length} analysis file(s) could not be read. Fix the file or remove it with delete_analysis:`,
      ...unreadable.map((entry) => `- ${entry.id}: ${entry.error}`)
    );
  }
  return textResult(lines.join("\n"));
}
