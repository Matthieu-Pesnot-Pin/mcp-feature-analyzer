import type { Analysis, Finding, Severity } from '@shared/schemas/analysis.schema'
import { SEVERITIES } from '@shared/schemas/analysis.schema'
import { sortBySeverity } from '@shared/severity'
import { hrefs } from '../utils/router'

/** Premier fichier à revoir, ou le premier fichier quand tous sont revus ; null sans fichier. */
export function firstFileToReview(analysis: Analysis): string | null {
  return (analysis.files.find((file) => !file.reviewed) ?? analysis.files[0])?.path ?? null
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

/** Constats sans emplacement (exigences manquantes), affichés en bandeau au-dessus du diff de chaque fichier. */
export function unlocatedFindings(analysis: Analysis): Finding[] {
  return sortBySeverity(analysis.findings.filter((finding) => finding.location === null))
}
