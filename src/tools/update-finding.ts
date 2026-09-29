import type { AnalysisStore } from "../core/analysis-store.js";
import { AnalysisError } from "../core/errors.js";
import { resolveLocation, type ResolvedLocation } from "../core/locations.js";
import { FINDING_KINDS, SEVERITIES } from "../../shared/schemas/analysis.schema.js";
import { findingLine } from "./format.js";
import { readLocation } from "./inputs.js";
import {
  has,
  nullableText,
  optionalEnum,
  optionalString,
  rejectUnknownFields,
  requireString,
  requireText,
  textResult,
  type Args,
  type MutationResult,
} from "./types.js";

const EDITABLE = ["severity", "kind", "title", "body", "path", "start_line", "end_line", "suggestion", "prompt"] as const;

/**
 * Modifie les champs de l'agent d'un constat. Un nouvel emplacement est résolu
 * sur le snapshot ; un nouvel emplacement ou son retrait rouvre un constat
 * `outdated`. Le statut `ignored` relève du relecteur et n'est pas modifié.
 */
export function updateFinding(store: AnalysisStore, args: Args): MutationResult {
  rejectUnknownFields(args, ["analysis_id", "finding_id", ...EDITABLE]);
  const id = requireString(args, "analysis_id");
  const findingId = requireString(args, "finding_id");
  const given = EDITABLE.filter((field) => has(args, field));
  if (given.length === 0) {
    throw new Error(`Give at least one field to change: ${EDITABLE.join(", ")}.`);
  }

  const severity = optionalEnum(args, "severity", SEVERITIES);
  const kind = optionalEnum(args, "kind", FINDING_KINDS);
  const title = optionalString(args, "title");
  const body = has(args, "body") ? requireText(args, "body") : undefined;
  const suggestion = nullableText(args, "suggestion", "", true);
  const prompt = nullableText(args, "prompt");
  const location = readLocation(args);

  const analysis = store.get(id);
  const current = analysis.findings.find((finding) => finding.id === findingId);
  if (!current) {
    const known = analysis.findings.map((finding) => finding.id).join(", ") || "none";
    throw new AnalysisError(`Finding "${findingId}" not found in analysis "${id}". Existing findings: ${known}.`);
  }

  const nextKind = kind ?? current.kind;
  const nextHasLocation = location === undefined ? current.location !== null : location !== null;
  const nextSuggestion = suggestion === undefined ? current.suggestion : suggestion;
  if (!nextHasLocation && nextKind === "issue") {
    throw new AnalysisError(
      `Finding "${findingId}" would be an issue without location; only requirement_gap findings may have none. Give "path" and "start_line", or set kind to requirement_gap.`
    );
  }
  if (!nextHasLocation && nextSuggestion !== null) {
    throw new AnalysisError(
      `Finding "${findingId}" would have a suggestion but no location to replace. Clear it with "suggestion": null, or keep a location.`
    );
  }

  let resolved: ResolvedLocation | null = null;
  if (location) resolved = resolveLocation(store.getSnapshot(id), analysis.files, location);

  const previousStatus = current.status;
  const updated = store.mutate(id, "agent", (draft) => {
    if (draft.snapshotAt !== analysis.snapshotAt) {
      throw new AnalysisError(`The diff of analysis "${id}" was recomputed while the finding was validated. Send the update again.`);
    }
    const finding = draft.findings.find((entry) => entry.id === findingId);
    if (!finding) throw new AnalysisError(`Finding "${findingId}" was deleted in the meantime from analysis "${id}".`);
    if (severity !== undefined) finding.severity = severity;
    if (kind !== undefined) finding.kind = kind;
    if (title !== undefined) finding.title = title;
    if (body !== undefined) finding.body = body;
    if (suggestion !== undefined) finding.suggestion = suggestion;
    if (prompt !== undefined) finding.prompt = prompt;
    if (location === null) {
      finding.location = null;
      finding.anchorText = null;
    } else if (resolved) {
      finding.location = { path: resolved.path, startLine: resolved.startLine, endLine: resolved.endLine };
      finding.anchorText = resolved.anchorText;
    }
    if (location !== undefined && finding.status === "outdated") finding.status = "open";
  });

  const finding = updated.findings.find((entry) => entry.id === findingId)!;
  const lines = [`Updated finding ${findingId} (${given.join(", ")}):`, `  ${findingLine(finding)}`];
  if (previousStatus === "outdated" && finding.status === "open") {
    lines.push(
      location === null
        ? "It was outdated; removing its location reopened it."
        : "It was outdated; the new location reopened it."
    );
  } else if (finding.status === "outdated") {
    lines.push("It is still outdated: give a new location (path and start_line, from get_diff) to reopen it, or delete it with delete_findings if it is solved.");
  } else if (finding.status === "ignored") {
    lines.push("It stays ignored: only the reviewer can reopen it in the GUI.");
  }
  return { result: textResult(lines.join("\n")), analysisId: updated.id };
}
