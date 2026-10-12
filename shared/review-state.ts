import type { Analysis, Review, ReviewProgress, SubmissionRecord } from "./schemas/analysis.schema.js";

/**
 * Avancement de la revue d'une analyse :
 * - `submitted` : revue soumise, avec sa décision et son traitement par l'agent ;
 * - `files_reviewed` : tous les fichiers revus, revue non soumise ;
 * - `in_progress` : au moins un fichier revu, revue non soumise ;
 * - `not_started` : aucun fichier revu, revue non soumise. Une analyse sans
 *   fichier reste `not_started` jusqu'à la soumission.
 */
export function reviewProgress(analysis: Pick<Analysis, "files" | "review">): ReviewProgress {
  const totalFiles = analysis.files.length;
  const reviewedFiles = analysis.files.filter((file) => file.reviewed).length;
  if (analysis.review.state === "submitted") {
    return { state: "submitted", reviewedFiles, totalFiles, decision: analysis.review.decision, processed: analysis.review.processed };
  }
  const state = reviewedFiles === 0 ? "not_started" : reviewedFiles === totalFiles ? "files_reviewed" : "in_progress";
  return { state, reviewedFiles, totalFiles, decision: null, processed: null };
}

/** Copie autonome de la revue soumise de `analysis` : décision, date, traitement, points retenus et points écartés. */
export function recordSubmission(analysis: Pick<Analysis, "review" | "findings" | "notes">): SubmissionRecord {
  const review = analysis.review;
  if (review.state !== "submitted" || review.decision === null || review.submittedAt === null) {
    throw new Error("Only a submitted review can be recorded.");
  }
  const findingIds = new Set(review.selectedFindingIds);
  const noteIds = new Set(review.selectedNoteIds);
  return {
    decision: review.decision,
    submittedAt: review.submittedAt,
    processed: review.processed,
    findings: analysis.findings.filter((finding) => findingIds.has(finding.id)).map(({ id, title }) => ({ id, title })),
    notes: analysis.notes.filter((note) => noteIds.has(note.id)).map(({ id, location, text }) => ({ id, location, text })),
    excludedFindingIds: analysis.findings.filter((finding) => finding.status === "open" && !findingIds.has(finding.id)).map(({ id }) => id),
    excludedNoteIds: analysis.notes.filter((note) => !noteIds.has(note.id)).map(({ id }) => id),
  };
}

/**
 * Repasse une revue soumise à l'état en attente, avant une modification du
 * relecteur : la version soumise est conservée dans `previousSubmission`. Sans
 * effet sur une revue en attente.
 */
export function reopenSubmittedReview(draft: Pick<Analysis, "review" | "findings" | "notes">): void {
  if (draft.review.state !== "submitted") return;
  draft.review = { ...pendingReview(), previousSubmission: recordSubmission(draft) };
}

/** Revue vierge : en attente, sans décision, sélection, prompt, traitement ni version précédente. */
export function pendingReview(): Review {
  return {
    state: "pending",
    decision: null,
    selectedFindingIds: [],
    selectedNoteIds: [],
    prompt: null,
    submittedAt: null,
    processed: null,
    previousSubmission: null,
  };
}

/** Écarts entre deux versions soumises d'une revue. */
export interface SubmissionChanges {
  decision: { from: SubmissionRecord["decision"]; to: SubmissionRecord["decision"] } | null;
  addedFindings: SubmissionRecord["findings"];
  removedFindings: SubmissionRecord["findings"];
  addedNotes: SubmissionRecord["notes"];
  /** Remarques retenues dans les deux versions dont le texte ou l'emplacement a changé. */
  modifiedNotes: Array<{ before: SubmissionRecord["notes"][number]; after: SubmissionRecord["notes"][number] }>;
  removedNotes: SubmissionRecord["notes"];
}

function sameLocation(a: SubmissionRecord["notes"][number]["location"], b: SubmissionRecord["notes"][number]["location"]): boolean {
  return a === null || b === null ? a === b : a.path === b.path && a.line === b.line;
}

/** Ce qui a changé de la version soumise `before` à la version `after`. */
export function submissionChanges(before: SubmissionRecord, after: SubmissionRecord): SubmissionChanges {
  const afterFindings = new Set(after.findings.map((finding) => finding.id));
  const beforeFindings = new Set(before.findings.map((finding) => finding.id));
  const afterNotes = new Map(after.notes.map((note) => [note.id, note]));
  const beforeNotes = new Map(before.notes.map((note) => [note.id, note]));
  return {
    decision: before.decision === after.decision ? null : { from: before.decision, to: after.decision },
    addedFindings: after.findings.filter((finding) => !beforeFindings.has(finding.id)),
    removedFindings: before.findings.filter((finding) => !afterFindings.has(finding.id)),
    addedNotes: after.notes.filter((note) => !beforeNotes.has(note.id)),
    modifiedNotes: after.notes.flatMap((note) => {
      const previous = beforeNotes.get(note.id);
      return previous && (previous.text !== note.text || !sameLocation(previous.location, note.location)) ? [{ before: previous, after: note }] : [];
    }),
    removedNotes: before.notes.filter((note) => !afterNotes.has(note.id)),
  };
}

/** Vrai quand `submissionChanges` ne relève aucun écart. */
export function hasNoChanges(changes: SubmissionChanges): boolean {
  return (
    changes.decision === null &&
    changes.addedFindings.length === 0 &&
    changes.removedFindings.length === 0 &&
    changes.addedNotes.length === 0 &&
    changes.modifiedNotes.length === 0 &&
    changes.removedNotes.length === 0
  );
}
