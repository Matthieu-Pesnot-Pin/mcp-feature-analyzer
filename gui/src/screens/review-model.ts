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
 * le premier fichier pour un constat sans emplacement (bandeau des exigences).
 */
export function findingHref(analysis: Analysis, finding: Finding): string {
  if (finding.location) return hrefs.review(analysis.id, finding.location.path, finding.location.endLine)
  return hrefs.review(analysis.id, analysis.files[0]?.path ?? null)
}

/** Constats ouverts d'un fichier par gravité, de la plus grave à la moins grave, sans les gravités absentes. */
export function openFindingCounts(analysis: Analysis, path: string): Array<{ severity: Severity; count: number }> {
  return SEVERITIES.map((severity) => ({
    severity,
    count: analysis.findings.filter(
      (finding) => finding.status === 'open' && finding.severity === severity && finding.location?.path === path,
    ).length,
  })).filter(({ count }) => count > 0)
}

/** Constats sans emplacement (exigences manquantes). */
export function unlocatedFindings(analysis: Analysis): Finding[] {
  return sortBySeverity(analysis.findings.filter((finding) => finding.location === null))
}
