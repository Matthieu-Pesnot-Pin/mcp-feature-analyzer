import type { AnalysisSummary, ReviewProgressState } from '@shared/schemas/analysis.schema'
import { REVIEW_PROGRESS_STATES, SEVERITIES } from '@shared/schemas/analysis.schema'

/** Filtre de l'accueil : analyses dont la revue n'est pas soumise, ou toutes. */
export type HomeFilter = 'to_review' | 'all'

/** Analyses d'un projet, avec le nombre d'analyses de chaque état de revue présent. */
export interface ProjectGroup {
  project: string
  analyses: AnalysisSummary[]
  counts: Array<{ state: ReviewProgressState; count: number }>
}

/** Vrai quand la revue de l'analyse n'est pas encore soumise. */
export function isToReview(analysis: AnalysisSummary): boolean {
  return analysis.progress.state !== 'submitted'
}

/** Analyses retenues par le filtre, dans l'ordre de la liste. */
export function applyHomeFilter(analyses: AnalysisSummary[], filter: HomeFilter): AnalysisSummary[] {
  return filter === 'all' ? analyses : analyses.filter(isToReview)
}

/**
 * Regroupe les analyses par projet. Les projets suivent l'ordre de leur
 * première analyse dans la liste, et chaque projet garde l'ordre de ses analyses.
 */
export function groupByProject(analyses: AnalysisSummary[]): ProjectGroup[] {
  const groups = new Map<string, AnalysisSummary[]>()
  for (const analysis of analyses) {
    const list = groups.get(analysis.project)
    if (list) list.push(analysis)
    else groups.set(analysis.project, [analysis])
  }
  return [...groups].map(([project, list]) => ({
    project,
    analyses: list,
    counts: REVIEW_PROGRESS_STATES.map((state) => ({
      state,
      count: list.filter((analysis) => analysis.progress.state === state).length,
    })).filter(({ count }) => count > 0),
  }))
}

/** Constats ouverts de l'analyse par gravité, de la plus grave à la moins grave, sans les gravités absentes. */
export function openSeverityCounts(analysis: AnalysisSummary) {
  return SEVERITIES.map((severity) => ({ severity, count: analysis.openFindings[severity] })).filter(({ count }) => count > 0)
}

/** Part des fichiers revus, en pourcentage ; 0 pour une analyse sans fichier. */
export function reviewedPercent(analysis: AnalysisSummary): number {
  const { reviewedFiles, totalFiles } = analysis.progress
  return totalFiles === 0 ? 0 : (reviewedFiles / totalFiles) * 100
}
