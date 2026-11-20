import type { Note, NoteQuestion, QuestionFollowUp } from "./schemas/analysis.schema.js";

/** Un échange d'une question : message du relecteur et réponse de l'agent. */
export type QuestionExchange = QuestionFollowUp;

/** Échanges d'une question dans l'ordre : la question elle-même (texte de la remarque), puis ses relances. */
export function questionExchanges(note: Note & { question: NoteQuestion }): QuestionExchange[] {
  const { question } = note;
  return [{ text: note.text, askedAt: question.askedAt, answer: question.answer, answerSeenAt: question.answerSeenAt }, ...question.followUps];
}

/** Dernier échange de la question : la dernière relance, ou la question elle-même. */
export function lastExchange(note: Note & { question: NoteQuestion }): QuestionExchange {
  const exchanges = questionExchanges(note);
  return exchanges[exchanges.length - 1];
}

/** Vrai quand le dernier message du relecteur attend la réponse de l'agent. */
export function awaitsAgent(note: Note & { question: NoteQuestion }): boolean {
  return lastExchange(note).answer === null;
}

/** Vrai quand la dernière réponse de l'agent n'a pas encore été lue. */
export function hasUnreadAnswer(note: Note & { question: NoteQuestion }): boolean {
  const last = lastExchange(note);
  return last.answer !== null && last.answerSeenAt === null;
}
