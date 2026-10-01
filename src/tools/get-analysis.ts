import { summarize, type AnalysisStore } from "../core/analysis-store.js";
import type { Analysis, Diagram, Note } from "../../shared/schemas/analysis.schema.js";
import { diagramQuality } from "../../shared/diagram-quality.js";
import { reviewProgress } from "../../shared/review-state.js";
import { sortBySeverity } from "../../shared/severity.js";
import {
  fileLine,
  explanationLine,
  fileTotals,
  findingLine,
  noteLocationLabel,
  overviewLines,
  progressLabel,
  severityCountsLabel,
  snapshotLabel,
} from "./format.js";
import { rejectUnknownFields, requireString, textResult, type Args, type ToolResult } from "./types.js";

function noteLine(note: Note): string {
  return `${note.id} — ${noteLocationLabel(note)} — ${note.text.replace(/\n/g, " / ")}`;
}

function reviewLines(analysis: Analysis): string[] {
  const review = analysis.review;
  const progress = progressLabel(reviewProgress(analysis));
  if (review.state === "submitted") {
    return [
      `Review: ${progress}, submitted at ${review.submittedAt}, ` +
        `${review.selectedFindingIds.length} finding(s) and ${review.selectedNoteIds.length} note(s) selected. ` +
        `Read it with get_review_feedback.`,
    ];
  }
  return [`Review: ${progress} — the reviewer has not submitted feedback yet.`];
}

/** Ligne d'un schéma, avec un avertissement quand son tracé a des croisements ou ne peut pas être calculé. */
function diagramLine(diagram: Diagram): string {
  const head = `  ${diagram.id} — "${diagram.title}" (${diagram.kind}, ${diagram.nodes.length} node(s), ${diagram.links.length} link(s))`;
  let quality;
  try {
    quality = diagramQuality(diagram);
  } catch (err) {
    return `${head} — WARNING: cannot be laid out (${(err as Error).message}). Fix it with set_diagram.`;
  }
  const problems: string[] = [];
  if (quality.crossings.length > 0) problems.push(`${quality.crossings.length} link crossing(s)`);
  if (quality.nodeOverlaps.length > 0) problems.push(`${quality.nodeOverlaps.length} link(s) through a node`);
  if (problems.length === 0) return head;
  return `${head} — WARNING: ${problems.join(", ")}. Send it again with set_diagram to see the details and fix it.`;
}

/** Vue complète et lisible d'une analyse. */
export function getAnalysis(store: AnalysisStore, args: Args): ToolResult {
  rejectUnknownFields(args, ["analysis_id"]);
  const analysis = store.get(requireString(args, "analysis_id"));
  const lines = [
    `# ${analysis.title} (id: ${analysis.id})`,
    `Project: ${analysis.project}`,
    `Repository: ${analysis.repoPath}`,
    `Diff: ${snapshotLabel(analysis)}`,
    `Revision ${analysis.revision}, last edited by ${analysis.lastEditor} at ${analysis.updatedAt}`,
    "",
  ];

  if (analysis.request) {
    lines.push(`Initial request${analysis.request.source ? ` (${analysis.request.source})` : ""}:`, analysis.request.text, "");
  } else {
    lines.push("Initial request: none recorded (set it with update_analysis).", "");
  }

  lines.push(...overviewLines(analysis.overview), "");

  if (analysis.summary.length > 0) {
    lines.push("Summary:", ...analysis.summary.map((bullet) => `- ${bullet}`), "");
  } else {
    lines.push("Summary: none yet (write it with update_analysis).", "");
  }

  const reviewed = analysis.files.filter((file) => file.reviewed).length;
  lines.push(`Files (${fileTotals(analysis.files)}; reviewed ${reviewed}/${analysis.files.length}):`);
  lines.push(...analysis.files.map((file) => `  [${file.reviewed ? "x" : " "}] ${fileLine(file)}`), "");

  const counts = { open: 0, ignored: 0, outdated: 0 };
  for (const finding of analysis.findings) counts[finding.status]++;
  lines.push(
    `Findings (${analysis.findings.length}: ${counts.open} open, ${counts.ignored} ignored, ${counts.outdated} outdated; ` +
      `open by severity: ${severityCountsLabel(summarize(analysis).openFindings)}):`
  );
  if (analysis.findings.length === 0) lines.push("  none (record them with add_findings)");
  lines.push(...sortBySeverity(analysis.findings).map((finding) => `  ${findingLine(finding)}`), "");

  const outdatedExplanations = analysis.explanations.filter((explanation) => explanation.status === "outdated").length;
  lines.push(`Explanations (${analysis.explanations.length}: ${outdatedExplanations} outdated):`);
  if (analysis.explanations.length === 0) lines.push("  none (explain long or complex blocks with add_explanations)");
  lines.push(...analysis.explanations.map((explanation) => `  ${explanationLine(explanation)}`), "");

  lines.push(`Reviewer notes (${analysis.notes.length}):`);
  if (analysis.notes.length === 0) lines.push("  none");
  lines.push(...analysis.notes.map((note) => `  ${noteLine(note)}`), "");

  lines.push(`Diagrams (${analysis.diagrams.length}):`);
  if (analysis.diagrams.length === 0) lines.push("  none (draw one with set_diagram when a picture helps)");
  lines.push(...analysis.diagrams.map(diagramLine), "");

  lines.push(...reviewLines(analysis));
  return textResult(lines.join("\n"));
}
