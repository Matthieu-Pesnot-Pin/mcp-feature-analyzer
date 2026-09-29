import {
  SEVERITIES,
  type Analysis,
  type FileEntry,
  type FileStatus,
  type Finding,
  type Severity,
} from "../../shared/schemas/analysis.schema.js";
import { compareSeverity } from "../../shared/severity.js";

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
  const lines = location.startLine === location.endLine ? `${location.startLine}` : `${location.startLine}-${location.endLine}`;
  return `${location.path}:${lines}`;
}

/** Ligne d'un constat : id, gravité, nature, statut, emplacement, titre. */
export function findingLine(finding: Finding): string {
  return `${finding.id} [${finding.severity}] ${finding.kind}, ${finding.status} — ${locationLabel(finding)} — ${finding.title}`;
}

/** Constats triés du plus grave au moins grave, dans l'ordre de l'analyse à gravité égale. */
export function sortBySeverity(findings: Finding[]): Finding[] {
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => compareSeverity(a.finding.severity, b.finding.severity) || a.index - b.index)
    .map((entry) => entry.finding);
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
