import type { AnalysisStore } from "../core/analysis-store.js";
import type { Analysis, Finding, Note } from "../../shared/schemas/analysis.schema.js";
import { reviewProgress } from "../../shared/review-state.js";
import { sortBySeverity } from "../../shared/severity.js";
import { findingLine, indentBlock, noteLocationLabel, overviewLines, progressLabel } from "./format.js";
import { rejectUnknownFields, requireString, textResult, type Args, type ToolResult } from "./types.js";

function findingDetails(finding: Finding): string[] {
  const lines = [`- ${findingLine(finding)}`];
  if (finding.body.trim() !== "") lines.push(indentBlock(finding.body, "    "));
  if (finding.suggestion !== null) lines.push("    Proposed replacement:", indentBlock(finding.suggestion, "      "));
  return lines;
}

function noteDetails(note: Note): string {
  return `- ${note.id} — ${noteLocationLabel(note)}\n${indentBlock(note.text, "    ")}`;
}

/** Avancement d'une revue non soumise. */
function progressLines(analysis: Analysis): string[] {
  const progress = reviewProgress(analysis);
  const ignored = analysis.findings.filter((finding) => finding.status === "ignored").length;
  return [
    `The review of "${analysis.title}" (${analysis.id}, project "${analysis.project}") is not submitted yet.`,
    `Review state: ${progressLabel(progress)}.`,
    `Progress: ${progress.reviewedFiles}/${progress.totalFiles} file(s) reviewed, ${ignored}/${analysis.findings.length} finding(s) ignored, ` +
      `${analysis.notes.length} reviewer note(s).`,
    "",
    ...overviewLines(analysis.overview),
    "",
    "Ask the user to finish the review in the GUI and save the feedback, then call get_review_feedback again.",
  ];
}

/** Retour du relecteur : décision, points retenus et prompt ; sinon l'avancement de la revue. Lecture seule. */
export function getReviewFeedback(store: AnalysisStore, args: Args): ToolResult {
  rejectUnknownFields(args, ["analysis_id"]);
  const analysis = store.get(requireString(args, "analysis_id"));
  const review = analysis.review;
  if (review.state !== "submitted") return textResult(progressLines(analysis).join("\n"));

  const selectedFindings = new Set(review.selectedFindingIds);
  const selectedNotes = new Set(review.selectedNoteIds);
  const findings = sortBySeverity(analysis.findings.filter((finding) => selectedFindings.has(finding.id)));
  const notes = analysis.notes.filter((note) => selectedNotes.has(note.id));

  const lines = [
    `Review of "${analysis.title}" (${analysis.id}, project "${analysis.project}") submitted at ${review.submittedAt}.`,
    `Decision: ${review.decision}`,
    "",
    ...overviewLines(analysis.overview),
    "",
    `Selected findings (${findings.length}):`,
  ];
  lines.push(...(findings.length === 0 ? ["  none"] : findings.flatMap(findingDetails)), "");
  lines.push(`Selected reviewer notes (${notes.length}):`);
  lines.push(...(notes.length === 0 ? ["  none"] : notes.map(noteDetails)), "");

  if (review.prompt === null) {
    lines.push("Prompt: none was recorded with this submission.");
  } else {
    lines.push("Prompt from the reviewer (verbatim):", "-----", review.prompt, "-----");
  }
  lines.push("");
  if (review.decision === "reject") {
    lines.push("Next steps: the reviewer rejected the feature. Ask the user how to proceed before changing the code.");
  } else if (review.decision === "approve" && findings.length === 0 && notes.length === 0) {
    lines.push("Next steps: the reviewer approved the feature with no points to address.");
  } else {
    lines.push(
      "Next steps: address the points above in the repository, then call refresh_analysis to recompute the diff " +
        "(it discards this feedback and starts a new review round)."
    );
  }
  return textResult(lines.join("\n"));
}
