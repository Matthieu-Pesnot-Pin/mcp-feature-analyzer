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
import type { AnalysisStore } from "./analysis-store.js";
import { AnalysisError, NotFoundError } from "./errors.js";
import { itemId } from "./ids.js";
import { assertNoteLocation } from "./locations.js";

/**
 * Modifications faites par le relecteur depuis la GUI. Chacune passe par
 * `store.mutate(id, "user", …, { baseRevision })` et renvoie l'analyse écrite.
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
      finding.status = body.status;
    },
    { baseRevision: body.baseRevision }
  );
}

/** Ajoute une remarque du relecteur sur une ligne du côté « nouveau » ou sur un fichier entier. */
export function addNote(store: AnalysisStore, analysisId: string, body: AddNoteBody): Analysis {
  return store.mutate(
    analysisId,
    "user",
    (draft) => {
      const location = { path: body.path, line: body.line ?? null };
      assertNoteLocation(draft.files, location);
      draft.notes.push({
        id: itemId("note", new Set(draft.notes.map((note) => note.id))),
        location,
        text: body.text,
        createdAt: new Date().toISOString(),
      });
    },
    { baseRevision: body.baseRevision }
  );
}

/**
 * Remplace le texte d'une remarque. Quand elle fait partie d'une revue soumise,
 * le prompt enregistré est recalculé avec le nouveau texte.
 */
export function updateNote(store: AnalysisStore, analysisId: string, noteId: string, body: UpdateNoteBody): Analysis {
  return store.mutate(
    analysisId,
    "user",
    (draft) => {
      const note = draft.notes.find((entry) => entry.id === noteId);
      if (!note) throw new NotFoundError(`Note "${noteId}" not found in analysis "${analysisId}".`);
      note.text = body.text;
      const review = draft.review;
      if (review.state === "submitted" && review.selectedNoteIds.includes(noteId)) {
        review.prompt = buildAgentPrompt(draft, {
          findingIds: review.selectedFindingIds,
          noteIds: review.selectedNoteIds,
          decision: review.decision,
        });
      }
    },
    { baseRevision: body.baseRevision }
  );
}

/**
 * Supprime une remarque. Quand elle fait partie d'une revue soumise, elle est
 * retirée de la sélection et le prompt enregistré est recalculé sans elle.
 */
export function deleteNote(store: AnalysisStore, analysisId: string, noteId: string, body: DeleteNoteBody): Analysis {
  return store.mutate(
    analysisId,
    "user",
    (draft) => {
      const index = draft.notes.findIndex((note) => note.id === noteId);
      if (index === -1) throw new NotFoundError(`Note "${noteId}" not found in analysis "${analysisId}".`);
      draft.notes.splice(index, 1);
      const review = draft.review;
      if (!review.selectedNoteIds.includes(noteId)) return;
      review.selectedNoteIds = review.selectedNoteIds.filter((id) => id !== noteId);
      if (review.state === "submitted") {
        review.prompt = buildAgentPrompt(draft, {
          findingIds: review.selectedFindingIds,
          noteIds: review.selectedNoteIds,
          decision: review.decision,
        });
      }
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
 * Soumet la revue : décision, points retenus et prompt calculé ici. Une
 * nouvelle soumission remplace la précédente.
 */
export function submitReview(store: AnalysisStore, analysisId: string, body: SubmitReviewBody): Analysis {
  return store.mutate(
    analysisId,
    "user",
    (draft) => {
      assertKnownIds("finding", body.findingIds, draft.findings.map((finding) => finding.id));
      assertKnownIds("note", body.noteIds, draft.notes.map((note) => note.id));
      draft.review = {
        state: "submitted",
        decision: body.decision,
        selectedFindingIds: [...body.findingIds],
        selectedNoteIds: [...body.noteIds],
        prompt: buildAgentPrompt(draft, { findingIds: body.findingIds, noteIds: body.noteIds, decision: body.decision }),
        submittedAt: new Date().toISOString(),
      };
    },
    { baseRevision: body.baseRevision }
  );
}
