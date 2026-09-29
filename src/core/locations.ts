import type { FileEntry } from "../../shared/schemas/analysis.schema.js";
import type { DiffSnapshot } from "../../shared/schemas/diff.schema.js";
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

/**
 * Vérifie un emplacement (lignes du côté « nouveau ») contre le snapshot et
 * renvoie le texte des lignes visées. Erreur explicite si le fichier n'est pas
 * dans l'analyse, si son contenu n'est pas disponible ou si les lignes sortent
 * du fichier.
 */
export function resolveLocation(snapshot: DiffSnapshot, files: FileEntry[], request: LocationRequest): ResolvedLocation {
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
      `Cannot anchor on lines of "${path}": its content is not available because ${unavailableReason(file)}. ` +
        `Anchor the point on lines of another changed file, or omit the location (allowed for requirement_gap findings).`
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
