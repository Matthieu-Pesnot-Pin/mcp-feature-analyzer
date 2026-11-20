import { z } from "zod";
import { FILE_LEVELS, FINDING_STATUSES, REVIEW_DECISIONS } from "./analysis.schema.js";

/**
 * Corps des requêtes de modification envoyées par la GUI. Chaque corps porte
 * `baseRevision`, la révision de l'analyse affichée : le serveur refuse la
 * modification si l'analyse a avancé depuis.
 */
const BaseRevisionSchema = z.number().int().nonnegative();

export const SetFileReviewedBodySchema = z.strictObject({
  path: z.string().min(1),
  reviewed: z.boolean(),
  baseRevision: BaseRevisionSchema,
});

/** Niveau choisi par le relecteur pour un fichier classé par l'agent. */
export const SetFileLevelBodySchema = z.strictObject({
  path: z.string().min(1),
  level: z.enum(FILE_LEVELS),
  baseRevision: BaseRevisionSchema,
});

export const SetFindingStatusBodySchema = z.strictObject({
  status: z.enum(FINDING_STATUSES),
  baseRevision: BaseRevisionSchema,
});

/**
 * Remarque sur une ligne du côté « nouveau » (`line`), ou sur le fichier entier (`line` absent ou null).
 * `findingId` lie la remarque au constat auquel elle répond. `askAgent` l'envoie tout de suite à
 * l'agent comme une question, au lieu de la garder pour la fin de revue.
 */
export const AddNoteBodySchema = z.strictObject({
  path: z.string().min(1),
  line: z.number().int().nullable().optional(),
  findingId: z.string().min(1).nullable().optional(),
  text: z.string().trim().min(1, "the note text is empty"),
  askAgent: z.boolean().optional(),
  baseRevision: BaseRevisionSchema,
});

/** Lecture, par le relecteur, de la réponse de l'agent à une question. */
export const MarkAnswerSeenBodySchema = z.strictObject({
  baseRevision: BaseRevisionSchema,
});

/** Relance du relecteur sur une question à laquelle l'agent a répondu. */
export const ReplyToQuestionBodySchema = z.strictObject({
  text: z.string().trim().min(1, "the reply is empty"),
  baseRevision: BaseRevisionSchema,
});

export const UpdateNoteBodySchema = z.strictObject({
  text: z.string().trim().min(1, "the note text is empty"),
  baseRevision: BaseRevisionSchema,
});

export const DeleteNoteBodySchema = z.strictObject({
  baseRevision: BaseRevisionSchema,
});

export const SubmitReviewBodySchema = z.strictObject({
  decision: z.enum(REVIEW_DECISIONS),
  findingIds: z.array(z.string().min(1)),
  noteIds: z.array(z.string().min(1)),
  baseRevision: BaseRevisionSchema,
});

/** Marquage du retour soumis comme traité par le relecteur, avec une note facultative. */
export const MarkProcessedBodySchema = z.strictObject({
  note: z.string().trim().min(1, "the note is empty").nullable().optional(),
  baseRevision: BaseRevisionSchema,
});

export type SetFileReviewedBody = z.infer<typeof SetFileReviewedBodySchema>;
export type SetFileLevelBody = z.infer<typeof SetFileLevelBodySchema>;
export type MarkProcessedBody = z.infer<typeof MarkProcessedBodySchema>;
export type SetFindingStatusBody = z.infer<typeof SetFindingStatusBodySchema>;
export type AddNoteBody = z.infer<typeof AddNoteBodySchema>;
export type UpdateNoteBody = z.infer<typeof UpdateNoteBodySchema>;
export type DeleteNoteBody = z.infer<typeof DeleteNoteBodySchema>;
export type MarkAnswerSeenBody = z.infer<typeof MarkAnswerSeenBodySchema>;
export type ReplyToQuestionBody = z.infer<typeof ReplyToQuestionBodySchema>;
export type SubmitReviewBody = z.infer<typeof SubmitReviewBodySchema>;

/** Données IPC des requêtes de la GUI qui visent une analyse. */
export const AnalysisRequestSchema = z.strictObject({ analysisId: z.string().min(1) });

export const SetFileReviewedRequestSchema = AnalysisRequestSchema.extend({ body: SetFileReviewedBodySchema });
export const SetFileLevelRequestSchema = AnalysisRequestSchema.extend({ body: SetFileLevelBodySchema });
export const SetFindingStatusRequestSchema = AnalysisRequestSchema.extend({
  findingId: z.string().min(1),
  body: SetFindingStatusBodySchema,
});
export const AddNoteRequestSchema = AnalysisRequestSchema.extend({ body: AddNoteBodySchema });
export const UpdateNoteRequestSchema = AnalysisRequestSchema.extend({
  noteId: z.string().min(1),
  body: UpdateNoteBodySchema,
});
export const DeleteNoteRequestSchema = AnalysisRequestSchema.extend({
  noteId: z.string().min(1),
  body: DeleteNoteBodySchema,
});
export const ReplyToQuestionRequestSchema = AnalysisRequestSchema.extend({
  noteId: z.string().min(1),
  body: ReplyToQuestionBodySchema,
});
export const MarkAnswerSeenRequestSchema = AnalysisRequestSchema.extend({
  noteId: z.string().min(1),
  body: MarkAnswerSeenBodySchema,
});
export const SubmitReviewRequestSchema = AnalysisRequestSchema.extend({ body: SubmitReviewBodySchema });
export const MarkProcessedRequestSchema = AnalysisRequestSchema.extend({ body: MarkProcessedBodySchema });
