import { z } from "zod";

/**
 * Taille maximale, en octets, du contenu « nouveau côté » conservé dans le
 * snapshot pour un fichier. Au-delà, `newContent` vaut null et le fichier
 * n'accepte pas de constat ancré sur ses lignes.
 */
export const MAX_SNAPSHOT_FILE_BYTES = 1024 * 1024;

export const DIFF_LINE_TYPES = ["context", "add", "del"] as const;

/** Ligne d'un hunk ; le texte ne contient ni préfixe de diff ni fin de ligne (`\n` ou `\r\n`). */
export const DiffLineSchema = z.object({
  type: z.enum(DIFF_LINE_TYPES),
  oldNo: z.number().int().positive().nullable(),
  newNo: z.number().int().positive().nullable(),
  text: z.string(),
});

export const HunkSchema = z.object({
  header: z.string(),
  oldStart: z.number().int().nonnegative(),
  oldLines: z.number().int().nonnegative(),
  newStart: z.number().int().nonnegative(),
  newLines: z.number().int().nonnegative(),
  lines: z.array(DiffLineSchema),
});

/**
 * Diff figé d'un fichier. `newContent` est le texte du côté « nouveau » au
 * moment du snapshot ; il vaut null pour un fichier supprimé, binaire ou plus
 * gros que MAX_SNAPSHOT_FILE_BYTES.
 */
export const FileDiffSchema = z.object({
  path: z.string().min(1),
  hunks: z.array(HunkSchema),
  newContent: z.string().nullable(),
});

export const DiffSnapshotSchema = z.object({
  analysisId: z.string().min(1),
  files: z.array(FileDiffSchema),
});

export type DiffLineType = (typeof DIFF_LINE_TYPES)[number];
export type DiffLine = z.infer<typeof DiffLineSchema>;
export type Hunk = z.infer<typeof HunkSchema>;
export type FileDiff = z.infer<typeof FileDiffSchema>;
export type DiffSnapshot = z.infer<typeof DiffSnapshotSchema>;
