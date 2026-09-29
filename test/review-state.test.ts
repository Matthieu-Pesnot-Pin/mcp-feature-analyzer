import assert from "node:assert/strict";
import test from "node:test";

import { REVIEW_PROGRESS_STYLES } from "../shared/labels.js";
import { reviewProgress } from "../shared/review-state.js";
import { REVIEW_PROGRESS_STATES } from "../shared/schemas/analysis.schema.js";
import { sampleAnalysis } from "./helpers.js";

/** Analyse de deux fichiers dont `reviewed` indique les fichiers revus. */
function withReviewed(reviewed: boolean[]) {
  const analysis = sampleAnalysis();
  analysis.files.forEach((file, index) => (file.reviewed = reviewed[index]));
  return analysis;
}

test("reviewProgress: not started, in progress and files reviewed before submission", () => {
  assert.deepEqual(reviewProgress(withReviewed([false, false])), { state: "not_started", reviewedFiles: 0, totalFiles: 2, decision: null });
  assert.deepEqual(reviewProgress(withReviewed([true, false])), { state: "in_progress", reviewedFiles: 1, totalFiles: 2, decision: null });
  assert.deepEqual(reviewProgress(withReviewed([true, true])), { state: "files_reviewed", reviewedFiles: 2, totalFiles: 2, decision: null });
});

test("reviewProgress: a submitted review is submitted with its decision, whatever the files", () => {
  const analysis = withReviewed([true, false]);
  analysis.review = { ...analysis.review, state: "submitted", decision: "request_changes", submittedAt: "2026-09-30T10:00:00.000Z" };
  assert.deepEqual(reviewProgress(analysis), { state: "submitted", reviewedFiles: 1, totalFiles: 2, decision: "request_changes" });
});

test("reviewProgress: an analysis without files stays not started until it is submitted", () => {
  const analysis = sampleAnalysis({ files: [] });
  assert.equal(reviewProgress(analysis).state, "not_started");
});

test("review progress labels: a French label and colours for every state", () => {
  assert.deepEqual(Object.keys(REVIEW_PROGRESS_STYLES).sort(), [...REVIEW_PROGRESS_STATES].sort());
  assert.equal(REVIEW_PROGRESS_STYLES.submitted.label, "Soumise");
  assert.equal(REVIEW_PROGRESS_STYLES.not_started.label, "Non commencée");
});
