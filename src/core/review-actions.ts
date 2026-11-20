import type { Analysis, Editor } from "../../shared/schemas/analysis.schema.js";
import type {
  AddNoteBody,
  DeleteNoteBody,
  MarkAnswerSeenBody,
  MarkProcessedBody,
  ReplyToQuestionBody,
  SetFileLevelBody,
  SetFileReviewedBody,
  SetFindingStatusBody,
  SubmitReviewBody,
  UpdateNoteBody,
} from "../../shared/schemas/api.schema.js";
import { buildAgentPrompt } from "../../shared/prompt.js";
import { lastExchange, questionExchanges } from "../../shared/question-thread.js";
import { recordSubmission, reopenSubmittedReview } from "../../shared/review-state.js";
import type { AnalysisStore, MutateOptions } from "./analysis-store.js";
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
 * Change le niveau d'un fichier classé par l'agent. Choisir le niveau de
 * l'agent efface le choix du relecteur.
 */
export function setFileLevel(store: AnalysisStore, analysisId: string, body: SetFileLevelBody): Analysis {
  return store.mutate(
    analysisId,
    "user",
    (draft) => {
      const file = draft.files.find((entry) => entry.path === body.path);
      if (!file) throw new NotFoundError(`File "${body.path}" is not part of analysis "${analysisId}".`);
      if (file.classification === null) {
        throw new AnalysisError(`File "${body.path}" is not classified yet: the agent classifies it first, with its reason.`);
      }
      file.classification.reviewerLevel = body.level === file.classification.level ? null : body.level;
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
 * liée au constat `findingId` quand elle y répond. Avec `askAgent`, la remarque est une
 * question envoyée tout de suite à l'agent : elle ne fait pas partie du retour de fin de
 * revue et ne repasse donc pas une revue soumise en attente.
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
      const now = new Date().toISOString();
      const question = body.askAgent ? { askedAt: now, answer: null, answerSeenAt: null, followUps: [] } : null;
      if (question === null) reopenSubmittedReview(draft);
      draft.notes.push({
        id: itemId("note", new Set(draft.notes.map((note) => note.id))),
        location,
        findingId,
        text: body.text,
        createdAt: now,
        question,
      });
    },
    { baseRevision: body.baseRevision }
  );
}

/** Enregistre que le relecteur a lu les réponses de l'agent à une question, relances comprises. */
export function markAnswerSeen(store: AnalysisStore, analysisId: string, noteId: string, body: MarkAnswerSeenBody): Analysis {
  return store.mutate(
    analysisId,
    "user",
    (draft) => {
      const note = draft.notes.find((entry) => entry.id === noteId);
      if (!note) throw new NotFoundError(`Note "${noteId}" not found in analysis "${analysisId}".`);
      if (note.question === null) throw new AnalysisError(`Note "${noteId}" is not a question sent to the agent.`);
      if (note.question.answer === null) throw new AnalysisError(`The agent has not answered question "${noteId}" yet.`);
      const now = new Date().toISOString();
      if (note.question.answerSeenAt === null) note.question.answerSeenAt = now;
      for (const followUp of note.question.followUps) {
        if (followUp.answer !== null && followUp.answerSeenAt === null) followUp.answerSeenAt = now;
      }
    },
    { baseRevision: body.baseRevision }
  );
}

/**
 * Ajoute une relance du relecteur à une question : refusé tant que l'agent n'a pas
 * répondu au dernier message. Comme la question, la relance laisse une revue soumise en l'état.
 */
export function replyToQuestion(store: AnalysisStore, analysisId: string, noteId: string, body: ReplyToQuestionBody): Analysis {
  return store.mutate(
    analysisId,
    "user",
    (draft) => {
      const note = draft.notes.find((entry) => entry.id === noteId);
      if (!note) throw new NotFoundError(`Note "${noteId}" not found in analysis "${analysisId}".`);
      if (note.question === null) throw new AnalysisError(`Note "${noteId}" is not a question sent to the agent.`);
      if (lastExchange({ ...note, question: note.question }).answer === null) {
        throw new AnalysisError(`The agent has not answered the last message of question "${noteId}" yet.`);
      }
      note.question.followUps.push({ text: body.text, askedAt: new Date().toISOString(), answer: null, answerSeenAt: null });
    },
    { baseRevision: body.baseRevision }
  );
}

/**
 * Enregistre la réponse de l'agent au dernier message du relecteur sur une question :
 * la question elle-même, ou sa dernière relance. Refusé pour une remarque qui n'est pas
 * une question, ou quand ce dernier message a déjà sa réponse.
 */
export function answerQuestion(store: AnalysisStore, analysisId: string, noteId: string, answer: string): Analysis {
  return store.mutate(analysisId, "agent", (draft) => {
    const note = draft.notes.find((entry) => entry.id === noteId);
    if (!note) {
      throw new NotFoundError(`Question "${noteId}" not found in analysis "${analysisId}". get_analysis lists the reviewer notes and questions.`);
    }
    if (note.question === null) {
      throw new AnalysisError(
        `Note "${noteId}" is not a question: the reviewer keeps it for the end of the review, and get_review_feedback hands it to you once the review is submitted.`
      );
    }
    const exchanges = questionExchanges({ ...note, question: note.question });
    const last = exchanges[exchanges.length - 1];
    if (last.answer !== null) {
      throw new AnalysisError(
        `The last message of question "${noteId}" was already answered at ${last.answer.at}: wait for the reviewer to follow up.`
      );
    }
    const reply = { text: answer, at: new Date().toISOString() };
    const followUp = note.question.followUps[note.question.followUps.length - 1];
    if (followUp) followUp.answer = reply;
    else note.question.answer = reply;
  });
}

/** Remplace le texte d'une remarque ; une question déjà envoyée à l'agent ne change plus. */
export function updateNote(store: AnalysisStore, analysisId: string, noteId: string, body: UpdateNoteBody): Analysis {
  return store.mutate(
    analysisId,
    "user",
    (draft) => {
      const note = draft.notes.find((entry) => entry.id === noteId);
      if (!note) throw new NotFoundError(`Note "${noteId}" not found in analysis "${analysisId}".`);
      if (note.question !== null) throw new AnalysisError(`Note "${noteId}" was sent to the agent as a question: its text cannot change.`);
      if (note.text === body.text) return;
      reopenSubmittedReview(draft);
      note.text = body.text;
    },
    { baseRevision: body.baseRevision }
  );
}

/**
 * Supprime une remarque et la retire de la sélection de la revue. Supprimer une
 * question, qui ne fait pas partie du retour, laisse une revue soumise en l'état.
 */
export function deleteNote(store: AnalysisStore, analysisId: string, noteId: string, body: DeleteNoteBody): Analysis {
  return store.mutate(
    analysisId,
    "user",
    (draft) => {
      const index = draft.notes.findIndex((note) => note.id === noteId);
      if (index === -1) throw new NotFoundError(`Note "${noteId}" not found in analysis "${analysisId}".`);
      if (draft.notes[index].question === null) reopenSubmittedReview(draft);
      draft.notes.splice(index, 1);
      draft.review.selectedNoteIds = draft.review.selectedNoteIds.filter((id) => id !== noteId);
    },
    { baseRevision: body.baseRevision }
  );
}

/** Analyse marquée traitée, et date du marquage qu'elle remplace s'il y en avait un. */
export interface MarkProcessedResult {
  analysis: Analysis;
  replaced: string | null;
}

/**
 * Marque traité le retour soumis d'une analyse : date, note facultative et
 * auteur (`agent` par l'outil MCP, `user` depuis la GUI). Refusé tant que la
 * revue n'est pas soumise ; un nouveau marquage remplace le précédent.
 */
export function markFeedbackProcessed(
  store: AnalysisStore,
  analysisId: string,
  editor: Editor,
  note: string | null,
  options: MutateOptions = {}
): MarkProcessedResult {
  let replaced: string | null = null;
  const analysis = store.mutate(
    analysisId,
    editor,
    (draft) => {
      const review = draft.review;
      if (review.state !== "submitted") {
        const reopened = review.previousSubmission;
        throw new AnalysisError(
          reopened
            ? `The review of analysis "${analysisId}" is not submitted: the reviewer reopened the feedback submitted at ${reopened.submittedAt} and is changing it. ` +
                `Wait until it is submitted again, then read it with get_review_feedback.`
            : `The review of analysis "${analysisId}" is not submitted yet: there is no feedback to mark processed.`
        );
      }
      replaced = review.processed?.at ?? null;
      review.processed = { at: new Date().toISOString(), note, by: editor };
    },
    options
  );
  return { analysis, replaced };
}

/** Marque traité, depuis la GUI, le retour soumis d'une analyse. */
export function markProcessedByReviewer(store: AnalysisStore, analysisId: string, body: MarkProcessedBody): Analysis {
  return markFeedbackProcessed(store, analysisId, "user", body.note ?? null, { baseRevision: body.baseRevision }).analysis;
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
      const questions = body.noteIds.filter((id) => draft.notes.find((note) => note.id === id)?.question !== null);
      if (questions.length > 0) {
        throw new AnalysisError(`Questions already sent to the agent cannot be selected in the review: ${questions.join(", ")}.`);
      }
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
