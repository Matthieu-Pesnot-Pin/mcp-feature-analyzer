import type { Analysis } from "../../shared/schemas/analysis.schema.js";
import type {
  AddNoteBody,
  DeleteNoteBody,
  SetFileReviewedBody,
  SetFindingStatusBody,
  SubmitReviewBody,
  UpdateNoteBody,
} from "../../shared/schemas/api.schema.js";
import { buildAgentPrompt } from "../../shared/prompt.js";
import { recordSubmission, reopenSubmittedReview } from "../../shared/review-state.js";
import type { AnalysisStore } from "./analysis-store.js";
import { AnalysisError, NotFoundError } from "./errors.js";
import { itemId } from "./ids.js";
import { assertNoteLocation } from "./locations.js";

/**
 * Modifications faites par le relecteur depuis la GUI. Chacune passe par
 * `store.mutate(id, "user", …, { baseRevision })` et renvoie l'analyse écrite.
 * Changer une remarque ou le statut d'un constat repasse une revue soumise en
 * attente (voir `reopenSubmittedReview`) : son retour n'est plus à traiter tant
 * qu'elle n'est pas soumise à nouveau.
 */

/** Marque un fichier de l'analyse comme revu, ou le repasse à revoir. */
export function setFileReviewed(store: AnalysisStore, analysisId: string, body: SetFileReviewedBody): Analysis {
  return store.mutate(
    analysisId,
    "user",
    (draft) => {
      const file = draft.files.find((entry) => entry.path === body.path);
      if (!file) throw new NotFoundError(`File "${body.path}" is not part of analysis "${analysisId}".`);
      file.reviewed = body.reviewed;
    },
    { baseRevision: body.baseRevision }
  );
}

/**
 * Ignore ou rouvre un constat. `outdated` est posé uniquement par le recalcul
 * du snapshot, et un constat obsolète ne change de statut que lorsque l'agent
 * le réancre.
 */
export function setFindingStatus(
  store: AnalysisStore,
  analysisId: string,
  findingId: string,
  body: SetFindingStatusBody
): Analysis {
  if (body.status === "outdated") {
    throw new AnalysisError(
      `A finding cannot be marked outdated from the review: only refresh_analysis does it, when the targeted lines change. Choose "ignored" or "open".`
    );
  }
  return store.mutate(
    analysisId,
    "user",
    (draft) => {
      const finding = draft.findings.find((entry) => entry.id === findingId);
      if (!finding) throw new NotFoundError(`Finding "${findingId}" not found in analysis "${analysisId}".`);
      if (finding.status === "outdated") {
        throw new AnalysisError(
          `Finding "${findingId}" is outdated: its lines changed since it was written. The agent must anchor it again with update_finding before it can be ignored or reopened.`
        );
      }
      if (finding.status === body.status) return;
      reopenSubmittedReview(draft);
      finding.status = body.status;
    },
    { baseRevision: body.baseRevision }
  );
}

/**
 * Ajoute une remarque du relecteur sur une ligne du côté « nouveau » ou sur un fichier entier,
 * liée au constat `findingId` quand elle y répond.
 */
export function addNote(store: AnalysisStore, analysisId: string, body: AddNoteBody): Analysis {
  return store.mutate(
    analysisId,
    "user",
    (draft) => {
      const location = { path: body.path, line: body.line ?? null };
      assertNoteLocation(draft.files, location);
      const findingId = body.findingId ?? null;
      if (findingId !== null && !draft.findings.some((finding) => finding.id === findingId)) {
        throw new NotFoundError(`Finding "${findingId}" not found in analysis "${analysisId}".`);
      }
      reopenSubmittedReview(draft);
      draft.notes.push({
        id: itemId("note", new Set(draft.notes.map((note) => note.id))),
        location,
        findingId,
        text: body.text,
        createdAt: new Date().toISOString(),
      });
    },
    { baseRevision: body.baseRevision }
  );
}

/** Remplace le texte d'une remarque. */
export function updateNote(store: AnalysisStore, analysisId: string, noteId: string, body: UpdateNoteBody): Analysis {
  return store.mutate(
    analysisId,
    "user",
    (draft) => {
      const note = draft.notes.find((entry) => entry.id === noteId);
      if (!note) throw new NotFoundError(`Note "${noteId}" not found in analysis "${analysisId}".`);
      if (note.text === body.text) return;
      reopenSubmittedReview(draft);
      note.text = body.text;
    },
    { baseRevision: body.baseRevision }
  );
}

/** Supprime une remarque et la retire de la sélection de la revue. */
export function deleteNote(store: AnalysisStore, analysisId: string, noteId: string, body: DeleteNoteBody): Analysis {
  return store.mutate(
    analysisId,
    "user",
    (draft) => {
      const index = draft.notes.findIndex((note) => note.id === noteId);
      if (index === -1) throw new NotFoundError(`Note "${noteId}" not found in analysis "${analysisId}".`);
      reopenSubmittedReview(draft);
      draft.notes.splice(index, 1);
      draft.review.selectedNoteIds = draft.review.selectedNoteIds.filter((id) => id !== noteId);
    },
    { baseRevision: body.baseRevision }
  );
}

function assertKnownIds(label: string, ids: string[], known: string[]): void {
  const knownSet = new Set(known);
  const unknown = ids.filter((id) => !knownSet.has(id));
  if (unknown.length > 0) throw new AnalysisError(`Unknown ${label} id(s) in the selection: ${unknown.join(", ")}.`);
  const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicated.length > 0) throw new AnalysisError(`The selection lists ${label} id(s) twice: ${[...new Set(duplicated)].join(", ")}.`);
}

/**
 * Soumet la revue : décision, points retenus et prompt calculé ici. La revue
 * soumise est à traiter par l'agent. Une nouvelle soumission remplace la
 * précédente, conservée dans `previousSubmission` ; une revue rouverte garde la
 * version soumise qu'elle conservait déjà.
 */
export function submitReview(store: AnalysisStore, analysisId: string, body: SubmitReviewBody): Analysis {
  return store.mutate(
    analysisId,
    "user",
    (draft) => {
      assertKnownIds("finding", body.findingIds, draft.findings.map((finding) => finding.id));
      assertKnownIds("note", body.noteIds, draft.notes.map((note) => note.id));
      const previousSubmission = draft.review.state === "submitted" ? recordSubmission(draft) : draft.review.previousSubmission;
      draft.review = {
        state: "submitted",
        decision: body.decision,
        selectedFindingIds: [...body.findingIds],
        selectedNoteIds: [...body.noteIds],
        prompt: buildAgentPrompt(draft, { findingIds: body.findingIds, noteIds: body.noteIds, decision: body.decision }),
        submittedAt: new Date().toISOString(),
        processed: null,
        previousSubmission,
      };
    },
    { baseRevision: body.baseRevision }
  );
}
