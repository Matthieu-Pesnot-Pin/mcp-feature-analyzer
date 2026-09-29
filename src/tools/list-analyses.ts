import type { AnalysisStore } from "../core/analysis-store.js";
import { REVIEW_PROGRESS_STATES, type AnalysisSummary } from "../../shared/schemas/analysis.schema.js";
import { progressLabel, progressStateLabel, refsLabel, severityCountsLabel } from "./format.js";
import { optionalString, rejectUnknownFields, textResult, type Args, type ToolResult } from "./types.js";

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
  const feedback = summary.progress.state === "submitted" ? " — read it with get_review_feedback" : "";
  return [
    `- ${summary.id} — "${summary.title}"`,
    `  ${refsLabel(summary)} | files reviewed ${summary.reviewedCount}/${summary.fileCount} | ` +
      `open findings: ${severityCountsLabel(summary.openFindings)} | diagrams: ${summary.diagramCount}`,
    `  review: ${progressLabel(summary.progress)}${feedback} | updated ${summary.updatedAt}`,
  ];
}

/**
 * Liste les analyses regroupées par projet (projet le plus récemment modifié en
 * premier, puis analyses de la plus récente à la plus ancienne), éventuellement
 * limitées à un projet, et les fichiers illisibles.
 */
export function listAnalyses(store: AnalysisStore, args: Args): ToolResult {
  rejectUnknownFields(args, ["project"]);
  const project = optionalString(args, "project");
  const { analyses, unreadable } = store.list();
  const groups = groupByProject(analyses);
  const lines: string[] = [];

  if (project !== undefined && !groups.has(project)) {
    const known = [...groups.keys()];
    throw new Error(
      known.length === 0
        ? `Unknown project "${project}": there are no analyses yet. Create one with create_analysis.`
        : `Unknown project "${project}". Existing projects: ${known.map((name) => `"${name}"`).join(", ")}. ` +
            `Call list_analyses without project to see them all, or create_analysis to start a new project.`
    );
  }

  if (analyses.length === 0) {
    lines.push(
      "No analyses yet. Create one with create_analysis once the feature is developed: it freezes the diff of a branch or of the working tree for human review."
    );
  } else {
    const shown = project === undefined ? [...groups] : [[project, groups.get(project)!] as const];
    const total = shown.reduce((sum, [, list]) => sum + list.length, 0);
    lines.push(
      project === undefined
        ? `${total} analysis(es) in ${groups.size} project(s), most recently updated first:`
        : `${total} analysis(es) in project "${project}", most recently updated first:`
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
