import { useState } from 'react'
import type { Analysis, FindingStatus, Severity } from '@shared/schemas/analysis.schema'
import { FINDING_STATUSES, SEVERITIES } from '@shared/schemas/analysis.schema'
import { FINDING_STATUS_LABELS, SEVERITY_STYLES } from '@shared/labels'
import { sortBySeverity } from '@shared/severity'
import { FindingRow } from './FindingRow'

function toggle<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

/** Onglet Constats : liste complète, filtrable par gravité et par statut. */
export function FindingsTab({ analysis }: { analysis: Analysis }) {
  const [severities, setSeverities] = useState<ReadonlySet<Severity>>(new Set(SEVERITIES))
  const [statuses, setStatuses] = useState<ReadonlySet<FindingStatus>>(new Set(FINDING_STATUSES))

  const visible = sortBySeverity(analysis.findings).filter((finding) => severities.has(finding.severity) && statuses.has(finding.status))

  return (
    <>
      <div className="filters">
        <div className="filter-group" role="group" aria-label="Filtrer par gravité">
          <span className="filter-label">Gravité</span>
          {SEVERITIES.map((severity) => {
            const count = analysis.findings.filter((finding) => finding.severity === severity).length
            const active = severities.has(severity)
            return (
              <button
                type="button"
                key={severity}
                aria-pressed={active}
                className={`chip${active ? ' is-active' : ''}`}
                style={active ? { color: SEVERITY_STYLES[severity].color, background: SEVERITY_STYLES[severity].background } : undefined}
                onClick={() => setSeverities(toggle(severities, severity))}
              >
                {SEVERITY_STYLES[severity].label} <span className="chip-count">{count}</span>
              </button>
            )
          })}
        </div>
        <div className="filter-group" role="group" aria-label="Filtrer par statut">
          <span className="filter-label">Statut</span>
          {FINDING_STATUSES.map((status) => {
            const count = analysis.findings.filter((finding) => finding.status === status).length
            const active = statuses.has(status)
            return (
              <button
                type="button"
                key={status}
                aria-pressed={active}
                className={`chip${active ? ' is-active is-neutral' : ''}`}
                onClick={() => setStatuses(toggle(statuses, status))}
              >
                {FINDING_STATUS_LABELS[status]} <span className="chip-count">{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      <section className="card list-card">
        {visible.length === 0 ? (
          <p className="list-empty">
            {analysis.findings.length === 0 ? "L'agent n'a relevé aucun constat." : 'Aucun constat ne correspond aux filtres.'}
          </p>
        ) : (
          visible.map((finding) => <FindingRow key={finding.id} analysis={analysis} finding={finding} />)
        )}
      </section>
    </>
  )
}
