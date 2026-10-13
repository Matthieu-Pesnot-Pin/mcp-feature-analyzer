import { feedbackPoints, type AnalysisLinks } from "../../shared/follow-ups.js";
import { needsProcessing } from "../../shared/review-state.js";
import type { Analysis, AnalysisLink, AnalysisSummary } from "../../shared/schemas/analysis.schema.js";
import type { AnalysisStore } from "./analysis-store.js";
import { AnalysisError } from "./errors.js";
import { markFeedbackProcessed } from "./review-actions.js";

/**
 * Revues de suivi : une analyse peut déclarer, à sa création, celle dont elle est
 * la suite (`followUpOf`). Une analyse a au plus une revue de suivi, et seule une
 * analyse dont la revue est soumise peut en avoir une.
 */

/** Vérifie que `originId` peut recevoir une revue de suivi et renvoie l'analyse. */
export function assertCanFollowUp(store: AnalysisStore, originId: string): Analysis {
  const origin = store.get(originId);
  if (origin.review.state !== "submitted") {
    throw new AnalysisError(
      `Analysis "${originId}" cannot get a follow-up review: its review is not submitted. ` +
        `A follow-up answers submitted feedback; read it with get_review_feedback once the reviewer has submitted it.`
    );
  }
  const existing = store.list().analyses.find((summary) => summary.id === originId)?.followedBy;
  if (existing) {
    throw new AnalysisError(
      `Analysis "${originId}" already has a follow-up review: "${existing.title}" (${existing.id}). ` +
        `An analysis has at most one follow-up; follow up "${existing.id}" instead to start the next round.`
    );
  }
  return origin;
}

/**
 * Marque traitée l'analyse suivie quand son retour attendait encore l'agent, avec
 * une note qui nomme la revue de suivi. Renvoie vrai si elle a été marquée.
 */
export function markOriginFollowed(store: AnalysisStore, originId: string, followUp: Analysis): boolean {
  if (!needsProcessing(store.get(originId).review)) return false;
  markFeedbackProcessed(store, originId, "agent", `Suivie par la revue « ${followUp.title} »`);
  return true;
}

/** Résumé de `id` dans la liste, avec ses liens de suivi. */
function summaryOf(summaries: AnalysisSummary[], id: string): AnalysisSummary {
  const summary = summaries.find((entry) => entry.id === id);
  if (!summary) throw new AnalysisError(`Analysis "${id}" is missing from the listing.`);
  return summary;
}

/** Liens de suivi d'une analyse : analyse suivie avec son retour, revue de suivi et chaîne complète. */
export function analysisLinks(store: AnalysisStore, id: string): AnalysisLinks {
  const summaries = store.list().analyses;
  const byId = new Map(summaries.map((summary) => [summary.id, summary]));
  const summary = summaryOf(summaries, id);

  const backwards: AnalysisLink[] = [];
  const seen = new Set<string>([id]);
  for (let link = summary.followUpOf; link !== null && !seen.has(link.id); link = byId.get(link.id)?.followUpOf ?? null) {
    seen.add(link.id);
    backwards.unshift({ id: link.id, title: link.title });
  }
  const forwards: AnalysisLink[] = [];
  for (let link = summary.followedBy; link !== null && !seen.has(link.id); link = byId.get(link.id)?.followedBy ?? null) {
    seen.add(link.id);
    forwards.push({ id: link.id, title: link.title });
  }

  let previous: AnalysisLinks["previous"] = null;
  if (summary.followUpOf !== null) {
    const origin = store.get(summary.followUpOf.id);
    const submitted = origin.review.state === "submitted" ? origin.review : origin.review.previousSubmission;
    previous = {
      id: origin.id,
      title: origin.title,
      submittedAt: submitted?.submittedAt ?? null,
      decision: submitted?.decision ?? null,
      processed: submitted?.processed ?? null,
      points: feedbackPoints(origin),
    };
  }

  return {
    previous,
    next: summary.followedBy,
    chain: [...backwards, { id: summary.id, title: summary.title }, ...forwards],
  };
}

/** Détache la revue de suivi de `id`, s'il en a une, avant la suppression de `id`. Renvoie son id. */
export function detachFollowUp(store: AnalysisStore, id: string): string | null {
  const followUp = store.list().analyses.find((summary) => summary.id === id)?.followedBy;
  if (!followUp) return null;
  store.mutate(followUp.id, "agent", (draft) => {
    draft.followUpOf = null;
  });
  return followUp.id;
}
