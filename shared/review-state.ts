import type { Analysis, ReviewProgress } from "./schemas/analysis.schema.js";

/**
 * Avancement de la revue d'une analyse :
 * - `submitted` : revue soumise, avec sa décision ;
 * - `files_reviewed` : tous les fichiers revus, revue non soumise ;
 * - `in_progress` : au moins un fichier revu, revue non soumise ;
 * - `not_started` : aucun fichier revu, revue non soumise. Une analyse sans
 *   fichier reste `not_started` jusqu'à la soumission.
 */
export function reviewProgress(analysis: Pick<Analysis, "files" | "review">): ReviewProgress {
  const totalFiles = analysis.files.length;
  const reviewedFiles = analysis.files.filter((file) => file.reviewed).length;
  if (analysis.review.state === "submitted") {
    return { state: "submitted", reviewedFiles, totalFiles, decision: analysis.review.decision };
  }
  const state = reviewedFiles === 0 ? "not_started" : reviewedFiles === totalFiles ? "files_reviewed" : "in_progress";
  return { state, reviewedFiles, totalFiles, decision: null };
}
