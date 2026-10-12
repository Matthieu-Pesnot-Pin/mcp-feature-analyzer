import assert from "node:assert/strict";
import test from "node:test";

import { REVIEW_PROGRESS_STYLES } from "../shared/labels.js";
import { hasNoChanges, needsProcessing, pendingReview, recordSubmission, reopenSubmittedReview, reviewProgress, submissionChanges } from "../shared/review-state.js";
import { REVIEW_PROGRESS_STATES } from "../shared/schemas/analysis.schema.js";
import { sampleAnalysis, sampleFinding } from "./helpers.js";

/** Analyse de deux fichiers dont `reviewed` indique les fichiers revus. */
function withReviewed(reviewed: boolean[]) {
  const analysis = sampleAnalysis();
  analysis.files.forEach((file, index) => (file.reviewed = reviewed[index]));
  return analysis;
}

test("reviewProgress: not started, in progress and files reviewed before submission", () => {
  assert.deepEqual(reviewProgress(withReviewed([false, false])), { state: "not_started", reviewedFiles: 0, totalFiles: 2, decision: null, processed: null, toProcess: false });
  assert.deepEqual(reviewProgress(withReviewed([true, false])), { state: "in_progress", reviewedFiles: 1, totalFiles: 2, decision: null, processed: null, toProcess: false });
  assert.deepEqual(reviewProgress(withReviewed([true, true])), { state: "files_reviewed", reviewedFiles: 2, totalFiles: 2, decision: null, processed: null, toProcess: false });
});

test("reviewProgress: a submitted review is submitted with its decision, whatever the files", () => {
  const analysis = withReviewed([true, false]);
  analysis.review = { ...analysis.review, state: "submitted", decision: "request_changes", submittedAt: "2026-09-30T10:00:00.000Z" };
  assert.deepEqual(reviewProgress(analysis), { state: "submitted", reviewedFiles: 1, totalFiles: 2, decision: "request_changes", processed: null, toProcess: true });
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

/** Analyse soumise : f_1 et n_1 retenus, f_2 et n_2 écartés, f_3 ignoré. */
function submittedAnalysis() {
  const note = (id: string, text: string) => ({ id, location: { path: "src/a.ts", line: 2 }, findingId: null, text, createdAt: "2026-09-29T10:00:00.000Z" });
  return sampleAnalysis({
    findings: [sampleFinding(), sampleFinding({ id: "f_2", title: "Second" }), sampleFinding({ id: "f_3", title: "Ignored", status: "ignored" })],
    notes: [note("n_1", "Rename"), note("n_2", "Later")],
    review: {
      ...pendingReview(),
      state: "submitted",
      decision: "request_changes",
      selectedFindingIds: ["f_1"],
      selectedNoteIds: ["n_1"],
      prompt: "x",
      submittedAt: "2026-09-29T11:00:00.000Z",
      processed: { at: "2026-09-29T12:00:00.000Z", note: "fixed by abc" },
    },
  });
}

test("needsProcessing: a submitted review waits for the agent unless it is approved or marked processed", () => {
  const submitted = { ...submittedAnalysis().review, processed: null };
  assert.equal(needsProcessing(submitted), true);
  assert.equal(needsProcessing({ ...submitted, decision: "reject" }), true);
  assert.equal(needsProcessing({ ...submitted, decision: "approve" }), false);
  assert.equal(needsProcessing({ ...submitted, processed: { at: "2026-09-29T12:00:00.000Z", note: null } }), false);
  assert.equal(needsProcessing(pendingReview()), false);
});

test("recordSubmission copies the selected points and the points the reviewer left out", () => {
  assert.deepEqual(recordSubmission(submittedAnalysis()), {
    decision: "request_changes",
    submittedAt: "2026-09-29T11:00:00.000Z",
    processed: { at: "2026-09-29T12:00:00.000Z", note: "fixed by abc" },
    findings: [{ id: "f_1", title: "Wrong value" }],
    notes: [{ id: "n_1", location: { path: "src/a.ts", line: 2 }, text: "Rename" }],
    excludedFindingIds: ["f_2"],
    excludedNoteIds: ["n_2"],
  });
  assert.throws(() => recordSubmission(sampleAnalysis()), /Only a submitted review can be recorded/);
});

test("reopenSubmittedReview turns a submitted review pending and keeps the submitted version, once", () => {
  const analysis = submittedAnalysis();
  const record = recordSubmission(analysis);
  reopenSubmittedReview(analysis);
  assert.deepEqual(analysis.review, { ...pendingReview(), previousSubmission: record });
  reopenSubmittedReview(analysis);
  assert.deepEqual(analysis.review.previousSubmission, record, "a pending review is left as it is");
});

test("submissionChanges lists the decision, findings and notes that changed", () => {
  const before = recordSubmission(submittedAnalysis());
  const after = {
    ...before,
    decision: "approve" as const,
    findings: [{ id: "f_2", title: "Second" }],
    notes: [
      { id: "n_1", location: { path: "src/a.ts", line: 2 }, text: "Rename it" },
      { id: "n_3", location: null, text: "New" },
    ],
  };
  const changes = submissionChanges(before, after);
  assert.deepEqual(changes.decision, { from: "request_changes", to: "approve" });
  assert.deepEqual(changes.addedFindings, [{ id: "f_2", title: "Second" }]);
  assert.deepEqual(changes.removedFindings, [{ id: "f_1", title: "Wrong value" }]);
  assert.deepEqual(changes.addedNotes.map((note) => note.id), ["n_3"]);
  assert.deepEqual(changes.modifiedNotes.map(({ before: old, after: next }) => [old.text, next.text]), [["Rename", "Rename it"]]);
  assert.deepEqual(changes.removedNotes, []);
  assert.equal(hasNoChanges(changes), false);
  assert.equal(hasNoChanges(submissionChanges(before, before)), true);
});
