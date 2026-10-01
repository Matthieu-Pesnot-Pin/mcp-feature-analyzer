import type { Analysis, Explanation, FileEntry, Finding } from "../../shared/schemas/analysis.schema.js";
import type { DiffSnapshot, FileDiff, Hunk } from "../../shared/schemas/diff.schema.js";
import { splitLines } from "../../shared/text.js";
import { AnalysisError } from "./errors.js";
import type { ComputedSnapshot } from "./git.js";
import { explanationText } from "./locations.js";

/** Bilan d'un recalcul, pour le message renvoyé à l'agent. */
export interface RefreshStats {
  fileCount: number;
  filesAdded: number;
  filesRemoved: number;
  /** Fichiers revus dont le diff est inchangé : ils restent revus. */
  reviewedKept: number;
  /** Fichiers revus toujours présents dont le diff a changé : ils repassent à « non revu ». */
  reviewedReset: number;
  /** Constats ouverts passés à `outdated`. */
  findingsOutdated: number;
  /** Constats `outdated` revenus à `open`. */
  findingsRestored: number;
  /** Explications `current` passées à `outdated`. */
  explanationsOutdated: number;
  /** Explications `outdated` revenues à `current`. */
  explanationsRestored: number;
}

export interface RefreshResult {
  fields: Pick<Analysis, "baseCommit" | "headCommit" | "snapshotAt" | "files" | "findings" | "explanations">;
  stats: RefreshStats;
}

function hunksEqual(a: Hunk[], b: Hunk[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((hunk, index) => {
    const other = b[index];
    if (
      hunk.header !== other.header ||
      hunk.oldStart !== other.oldStart ||
      hunk.oldLines !== other.oldLines ||
      hunk.newStart !== other.newStart ||
      hunk.newLines !== other.newLines ||
      hunk.lines.length !== other.lines.length
    ) {
      return false;
    }
    return hunk.lines.every((line, i) => {
      const o = other.lines[i];
      return line.type === o.type && line.oldNo === o.oldNo && line.newNo === o.newNo && line.text === o.text;
    });
  });
}

/**
 * Vrai quand le diff d'un fichier est identique d'un snapshot à l'autre. Un
 * fichier binaire n'a pas de hunks comparables : son diff est toujours tenu
 * pour changé.
 */
function sameFileDiff(oldEntry: FileEntry, oldDiff: FileDiff | undefined, newEntry: FileEntry, newDiff: FileDiff): boolean {
  if (!oldDiff || oldEntry.binary || newEntry.binary) return false;
  return oldEntry.status === newEntry.status && oldEntry.oldPath === newEntry.oldPath && hunksEqual(oldDiff.hunks, newDiff.hunks);
}

/** Texte actuel des lignes visées par un constat, ou null si elles ne sont plus lisibles. */
function currentText(finding: Finding, diffs: Map<string, FileDiff>): string | null {
  const location = finding.location;
  if (!location) return null;
  const content = diffs.get(location.path)?.newContent;
  if (content === null || content === undefined) return null;
  const lines = splitLines(content);
  if (location.startLine < 1 || location.endLine > lines.length || location.startLine > location.endLine) return null;
  return lines.slice(location.startLine - 1, location.endLine).join("\n");
}

/**
 * Calcule les champs d'une analyse après recalcul de son snapshot :
 * - `reviewed` n'est conservé que pour les fichiers dont le diff est inchangé ;
 * - un constat `open` dont les lignes ne correspondent plus à `anchorText`, ou dont le
 *   fichier a quitté le diff, passe à `outdated` ;
 * - un constat `outdated` dont les lignes correspondent de nouveau revient à `open` ;
 * - un constat `ignored` reste `ignored`, un constat sans emplacement ne change pas ;
 * - une explication dont les lignes ne correspondent plus à `anchorText` passe à
 *   `outdated`, et revient à `current` quand elles correspondent de nouveau.
 */
export function applyRefresh(analysis: Analysis, oldSnapshot: DiffSnapshot, next: ComputedSnapshot): RefreshResult {
  if (next.repoPath !== analysis.repoPath || next.mode !== analysis.mode || next.base !== analysis.base || next.head !== analysis.head) {
    throw new AnalysisError(
      `The new snapshot does not match analysis "${analysis.id}": compute it with the repository, mode and refs of the analysis.`
    );
  }

  const oldEntries = new Map(analysis.files.map((file) => [file.path, file]));
  const oldDiffs = new Map(oldSnapshot.files.map((file) => [file.path, file]));
  const newDiffs = new Map(next.diff.map((file) => [file.path, file]));

  const stats: RefreshStats = {
    fileCount: next.files.length,
    filesAdded: 0,
    filesRemoved: 0,
    reviewedKept: 0,
    reviewedReset: 0,
    findingsOutdated: 0,
    findingsRestored: 0,
    explanationsOutdated: 0,
    explanationsRestored: 0,
  };

  const files = next.files.map((entry): FileEntry => {
    const previous = oldEntries.get(entry.path);
    if (!previous) {
      stats.filesAdded++;
      return { ...entry, reviewed: false };
    }
    if (!previous.reviewed) return { ...entry, reviewed: false };
    const newDiff = newDiffs.get(entry.path);
    if (!newDiff) throw new AnalysisError(`The new snapshot has no diff for "${entry.path}".`);
    if (sameFileDiff(previous, oldDiffs.get(entry.path), entry, newDiff)) {
      stats.reviewedKept++;
      return { ...entry, reviewed: true };
    }
    stats.reviewedReset++;
    return { ...entry, reviewed: false };
  });
  const newPaths = new Set(next.files.map((file) => file.path));
  stats.filesRemoved = analysis.files.filter((file) => !newPaths.has(file.path)).length;

  const findings = analysis.findings.map((finding): Finding => {
    if (finding.location === null || finding.status === "ignored") return finding;
    const matches = currentText(finding, newDiffs) === finding.anchorText;
    if (finding.status === "open" && !matches) {
      stats.findingsOutdated++;
      return { ...finding, status: "outdated" };
    }
    if (finding.status === "outdated" && matches) {
      stats.findingsRestored++;
      return { ...finding, status: "open" };
    }
    return finding;
  });

  const explanations = analysis.explanations.map((explanation): Explanation => {
    const matches = explanationText(newDiffs.get(explanation.location.path), explanation.location) === explanation.anchorText;
    if (explanation.status === "current" && !matches) {
      stats.explanationsOutdated++;
      return { ...explanation, status: "outdated" };
    }
    if (explanation.status === "outdated" && matches) {
      stats.explanationsRestored++;
      return { ...explanation, status: "current" };
    }
    return explanation;
  });

  return {
    fields: {
      baseCommit: next.baseCommit,
      headCommit: next.headCommit,
      snapshotAt: next.snapshotAt,
      files,
      findings,
      explanations,
    },
    stats,
  };
}
