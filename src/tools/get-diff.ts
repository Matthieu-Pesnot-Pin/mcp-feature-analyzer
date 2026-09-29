import type { AnalysisStore } from "../core/analysis-store.js";
import { AnalysisError } from "../core/errors.js";
import type { FileEntry } from "../../shared/schemas/analysis.schema.js";
import type { DiffLine, FileDiff } from "../../shared/schemas/diff.schema.js";
import { fileLine, snapshotLabel } from "./format.js";
import { optionalString, rejectUnknownFields, requireString, textResult, type Args, type ToolResult } from "./types.js";

const MARKERS: Record<DiffLine["type"], string> = { context: " ", add: "+", del: "-" };

/** Lignes d'un fichier : en-tête, marqueurs binaire / contenu indisponible, puis hunks numérotés `ancien | nouveau`. */
function renderFile(entry: FileEntry, diff: FileDiff): string[] {
  const out = [`=== ${fileLine(entry)}${entry.reviewed ? "  (reviewed)" : ""}`];
  if (entry.binary) {
    out.push("[binary file: no line-level diff, findings cannot be anchored on its lines]");
    return out;
  }
  if (entry.status === "deleted") {
    out.push("[deleted file: no new side, findings cannot be anchored on its lines]");
  } else if (!entry.contentAvailable) {
    out.push("[new-side content not kept (file too large): findings cannot be anchored on its lines]");
  }
  if (diff.hunks.length === 0) {
    out.push(entry.status === "renamed" ? "[renamed without content changes]" : "[no textual changes]");
    return out;
  }

  let width = 1;
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      width = Math.max(width, String(line.oldNo ?? "").length, String(line.newNo ?? "").length);
    }
  }
  const column = (value: number | null) => String(value ?? "").padStart(width);
  for (const hunk of diff.hunks) {
    out.push(hunk.header);
    for (const line of hunk.lines) {
      out.push(`${column(line.oldNo)} | ${column(line.newNo)} ${MARKERS[line.type]} ${line.text}`);
    }
  }
  return out;
}

/** Diff figé d'un fichier ou de tous les fichiers de l'analyse, avec numéros de ligne ancien et nouveau. */
export function getDiff(store: AnalysisStore, args: Args): ToolResult {
  rejectUnknownFields(args, ["analysis_id", "path"]);
  const analysis = store.get(requireString(args, "analysis_id"));
  const path = optionalString(args, "path");
  const snapshot = store.getSnapshot(analysis.id);

  let entries = analysis.files;
  if (path !== undefined) {
    const entry = analysis.files.find((file) => file.path === path);
    if (!entry) {
      const known = analysis.files.map((file) => file.path).join(", ") || "none";
      throw new AnalysisError(`File "${path}" is not part of analysis "${analysis.id}". Changed files: ${known}.`);
    }
    entries = [entry];
  }

  const lines = [
    `Frozen diff of "${analysis.title}" (${analysis.id}): ${snapshotLabel(analysis)}.`,
    "Columns: old line | new line, then + (added), - (removed) or a space (context). " +
      "Anchor findings on the NEW-side numbers (second column).",
  ];
  if (entries.length === 0) lines.push("", "The analysis has no changed files.");
  for (const entry of entries) {
    const diff = snapshot.files.find((file) => file.path === entry.path);
    if (!diff) {
      throw new AnalysisError(
        `The diff snapshot of analysis "${analysis.id}" has no entry for "${entry.path}". Recompute it with refresh_analysis.`
      );
    }
    lines.push("", ...renderFile(entry, diff));
  }
  return textResult(lines.join("\n"));
}
