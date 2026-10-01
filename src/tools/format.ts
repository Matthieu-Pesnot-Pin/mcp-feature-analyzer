import {
  SEVERITIES,
  type Analysis,
  type Explanation,
  type FileEntry,
  type FileStatus,
  type Finding,
  type Note,
  type Overview,
  type ReviewProgress,
  type ReviewProgressState,
  type Severity,
} from "../../shared/schemas/analysis.schema.js";
import { lineRange, noteLocationText } from "../../shared/text.js";

/** Lettre de statut d'un fichier, à la manière de `git status --short`. */
const FILE_STATUS_LETTERS: Record<FileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
};

/** Sha abrégé à 7 caractères. */
export function shortSha(sha: string | null): string {
  return sha === null ? "-" : sha.slice(0, 7);
}

/** Refs d'une analyse : `branch master...HEAD` ou `working_tree (changes against HEAD)`. */
export function refsLabel(analysis: Pick<Analysis, "mode" | "base" | "head">): string {
  if (analysis.mode === "branch") return `branch ${analysis.base}...${analysis.head}`;
  return "working_tree (uncommitted changes against HEAD)";
}

/** Refs et commits figés d'une analyse. */
export function snapshotLabel(analysis: Analysis): string {
  const commits =
    analysis.mode === "branch"
      ? `base ${shortSha(analysis.baseCommit)}, head ${shortSha(analysis.headCommit)}`
      : `HEAD ${shortSha(analysis.baseCommit)}`;
  return `${refsLabel(analysis)} (${commits}, snapshot at ${analysis.snapshotAt})`;
}

/** Ligne d'un fichier modifié : statut, chemin (ancien chemin si renommé), +/-. */
export function fileLine(file: FileEntry): string {
  const name = file.oldPath === null ? file.path : `${file.oldPath} -> ${file.path}`;
  const counts = file.binary ? "binary" : `+${file.additions} -${file.deletions}`;
  const extra = !file.binary && !file.contentAvailable && file.status !== "deleted" ? ", content too large to anchor findings" : "";
  return `${FILE_STATUS_LETTERS[file.status]} ${name}  ${counts}${extra}`;
}

/** Totaux +/- des fichiers. */
export function fileTotals(files: FileEntry[]): string {
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return `${files.length} file(s), +${additions} -${deletions}`;
}

/** `path:12` ou `path:12-14`, ou `no location`. */
export function locationLabel(finding: Pick<Finding, "location">): string {
  const location = finding.location;
  if (location === null) return "no location";
  return `${location.path}:${lineRange(location.startLine, location.endLine)}`;
}

/** `path`, `path:12`, ou `whole analysis` pour une remarque sans emplacement. */
export function noteLocationLabel(note: Pick<Note, "location">): string {
  return note.location ? noteLocationText(note.location) : "whole analysis";
}

/** Ligne d'un constat : id, gravité, nature, statut, emplacement, titre. */
export function findingLine(finding: Finding): string {
  return `${finding.id} [${finding.severity}] ${finding.kind}, ${finding.status} — ${locationLabel(finding)} — ${finding.title}`;
}

/** Ligne d'une explication : id, statut, emplacement avec son côté, titre. */
export function explanationLine(explanation: Explanation): string {
  const { path, side, startLine, endLine } = explanation.location;
  return `${explanation.id} ${explanation.status} — ${path}:${lineRange(startLine, endLine)} (${side} side) — ${explanation.title}`;
}

/** `1 critical, 2 major` ; `none` quand tous les compteurs sont à zéro. */
export function severityCountsLabel(counts: Record<Severity, number>): string {
  const parts = SEVERITIES.filter((severity) => counts[severity] > 0).map((severity) => `${counts[severity]} ${severity}`);
  return parts.length === 0 ? "none" : parts.join(", ");
}

/** Préfixe chaque ligne non vide de `indent`. */
export function indentBlock(text: string, indent: string): string {
  return text
    .split("\n")
    .map((line) => (line === "" ? "" : `${indent}${line}`))
    .join("\n");
}

const REVIEW_PROGRESS_TEXT: Record<ReviewProgressState, string> = {
  not_started: "not started",
  in_progress: "in progress",
  files_reviewed: "all files reviewed, not submitted",
  submitted: "submitted",
};

/** Nom anglais d'un état de revue : `not started`, `in progress`… */
export function progressStateLabel(state: ReviewProgressState): string {
  return REVIEW_PROGRESS_TEXT[state];
}

/** `in progress (2/7 files reviewed)` ou `submitted, decision approve (7/7 files reviewed)`. */
export function progressLabel(progress: ReviewProgress): string {
  const decision = progress.state === "submitted" ? `, decision ${progress.decision}` : "";
  return `${REVIEW_PROGRESS_TEXT[progress.state]}${decision} (${progress.reviewedFiles}/${progress.totalFiles} files reviewed)`;
}

/** Bloc « Overview » : objectif, approche et points d'attention ; une ligne d'invitation quand il n'y en a pas. */
export function overviewLines(overview: Overview | null): string[] {
  if (overview === null) return ["Overview: none yet (write objective and approach with update_analysis)."];
  const lines = ["Overview:", `  Objective: ${indentBlock(overview.objective, "    ").trimStart()}`, `  Approach: ${indentBlock(overview.approach, "    ").trimStart()}`];
  if (overview.attentionPoints.length === 0) lines.push("  Attention points: none");
  else lines.push("  Attention points:", ...overview.attentionPoints.map((point) => `  - ${point}`));
  return lines;
}
