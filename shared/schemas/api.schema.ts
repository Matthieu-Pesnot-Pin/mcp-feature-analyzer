import { z } from "zod";
import { FINDING_STATUSES, REVIEW_DECISIONS } from "./analysis.schema.js";

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

export const SetFindingStatusBodySchema = z.strictObject({
  status: z.enum(FINDING_STATUSES),
  baseRevision: BaseRevisionSchema,
});

/**
 * Remarque sur une ligne du côté « nouveau » (`line`), ou sur le fichier entier (`line` absent ou null).
 * `findingId` lie la remarque au constat auquel elle répond.
 */
export const AddNoteBodySchema = z.strictObject({
  path: z.string().min(1),
  line: z.number().int().nullable().optional(),
  findingId: z.string().min(1).nullable().optional(),
  text: z.string().trim().min(1, "the note text is empty"),
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

export type SetFileReviewedBody = z.infer<typeof SetFileReviewedBodySchema>;
export type SetFindingStatusBody = z.infer<typeof SetFindingStatusBodySchema>;
export type AddNoteBody = z.infer<typeof AddNoteBodySchema>;
export type UpdateNoteBody = z.infer<typeof UpdateNoteBodySchema>;
export type DeleteNoteBody = z.infer<typeof DeleteNoteBodySchema>;
export type SubmitReviewBody = z.infer<typeof SubmitReviewBodySchema>;

/** Données IPC des requêtes de la GUI qui visent une analyse. */
export const AnalysisRequestSchema = z.strictObject({ analysisId: z.string().min(1) });

export const SetFileReviewedRequestSchema = AnalysisRequestSchema.extend({ body: SetFileReviewedBodySchema });
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
export const SubmitReviewRequestSchema = AnalysisRequestSchema.extend({ body: SubmitReviewBodySchema });
