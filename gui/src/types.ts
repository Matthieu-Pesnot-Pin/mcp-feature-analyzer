import type { Analysis, AnalysisSummary } from '@shared/schemas/analysis.schema'

/** Réponse de `GET /api/config`. */
export interface AppConfig {
  dataDir: string
  version: string
}

/** Réponse de `GET /api/analyses`. */
export interface AnalysisListing {
  analyses: AnalysisSummary[]
  unreadable: Array<{ id: string; error: string }>
}

/** Réponse des routes qui renvoient une analyse, dont toutes les modifications. */
export interface AnalysisResponse {
  analysis: Analysis
}
