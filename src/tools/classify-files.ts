import type { AnalysisStore } from "../core/analysis-store.js";
import { AnalysisError } from "../core/errors.js";
import { sensitiveFileKind } from "../../shared/file-levels.js";
import { FILE_LEVELS, type FileLevel } from "../../shared/schemas/analysis.schema.js";
import { classificationLabel } from "./format.js";
import {
  rejectUnknownFields,
  requireArray,
  requireEnum,
  requireObject,
  requireString,
  textResult,
  type Args,
  type MutationResult,
} from "./types.js";

const FILE_INPUT_FIELDS = ["path", "level", "reason"] as const;

/**
 * Classe un lot de fichiers par niveau de relecture, chacun avec sa raison.
 * Tout le lot est validé avant l'écriture : un fichier inconnu, un doublon ou un
 * fichier sensible classé en survol, et rien n'est écrit. Le niveau choisi par
 * le relecteur est conservé, sauf quand l'agent choisit désormais le même.
 */
export function classifyFiles(store: AnalysisStore, args: Args): MutationResult {
  rejectUnknownFields(args, ["analysis_id", "files"]);
  const id = requireString(args, "analysis_id");
  const items = requireArray(args, "files", 1);
  const analysis = store.get(id);
  const known = new Set(analysis.files.map((file) => file.path));

  const seen = new Set<string>();
  const prepared: Array<{ path: string; level: FileLevel; reason: string }> = [];
  const errors: string[] = [];
  items.forEach((raw, index) => {
    try {
      const item = requireObject(raw, `files[${index}]`);
      rejectUnknownFields(item, FILE_INPUT_FIELDS);
      const path = requireString(item, "path");
      const level = requireEnum(item, "level", FILE_LEVELS);
      const reason = requireString(item, "reason");
      if (!known.has(path)) throw new Error(`"${path}" is not a changed file of this analysis (see get_analysis).`);
      if (seen.has(path)) throw new Error(`"${path}" appears twice in this batch.`);
      seen.add(path);
      const sensitive = sensitiveFileKind(path);
      if (level === "skim" && sensitive !== null) {
        throw new Error(`"${path}" is a ${sensitive}: short but heavy with consequences, it is never skimmed. Classify it central or check.`);
      }
      prepared.push({ path, level, reason });
    } catch (err) {
      errors.push(`- files[${index}]: ${(err as Error).message}`);
    }
  });

  if (errors.length > 0) {
    throw new AnalysisError(
      `No file was classified: ${errors.length} of ${items.length} item(s) are invalid. Fix them and send the whole batch again.\n` +
        errors.join("\n")
    );
  }

  const updated = store.mutate(id, "agent", (draft) => {
    for (const { path, level, reason } of prepared) {
      const file = draft.files.find((entry) => entry.path === path);
      if (!file) throw new AnalysisError(`The diff of analysis "${id}" was recomputed while the files were validated. Send the batch again.`);
      const reviewerLevel = file.classification?.reviewerLevel ?? null;
      file.classification = { level, reason, reviewerLevel: reviewerLevel === level ? null : reviewerLevel };
    }
  });

  const classified = new Set(prepared.map((item) => item.path));
  const lines = [
    `Classified ${prepared.length} file(s) of "${updated.title}" (${updated.id}):`,
    ...updated.files.filter((file) => classified.has(file.path)).map((file) => `  ${file.path} — ${classificationLabel(file)}`),
  ];
  const kept = updated.files.filter((file) => classified.has(file.path) && file.classification?.reviewerLevel != null);
  if (kept.length > 0) {
    lines.push(`The reviewer's own level is kept for ${kept.length} file(s); the GUI shows theirs.`);
  }
  const unclassified = updated.files.filter((file) => file.classification === null);
  lines.push(
    unclassified.length === 0
      ? "Every file is classified."
      : `Still unclassified (${unclassified.length}): ${unclassified.map((file) => file.path).join(", ")}. Classify them too: the GUI groups them apart.`
  );
  return { result: textResult(lines.join("\n")), analysisId: updated.id };
}
