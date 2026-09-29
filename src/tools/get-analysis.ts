import { summarize, type AnalysisStore } from "../core/analysis-store.js";
import type { Analysis, Note } from "../../shared/schemas/analysis.schema.js";
import { fileLine, fileTotals, findingLine, severityCountsLabel, snapshotLabel, sortBySeverity } from "./format.js";
import { rejectUnknownFields, requireString, textResult, type Args, type ToolResult } from "./types.js";

function noteLine(note: Note): string {
  let where = "whole analysis";
  if (note.location) where = note.location.line === null ? note.location.path : `${note.location.path}:${note.location.line}`;
  return `${note.id} — ${where} — ${note.text.replace(/\n/g, " / ")}`;
}

function reviewLines(analysis: Analysis): string[] {
  const review = analysis.review;
  if (review.state === "submitted") {
    return [
      `Review: submitted at ${review.submittedAt}, decision ${review.decision}, ` +
        `${review.selectedFindingIds.length} finding(s) and ${review.selectedNoteIds.length} note(s) selected. ` +
        `Read it with get_review_feedback.`,
    ];
  }
  return ["Review: pending — the reviewer has not submitted feedback yet."];
}

/** Vue complète et lisible d'une analyse. */
export function getAnalysis(store: AnalysisStore, args: Args): ToolResult {
  rejectUnknownFields(args, ["analysis_id"]);
  const analysis = store.get(requireString(args, "analysis_id"));
  const lines = [
    `# ${analysis.title} (id: ${analysis.id})`,
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

  lines.push(`Reviewer notes (${analysis.notes.length}):`);
  if (analysis.notes.length === 0) lines.push("  none");
  lines.push(...analysis.notes.map((note) => `  ${noteLine(note)}`), "");

  lines.push(`Diagrams (${analysis.diagrams.length}):`);
  if (analysis.diagrams.length === 0) lines.push("  none (draw one with set_diagram when a picture helps)");
  lines.push(
    ...analysis.diagrams.map(
      (diagram) => `  ${diagram.id} — "${diagram.title}" (${diagram.kind}, ${diagram.nodes.length} node(s), ${diagram.links.length} link(s))`
    ),
    ""
  );

  lines.push(...reviewLines(analysis));
  return textResult(lines.join("\n"));
}
