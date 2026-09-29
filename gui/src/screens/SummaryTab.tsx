import type { Analysis } from '@shared/schemas/analysis.schema'
import { SEVERITIES } from '@shared/schemas/analysis.schema'
import { SEVERITY_STYLES } from '@shared/labels'
import { buildAllOpenFindingsPrompt } from '@shared/prompt'
import { sortBySeverity } from '@shared/severity'
import { Icon } from '../components/Icon'
import { useAnalysisStore } from '../store/useAnalysisStore'
import { severityCount } from '../utils/format'
import { hrefs } from '../utils/router'
import { FindingRow } from './FindingRow'

/** Nombre de constats ouverts listés sur le Résumé. */
const TOP_FINDINGS = 5

/**
 * Onglet Résumé : vue d'ensemble de la feature, ce que l'agent a fait, la
 * demande initiale et les principaux constats ouverts.
 */
export function SummaryTab({ analysis }: { analysis: Analysis }) {
  const copy = useAnalysisStore((state) => state.copy)
  const open = sortBySeverity(analysis.findings.filter((finding) => finding.status === 'open'))
  const counts = SEVERITIES.map((severity) => ({ severity, count: open.filter((finding) => finding.severity === severity).length }))

  return (
    <>
      {analysis.overview && (
        <section className="card overview-card">
          <h2 className="card-title">
            <Icon name="focus" color="#8b97ff" />
            Vue d'ensemble
          </h2>
          <h3 className="overview-label">Objectif</h3>
          <p className="overview-text">{analysis.overview.objective}</p>
          <h3 className="overview-label">Approche</h3>
          <p className="overview-text">{analysis.overview.approach}</p>
          {analysis.overview.attentionPoints.length > 0 && (
            <>
              <h3 className="overview-label">Points d'attention</h3>
              <ul className="summary-list overview-points">
                {analysis.overview.attentionPoints.map((point, index) => (
                  <li key={index}>{point}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section className="card summary-card">
        <h2 className="card-title">
          <Icon name="sparkles" color="#b18cff" />
          Ce que l'agent a fait
        </h2>
        {analysis.summary.length > 0 ? (
          <ul className="summary-list">
            {analysis.summary.map((bullet, index) => (
              <li key={index}>{bullet}</li>
            ))}
          </ul>
        ) : (
          <p className="empty-text">L'agent n'a pas encore rédigé de résumé (outil update_analysis).</p>
        )}
      </section>

      {analysis.request && (
        <section className="card request-card">
          <h2 className="card-title">
            <Icon name="message-square" color="#9aa1b1" />
            Demande initiale
            {analysis.request.source && <span className="request-source mono">{analysis.request.source}</span>}
          </h2>
          <p className="request-text">{analysis.request.text}</p>
        </section>
      )}

      <div className="section-head">
        <h2 className="section-title">Constats</h2>
        <div className="pill-row">
          {counts
            .filter(({ count }) => count > 0)
            .map(({ severity, count }) => (
              <span
                key={severity}
                className="pill"
                style={{ color: SEVERITY_STYLES[severity].color, background: SEVERITY_STYLES[severity].background }}
              >
                {severityCount(severity, count)}
              </span>
            ))}
        </div>
        <span className="spacer" />
        <button
          type="button"
          className="button button-secondary button-medium"
          disabled={open.length === 0}
          title={open.length === 0 ? 'Aucun constat ouvert à transmettre.' : 'Tous les constats ouverts, du plus grave au moins grave.'}
          onClick={() => void copy(buildAllOpenFindingsPrompt(analysis), 'Prompt des constats ouverts copié dans le presse-papiers.')}
        >
          <Icon name="bot" color="#b18cff" />
          Copier le prompt pour l'agent
        </button>
      </div>

      <section className="card list-card">
        {open.length === 0 ? (
          <p className="list-empty">
            {analysis.findings.length === 0 ? "L'agent n'a relevé aucun constat." : 'Aucun constat ouvert : tous sont ignorés ou obsolètes.'}
          </p>
        ) : (
          open.slice(0, TOP_FINDINGS).map((finding) => <FindingRow key={finding.id} analysis={analysis} finding={finding} />)
        )}
        {analysis.findings.length > 0 && (
          <a className="list-footer-link" href={hrefs.feature(analysis.id, 'findings')}>
            Voir les {analysis.findings.length} constats
          </a>
        )}
      </section>
    </>
  )
}
