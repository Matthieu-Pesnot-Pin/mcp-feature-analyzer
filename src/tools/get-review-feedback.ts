import type { AnalysisStore } from "../core/analysis-store.js";
import type { Analysis, Finding, Note, Processing, ReviewDecision, SubmissionRecord } from "../../shared/schemas/analysis.schema.js";
import { hasNoChanges, needsProcessing, recordSubmission, reviewProgress, submissionChanges } from "../../shared/review-state.js";
import { sortBySeverity } from "../../shared/severity.js";
import { findingLine, indentBlock, noteLocationLabel, overviewLines, progressLabel } from "./format.js";
import { rejectUnknownFields, requireString, textResult, type Args, type ToolResult } from "./types.js";

/** `processed at <date> by the agent (note: …)`, `nothing to process (approved)` ou `not processed`. */
function processingLabel(decision: ReviewDecision, processed: Processing | null): string {
  if (processed !== null) {
    const by = processed.by === "user" ? "the reviewer" : "the agent";
    return `processed at ${processed.at} by ${by}${processed.note === null ? "" : ` (note: ${processed.note})`}`;
  }
  return decision === "approve" ? "nothing to process (approved)" : "not processed";
}

/** `submitted at <date>, decision <d>, processed at <date>…` : rappel d'une version soumise. */
function submissionLabel(record: SubmissionRecord): string {
  return `submitted at ${record.submittedAt}, decision ${record.decision}, ${processingLabel(record.decision, record.processed)}`;
}

function recordedNoteLine(note: SubmissionRecord["notes"][number]): string {
  return `${note.id} — ${noteLocationLabel(note)}\n${indentBlock(note.text, "      ")}`;
}

/** Écarts entre la version soumise précédente et la soumission en cours. */
function changeLines(previous: SubmissionRecord, current: SubmissionRecord): string[] {
  const changes = submissionChanges(previous, current);
  const lines = [`Changes since the previous submission (${submissionLabel(previous)}):`];
  if (hasNoChanges(changes)) return [...lines, "  none: same decision and same points."];
  if (changes.decision) lines.push(`  Decision changed: ${changes.decision.from} → ${changes.decision.to}`);
  for (const finding of changes.addedFindings) lines.push(`  + finding ${finding.id} — ${finding.title}`);
  for (const finding of changes.removedFindings) lines.push(`  - finding ${finding.id} — ${finding.title}`);
  for (const note of changes.addedNotes) lines.push(`  + note ${recordedNoteLine(note)}`);
  for (const { before, after } of changes.modifiedNotes) {
    lines.push(`  ~ note ${recordedNoteLine(after)}`, `    was: ${noteLocationLabel(before)}`, indentBlock(before.text, "      "));
  }
  for (const note of changes.removedNotes) lines.push(`  - note ${recordedNoteLine(note)}`);
  return lines;
}

function findingDetails(finding: Finding): string[] {
  const lines = [`- ${findingLine(finding)}`];
  if (finding.body.trim() !== "") lines.push(indentBlock(finding.body, "    "));
  if (finding.suggestion !== null) lines.push("    Proposed replacement:", indentBlock(finding.suggestion, "      "));
  return lines;
}

function noteDetails(note: Note): string {
  return `- ${note.id} — ${noteLocationLabel(note)}\n${indentBlock(note.text, "    ")}`;
}

/**
 * Avancement d'une revue non soumise. Une revue rouverte par le relecteur rappelle
 * la version soumise qu'elle remplacera, sans en donner le contenu.
 */
function progressLines(analysis: Analysis): string[] {
  const progress = reviewProgress(analysis);
  const ignored = analysis.findings.filter((finding) => finding.status === "ignored").length;
  const previous = analysis.review.previousSubmission;
  const lines = [`The review of "${analysis.title}" (${analysis.id}, project "${analysis.project}") is not submitted yet.`];
  if (previous) {
    lines.push(
      `The reviewer reopened the feedback ${submissionLabel(previous)}, and is changing it: do not act on it until it is submitted again.`
    );
  }
  lines.push(
    `Review state: ${progressLabel(progress)}.`,
    `Progress: ${progress.reviewedFiles}/${progress.totalFiles} file(s) reviewed, ${ignored}/${analysis.findings.length} finding(s) ignored, ` +
      `${analysis.notes.length} reviewer note(s).`,
    "",
    ...overviewLines(analysis.overview),
    "",
    "Ask the user to finish the review in the GUI and save the feedback, then call get_review_feedback again."
  );
  return lines;
}

/**
 * Retour du relecteur : décision, état du traitement, écarts avec la version
 * soumise précédente, points retenus et prompt ; sinon l'avancement de la revue.
 * Lecture seule.
 */
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
    `Processing: ${needsProcessing(review) ? "to process (call mark_feedback_processed once handled)" : processingLabel(review.decision!, review.processed)}`,
  ];
  if (review.previousSubmission) lines.push("", ...changeLines(review.previousSubmission, recordSubmission(analysis)));
  lines.push("", ...overviewLines(analysis.overview), "", `Selected findings (${findings.length}):`);
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
      "Next steps: address the points above in the repository. Then either call refresh_analysis to recompute the diff " +
        "(it discards this feedback and starts a new review round), or, when the diff stays as it is (an analysis of one commit, " +
        "fixes made in other commits, answers given in the conversation), call mark_feedback_processed with a note saying how it was handled."
    );
  }
  return textResult(lines.join("\n"));
}
