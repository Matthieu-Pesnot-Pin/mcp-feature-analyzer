import type {
  Analysis,
  AnalysisLink,
  FindingLocation,
  FollowUpLink,
  NoteLocation,
  Processing,
  ReviewDecision,
  Severity,
} from "./schemas/analysis.schema.js";
import { sortBySeverity } from "./severity.js";

/** Point retenu dans le retour d'une analyse, à vérifier dans sa revue de suivi. */
export type FeedbackPoint =
  | { kind: "finding"; id: string; severity: Severity | null; title: string; location: FindingLocation | null }
  | { kind: "note"; id: string; text: string; location: NoteLocation | null };

/** Analyse suivie, vue depuis sa revue de suivi : son retour et les points qu'il retenait. */
export interface PreviousReview extends AnalysisLink {
  submittedAt: string | null;
  decision: ReviewDecision | null;
  processed: Processing | null;
  points: FeedbackPoint[];
}

/** Liens de suivi d'une analyse. */
export interface AnalysisLinks {
  /** Analyse dont celle-ci est la revue de suivi. */
  previous: PreviousReview | null;
  /** Revue de suivi de celle-ci. */
  next: FollowUpLink | null;
  /** Toutes les analyses de la chaîne, de la première revue à la dernière, celle-ci comprise. */
  chain: AnalysisLink[];
}

/**
 * Points retenus par le retour d'une analyse : constats (du plus grave au moins
 * grave) puis remarques. Pour une revue rouverte par le relecteur, ceux de sa
 * dernière version soumise ; aucun pour une revue jamais soumise.
 */
export function feedbackPoints(analysis: Pick<Analysis, "review" | "findings" | "notes">): FeedbackPoint[] {
  const review = analysis.review;
  if (review.state === "submitted") {
    const findingIds = new Set(review.selectedFindingIds);
    const noteIds = new Set(review.selectedNoteIds);
    return [
      ...sortBySeverity(analysis.findings.filter((finding) => findingIds.has(finding.id))).map(
        (finding): FeedbackPoint => ({ kind: "finding", id: finding.id, severity: finding.severity, title: finding.title, location: finding.location })
      ),
      ...analysis.notes
        .filter((note) => noteIds.has(note.id))
        .map((note): FeedbackPoint => ({ kind: "note", id: note.id, text: note.text, location: note.location })),
    ];
  }
  const previous = review.previousSubmission;
  if (!previous) return [];
  const findings = new Map(analysis.findings.map((finding) => [finding.id, finding]));
  return [
    ...previous.findings.map(
      ({ id, title }): FeedbackPoint => ({
        kind: "finding",
        id,
        severity: findings.get(id)?.severity ?? null,
        title,
        location: findings.get(id)?.location ?? null,
      })
    ),
    ...previous.notes.map(({ id, text, location }): FeedbackPoint => ({ kind: "note", id, text, location })),
  ];
}
