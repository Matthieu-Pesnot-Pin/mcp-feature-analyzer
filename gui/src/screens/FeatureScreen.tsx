import type { Analysis } from '@shared/schemas/analysis.schema'
import { MODE_LABELS } from '@shared/labels'
import { diffTotals, headLabel, plural, refLabel, relativeTime } from '../utils/format'
import { FEATURE_TABS, hrefs, navigate, type FeatureTab } from '../utils/router'
import { FilesTab } from './FilesTab'
import { DiagramsTab } from './DiagramsTab'
import { FindingsTab } from './FindingsTab'
import { SummaryTab } from './SummaryTab'
import { firstFileToReview } from './review-model'

const TAB_LABELS: Record<FeatureTab, string> = {
  summary: 'Résumé',
  files: 'Fichiers',
  findings: 'Constats',
  diagrams: 'Schémas',
}

/** Compteur affiché à côté du nom d'un onglet ; null pour aucun. */
function tabCount(analysis: Analysis, tab: FeatureTab): number | null {
  if (tab === 'files') return analysis.files.length
  if (tab === 'findings') return analysis.findings.length
  if (tab === 'diagrams') return analysis.diagrams.length
  return null
}

/** Mode et refs de l'analyse : « Branche feat/x vers master », « Copie de travail vs HEAD ». */
function refsDescription(analysis: Analysis): string {
  if (analysis.mode === 'branch') return `${MODE_LABELS.branch} ${headLabel(analysis)} vers ${refLabel(analysis.base)}`
  return `${MODE_LABELS.working_tree} vs HEAD`
}

/** Écran Feature : en-tête de l'analyse, onglets et contenu de l'onglet `tab`. */
export function FeatureScreen({ analysis, tab }: { analysis: Analysis; tab: FeatureTab }) {
  const totals = diffTotals(analysis)
  const startPath = firstFileToReview(analysis)

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{analysis.title}</h1>
          <p className="page-meta">
            <span>
              {refsDescription(analysis)} · produite {relativeTime(analysis.snapshotAt)} · {plural(analysis.files.length, 'fichier')}
            </span>
            <span className="count-add mono">+{totals.additions}</span>
            <span className="count-del mono">−{totals.deletions}</span>
          </p>
        </div>
        <button
          type="button"
          className="button button-primary button-large"
          disabled={startPath === null}
          title={startPath === null ? "L'analyse ne contient aucun fichier modifié." : undefined}
          onClick={() => startPath && navigate(hrefs.review(analysis.id, startPath))}
        >
          Commencer la revue
        </button>
      </div>

      <nav className="tabs" aria-label="Sections de l'analyse">
        {FEATURE_TABS.map((entry) => {
          const count = tabCount(analysis, entry)
          return (
            <a key={entry} href={hrefs.feature(analysis.id, entry)} className={`tab${entry === tab ? ' is-active' : ''}`}>
              {TAB_LABELS[entry]}
              {count !== null && <span className="tab-count">{count}</span>}
            </a>
          )
        })}
      </nav>

      <div className="tab-panel">
        {tab === 'summary' && <SummaryTab analysis={analysis} />}
        {tab === 'files' && <FilesTab analysis={analysis} />}
        {tab === 'findings' && <FindingsTab analysis={analysis} />}
        {tab === 'diagrams' && <DiagramsTab analysis={analysis} />}
      </div>
    </div>
  )
}
