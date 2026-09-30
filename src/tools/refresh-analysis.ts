import type { AnalysisStore } from "../core/analysis-store.js";
import { computeSnapshot, localRepo, type RepoAccess } from "../core/git.js";
import { snapshotLabel } from "./format.js";
import { rejectUnknownFields, requireString, textResult, type Args, type MutationResult } from "./types.js";

/**
 * Recalcule le snapshot avec le dépôt, le mode et les refs de l'analyse, lus par
 * `repoFor` (git local par défaut) ; la revue repart à l'état `pending` sans décision, sélection ni prompt.
 */
export async function refreshAnalysis(
  store: AnalysisStore,
  args: Args,
  repoFor: (repoPath: string) => RepoAccess = localRepo
): Promise<MutationResult> {
  rejectUnknownFields(args, ["analysis_id"]);
  const id = requireString(args, "analysis_id");
  const current = store.get(id);

  const computed = await computeSnapshot(
    { repoPath: current.repoPath, mode: current.mode, base: current.base, head: current.head },
    repoFor(current.repoPath)
  );
  const { analysis, stats, previousReview } = store.replaceSnapshot(id, "agent", computed);

  const outdated = analysis.findings.filter((finding) => finding.status === "outdated");
  const lines = [
    `Refreshed analysis "${analysis.title}" (${analysis.id}).`,
    `Diff: ${snapshotLabel(analysis)}`,
    `Files: ${stats.fileCount} (${stats.filesAdded} new in the diff, ${stats.filesRemoved} no longer in it).`,
    `Reviewed files: ${stats.reviewedKept} kept (diff unchanged), ${stats.reviewedReset} reset to unreviewed (diff changed).`,
    `Findings: ${stats.findingsOutdated} became outdated (their lines changed or left the diff), ` +
      `${stats.findingsRestored} back to open (their lines match again); ${outdated.length} outdated in total.`,
  ];
  if (previousReview.state === "submitted") {
    lines.push(
      `Review: the previous feedback (decision ${previousReview.decision}, submitted at ${previousReview.submittedAt}) was discarded; the review is pending again.`
    );
  } else {
    lines.push("Review: pending; the previous feedback, decision and selection in progress were discarded.");
  }
  lines.push(
    "",
    "Next steps:",
    "- Re-read the changed files with get_diff.",
    "- For each outdated finding: re-anchor it with update_finding (a new location reopens it), or remove it with delete_findings if it is solved.",
    "- Ask the user to review the analysis again in the GUI."
  );
  if (outdated.length > 0) {
    lines.push("", "Outdated findings:", ...outdated.map((finding) => `  ${finding.id} [${finding.severity}] ${finding.title}`));
  }

  return { result: textResult(lines.join("\n")), analysisId: analysis.id };
}
