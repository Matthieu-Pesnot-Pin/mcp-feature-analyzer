import type { AnalysisSummary, ReviewProgressState } from '@shared/schemas/analysis.schema'
import { REVIEW_PROGRESS_STATES, SEVERITIES } from '@shared/schemas/analysis.schema'

/**
 * Filtre de l'accueil. Les quatre premiers ne se recouvrent pas, et laissent de
 * côté les analyses qui ont une revue de suivi, visibles dans `all` seulement :
 * - `to_review` : revue pas encore soumise ;
 * - `to_process` : revue soumise qui attend l'agent ;
 * - `processed` : revue soumise marquée traitée ;
 * - `approved` : revue approuvée, sans traitement marqué ;
 * - `all` : toutes les analyses.
 */
export type HomeFilter = 'to_review' | 'processed' | 'to_process' | 'approved' | 'all'

export const HOME_FILTERS: readonly HomeFilter[] = ['to_review', 'to_process', 'processed', 'approved', 'all']

/** Analyses d'un projet, avec le nombre d'analyses de chaque état de revue présent. */
export interface ProjectGroup {
  project: string
  analyses: AnalysisSummary[]
  counts: Array<{ state: ReviewProgressState; count: number }>
}

/** Vrai quand l'analyse fait partie des analyses retenues par `filter`. */
export function matchesHomeFilter(analysis: AnalysisSummary, filter: HomeFilter): boolean {
  const { state, decision, processed, toProcess } = analysis.progress
  if (filter !== 'all' && analysis.followedBy !== null) return false
  switch (filter) {
    case 'to_review':
      return state !== 'submitted'
    case 'processed':
      return state === 'submitted' && processed !== null
    case 'to_process':
      return toProcess
    case 'approved':
      return state === 'submitted' && decision === 'approve' && processed === null
    case 'all':
      return true
  }
}

/** Analyses retenues par le filtre, dans l'ordre de la liste. */
export function applyHomeFilter(analyses: AnalysisSummary[], filter: HomeFilter): AnalysisSummary[] {
  return analyses.filter((analysis) => matchesHomeFilter(analysis, filter))
}

/** Nombre d'analyses retenues par chaque filtre. */
export function homeFilterCounts(analyses: AnalysisSummary[]): Record<HomeFilter, number> {
  return Object.fromEntries(HOME_FILTERS.map((filter) => [filter, applyHomeFilter(analyses, filter).length])) as Record<
    HomeFilter,
    number
  >
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
