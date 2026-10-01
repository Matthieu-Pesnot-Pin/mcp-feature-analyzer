import type { ExplanationLocation, ExplanationSide, FileEntry } from "../../shared/schemas/analysis.schema.js";
import type { DiffSnapshot, FileDiff } from "../../shared/schemas/diff.schema.js";
import { splitLines } from "../../shared/text.js";
import { AnalysisError } from "./errors.js";

export interface LocationRequest {
  path: string;
  startLine: number;
  /** Dernière ligne incluse ; vaut `startLine` quand elle est omise. */
  endLine?: number | null;
}

export interface ResolvedLocation {
  path: string;
  startLine: number;
  endLine: number;
  /** Texte exact des lignes visées, jointes par `\n`. */
  anchorText: string;
}

/** Liste lisible des chemins d'une analyse, pour les messages d'erreur. */
function describeFiles(files: FileEntry[]): string {
  if (files.length === 0) return "the analysis has no changed files";
  return `changed files: ${files.map((file) => file.path).join(", ")}`;
}

/** Raison pour laquelle le contenu d'un fichier n'est pas conservé dans le snapshot. */
function unavailableReason(file: FileEntry): string {
  if (file.status === "deleted") return "it is deleted";
  if (file.binary) return "it is binary";
  return "it is larger than the snapshot size limit";
}

/** Indication donnée à un constat dont le fichier n'a pas de contenu conservé. */
const FINDING_UNAVAILABLE_HINT =
  "Anchor the point on lines of another changed file, or omit the location (allowed for requirement_gap findings).";

/**
 * Vérifie un emplacement (lignes du côté « nouveau ») contre le snapshot et
 * renvoie le texte des lignes visées. Erreur explicite si le fichier n'est pas
 * dans l'analyse, si son contenu n'est pas disponible ou si les lignes sortent
 * du fichier ; `unavailableHint` complète le message d'un contenu indisponible.
 */
export function resolveLocation(
  snapshot: DiffSnapshot,
  files: FileEntry[],
  request: LocationRequest,
  unavailableHint = FINDING_UNAVAILABLE_HINT
): ResolvedLocation {
  const endLine = request.endLine ?? request.startLine;
  const { path, startLine } = request;

  const file = files.find((entry) => entry.path === path);
  if (!file) {
    throw new AnalysisError(`File "${path}" is not part of this analysis (${describeFiles(files)}).`);
  }
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
    throw new AnalysisError(
      `Invalid line range ${startLine}-${endLine} for "${path}": lines are 1-based integers and end_line must be >= start_line.`
    );
  }
  const diff = snapshot.files.find((entry) => entry.path === path);
  if (!file.contentAvailable || !diff || diff.newContent === null) {
    throw new AnalysisError(
      `Cannot anchor on lines of "${path}": its content is not available because ${unavailableReason(file)}. ${unavailableHint}`
    );
  }
  const lines = splitLines(diff.newContent);
  if (endLine > lines.length) {
    throw new AnalysisError(
      `Lines ${startLine}-${endLine} are out of range for "${path}", which has ${lines.length} line(s) on the new side. ` +
        `Use get_diff to read the new-side line numbers.`
    );
  }
  return { path, startLine, endLine, anchorText: lines.slice(startLine - 1, endLine).join("\n") };
}

/** Texte des lignes du côté « ancien » que montre le diff (lignes supprimées et contexte), par numéro. */
function oldSideLines(diff: FileDiff): Map<number, { text: string; removed: boolean }> {
  const lines = new Map<number, { text: string; removed: boolean }>();
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.oldNo !== null) lines.set(line.oldNo, { text: line.text, removed: line.type === "del" });
    }
  }
  return lines;
}

/**
 * Texte actuel des lignes décrites par une explication, ou null quand elles ne
 * sont plus lisibles : côté `new`, dans le contenu conservé du fichier ; côté
 * `old`, dans les lignes du côté « ancien » que montre le diff.
 */
export function explanationText(diff: FileDiff | undefined, location: ExplanationLocation): string | null {
  if (!diff || location.startLine > location.endLine) return null;
  if (location.side === "new") {
    if (diff.newContent === null) return null;
    const lines = splitLines(diff.newContent);
    if (location.startLine < 1 || location.endLine > lines.length) return null;
    return lines.slice(location.startLine - 1, location.endLine).join("\n");
  }
  const old = oldSideLines(diff);
  const texts: string[] = [];
  for (let line = location.startLine; line <= location.endLine; line++) {
    const entry = old.get(line);
    if (!entry) return null;
    texts.push(entry.text);
  }
  return texts.join("\n");
}

export interface ExplanationLocationRequest extends LocationRequest {
  side: ExplanationSide;
}

/**
 * Vérifie l'emplacement d'une explication et renvoie le texte des lignes décrites.
 * - côté `new` : mêmes règles qu'un constat ;
 * - côté `old` : toutes les lignes doivent figurer dans le diff (numéros de la
 *   première colonne de get_diff), et au moins une doit être supprimée.
 */
export function resolveExplanationLocation(
  snapshot: DiffSnapshot,
  files: FileEntry[],
  request: ExplanationLocationRequest
): ExplanationLocation & { anchorText: string } {
  if (request.side === "new") {
    const resolved = resolveLocation(
      snapshot,
      files,
      request,
      `Explain its removed lines on the old side ("side": "old"), or explain lines of another changed file.`
    );
    return { path: resolved.path, side: "new", startLine: resolved.startLine, endLine: resolved.endLine, anchorText: resolved.anchorText };
  }

  const endLine = request.endLine ?? request.startLine;
  const { path, startLine } = request;
  if (!files.some((entry) => entry.path === path)) {
    throw new AnalysisError(`File "${path}" is not part of this analysis (${describeFiles(files)}).`);
  }
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
    throw new AnalysisError(
      `Invalid line range ${startLine}-${endLine} for "${path}": lines are 1-based integers and end_line must be >= start_line.`
    );
  }
  const diff = snapshot.files.find((entry) => entry.path === path);
  const old = diff ? oldSideLines(diff) : new Map<number, { text: string; removed: boolean }>();
  const missing: number[] = [];
  let removed = false;
  for (let line = startLine; line <= endLine; line++) {
    const entry = old.get(line);
    if (!entry) missing.push(line);
    else if (entry.removed) removed = true;
  }
  if (missing.length > 0) {
    throw new AnalysisError(
      `Old-side lines ${startLine}-${endLine} of "${path}" are not all in the diff (missing: ${lineList(missing)}). ` +
        `Old-side numbers are those of the first column of get_diff; an old-side explanation covers removed lines and their context.`
    );
  }
  if (!removed) {
    throw new AnalysisError(
      `Old-side lines ${startLine}-${endLine} of "${path}" contain no removed line. ` +
        `The old side is for removed code: explain kept or added code on the new side ("side": "new").`
    );
  }
  const location: ExplanationLocation = { path, side: "old", startLine, endLine };
  return { ...location, anchorText: explanationText(diff, location)! };
}

/** `3, 4, 9` ; au-delà de dix numéros, les dix premiers suivis de `…`. */
function lineList(lines: number[]): string {
  const shown = lines.slice(0, 10).join(", ");
  return lines.length > 10 ? `${shown}, …` : shown;
}

/**
 * Vérifie l'emplacement d'une remarque : un fichier de l'analyse, et une ligne
 * du côté « nouveau » quand `line` est fournie.
 */
export function assertNoteLocation(files: FileEntry[], location: { path: string; line: number | null }): void {
  const file = files.find((entry) => entry.path === location.path);
  if (!file) {
    throw new AnalysisError(`File "${location.path}" is not part of this analysis (${describeFiles(files)}).`);
  }
  if (location.line === null) return;
  if (!Number.isInteger(location.line) || location.line < 1) {
    throw new AnalysisError(`Invalid line ${location.line} for "${location.path}": lines are 1-based integers.`);
  }
  if (!file.contentAvailable) {
    throw new AnalysisError(
      `Cannot attach a note to a line of "${location.path}": its content is not available because ${unavailableReason(file)}. ` +
        `Attach the note to the whole file instead.`
    );
  }
  if (location.line > file.lineCount) {
    throw new AnalysisError(
      `Line ${location.line} is out of range for "${location.path}", which has ${file.lineCount} line(s) on the new side.`
    );
  }
}
