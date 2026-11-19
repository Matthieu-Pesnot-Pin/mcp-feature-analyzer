import type { Analysis, FileEntry, FileLevel, Finding, Severity } from '@shared/schemas/analysis.schema'
import { FILE_LEVELS, SEVERITIES } from '@shared/schemas/analysis.schema'
import { effectiveLevel, filesInReviewOrder } from '@shared/file-levels'
import { sortBySeverity } from '@shared/severity'
import { hrefs } from '../utils/router'

/** Onglet de la liste des fichiers : un niveau de relecture, ou les fichiers non classés. */
export type LevelTab = FileLevel | 'unclassified'

/** Onglets dans l'ordre de relecture. */
export const LEVEL_TABS: readonly LevelTab[] = [...FILE_LEVELS, 'unclassified']

/** Onglet d'un fichier. */
export function tabOf(file: Pick<FileEntry, 'classification'>): LevelTab {
  return effectiveLevel(file) ?? 'unclassified'
}

/** Fichiers d'un onglet, dans l'ordre du diff. */
export function filesOfTab(analysis: Analysis, tab: LevelTab): FileEntry[] {
  return analysis.files.filter((file) => tabOf(file) === tab)
}

/** Premier fichier à revoir parmi `files`, ou le premier quand tous sont revus ; null sans fichier. */
function firstToReview(files: readonly FileEntry[]): string | null {
  return (files.find((file) => !file.reviewed) ?? files[0])?.path ?? null
}

/** Premier fichier à revoir dans l'ordre de relecture, ou le premier fichier quand tous sont revus ; null sans fichier. */
export function firstFileToReview(analysis: Analysis): string | null {
  return firstToReview(filesInReviewOrder(analysis.files))
}

/** Premier fichier à revoir d'un onglet, ou son premier fichier ; null pour un onglet vide. */
export function firstFileOfTab(analysis: Analysis, tab: LevelTab): string | null {
  return firstToReview(filesOfTab(analysis, tab))
}

/** Fichiers classés en survol qui portent un constat ouvert. */
export function skimmedWithFindings(analysis: Analysis): FileEntry[] {
  return analysis.files.filter(
    (file) =>
      effectiveLevel(file) === 'skim' &&
      analysis.findings.some((finding) => finding.status === 'open' && finding.location?.path === file.path),
  )
}

/**
 * Lien vers l'endroit de la revue où un constat s'affiche : sa ligne de fin, ou
 * le premier fichier pour un constat sans emplacement (bandeau des exigences,
 * présent sur chaque fichier).
 */
export function findingHref(analysis: Analysis, finding: Finding): string {
  if (finding.location) return hrefs.review(analysis.id, finding.location.path, finding.location.endLine)
  return hrefs.review(analysis.id, analysis.files[0]?.path ?? null)
}

/**
 * Constats ouverts d'un fichier par gravité, de la plus grave à la moins grave,
 * sans les gravités absentes ; `firstLine` est la première ligne du premier
 * constat ouvert de cette gravité dans le fichier.
 */
export function openFindingCounts(analysis: Analysis, path: string): Array<{ severity: Severity; count: number; firstLine: number }> {
  return SEVERITIES.flatMap((severity) => {
    const lines = analysis.findings.flatMap((finding) =>
      finding.status === 'open' && finding.severity === severity && finding.location?.path === path ? [finding.location.startLine] : [],
    )
    return lines.length === 0 ? [] : [{ severity, count: lines.length, firstLine: Math.min(...lines) }]
  })
}

/**
 * Remarques du relecteur sur un fichier, sur une de ses lignes ou sur le fichier
 * entier ; `firstLine` est la première ligne portant une remarque, null quand
 * toutes visent le fichier entier. Null sans remarque.
 */
export function fileNoteCount(analysis: Analysis, path: string): { count: number; firstLine: number | null } | null {
  const notes = analysis.notes.filter((note) => note.location?.path === path)
  if (notes.length === 0) return null
  const lines = notes.flatMap((note) => (note.location?.line != null ? [note.location.line] : []))
  return { count: notes.length, firstLine: lines.length === 0 ? null : Math.min(...lines) }
}

/** Constats sans emplacement (exigences manquantes), affichés en bandeau au-dessus du diff de chaque fichier. */
export function unlocatedFindings(analysis: Analysis): Finding[] {
  return sortBySeverity(analysis.findings.filter((finding) => finding.location === null))
}

/** Vrai quand le mode zen s'applique à l'écran Revue : demandé, et `path` désigne un fichier de l'analyse. */
export function zenApplies(zenMode: boolean, analysis: Analysis, path: string | null): boolean {
  return zenMode && analysis.files.some((file) => file.path === path)
}
