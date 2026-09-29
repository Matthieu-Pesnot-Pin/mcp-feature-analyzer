import { summarize, type AnalysisStore } from "../core/analysis-store.js";
import { AnalysisError } from "../core/errors.js";
import { itemId } from "../core/ids.js";
import { resolveLocation } from "../core/locations.js";
import { FINDING_KINDS, SEVERITIES, type Finding } from "../../shared/schemas/analysis.schema.js";
import { findingLine, severityCountsLabel } from "./format.js";
import { readItemId, readLocation } from "./inputs.js";
import {
  nullableText,
  optionalEnum,
  rejectUnknownFields,
  requireArray,
  requireEnum,
  requireObject,
  requireString,
  requireText,
  textResult,
  type Args,
  type MutationResult,
} from "./types.js";

export const FINDING_INPUT_FIELDS = [
  "id",
  "severity",
  "kind",
  "title",
  "body",
  "path",
  "start_line",
  "end_line",
  "suggestion",
  "prompt",
] as const;

/** Constat validé, sans identifiant généré ni date. */
type PreparedFinding = Omit<Finding, "id" | "createdAt" | "status"> & { id: string | undefined };

/**
 * Ajoute un lot de constats. Tout le lot est validé (champs, identifiants,
 * emplacements résolus sur le snapshot) avant l'écriture : un seul constat
 * invalide et rien n'est ajouté.
 */
export function addFindings(store: AnalysisStore, args: Args): MutationResult {
  rejectUnknownFields(args, ["analysis_id", "findings"]);
  const id = requireString(args, "analysis_id");
  const items = requireArray(args, "findings", 1);
  const analysis = store.get(id);
  const snapshot = store.getSnapshot(id);

  const taken = new Set(analysis.findings.map((finding) => finding.id));
  const batchIds = new Set<string>();
  const prepared: PreparedFinding[] = [];
  const errors: string[] = [];

  items.forEach((raw, index) => {
    try {
      const item = requireObject(raw, `findings[${index}]`);
      rejectUnknownFields(item, FINDING_INPUT_FIELDS);
      const findingId = readItemId(item, "id");
      if (findingId !== undefined) {
        if (taken.has(findingId)) throw new Error(`id "${findingId}" is already used by another finding of this analysis.`);
        if (batchIds.has(findingId)) throw new Error(`id "${findingId}" appears twice in this batch.`);
        batchIds.add(findingId);
      }
      const severity = requireEnum(item, "severity", SEVERITIES);
      const kind = optionalEnum(item, "kind", FINDING_KINDS) ?? "issue";
      const title = requireString(item, "title");
      const body = requireText(item, "body");
      const suggestion = nullableText(item, "suggestion", "", true) ?? null;
      const prompt = nullableText(item, "prompt") ?? null;
      const location = readLocation(item);

      if (location === null) throw new Error(`"path" cannot be null here: omit it for a finding without location.`);
      if (location === undefined && kind === "issue") {
        throw new Error(`an issue needs a location ("path" and "start_line"); only requirement_gap findings may omit it.`);
      }
      if (location === undefined && suggestion !== null) {
        throw new Error(`"suggestion" replaces the targeted lines, so it needs a location ("path" and "start_line").`);
      }
      const resolved = location === undefined ? null : resolveLocation(snapshot, analysis.files, location);
      prepared.push({
        id: findingId,
        severity,
        kind,
        title,
        body,
        location: resolved && { path: resolved.path, startLine: resolved.startLine, endLine: resolved.endLine },
        anchorText: resolved?.anchorText ?? null,
        suggestion,
        prompt,
      });
    } catch (err) {
      errors.push(`- findings[${index}]: ${(err as Error).message}`);
    }
  });

  if (errors.length > 0) {
    throw new AnalysisError(
      `No finding was added: ${errors.length} of ${items.length} finding(s) are invalid. Fix them and send the whole batch again.\n` +
        errors.join("\n")
    );
  }

  const added: Finding[] = [];
  const updated = store.mutate(id, "agent", (draft) => {
    if (draft.snapshotAt !== analysis.snapshotAt) {
      throw new AnalysisError(`The diff of analysis "${id}" was recomputed while the findings were validated. Send the batch again.`);
    }
    const ids = new Set([...draft.findings.map((finding) => finding.id), ...batchIds]);
    const now = new Date().toISOString();
    for (const finding of prepared) {
      const newId = finding.id ?? itemId("finding", ids);
      ids.add(newId);
      const created: Finding = { ...finding, id: newId, status: "open", createdAt: now };
      added.push(created);
      draft.findings.push(created);
    }
  });

  const lines = [
    `Added ${added.length} finding(s) to "${updated.title}" (${updated.id}):`,
    ...added.map((finding) => `  ${findingLine(finding)}`),
    `Open findings: ${severityCountsLabel(summarize(updated).openFindings)}.`,
    "Next: draw a diagram with set_diagram if a picture helps, then ask the user to review the analysis in the GUI.",
  ];
  return { result: textResult(lines.join("\n")), analysisId: updated.id };
}
