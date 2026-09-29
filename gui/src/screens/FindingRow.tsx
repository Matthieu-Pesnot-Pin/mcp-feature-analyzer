import type { Analysis, Finding } from '@shared/schemas/analysis.schema'
import { Icon } from '../components/Icon'
import { KindTag, SeverityPill, StatusTag } from '../components/Pills'
import { findingLocationLabel } from '../utils/format'
import { findingHref } from './review-model'

/** Ligne de liste d'un constat : gravité, titre, emplacement ; mène à la revue. */
export function FindingRow({ analysis, finding }: { analysis: Analysis; finding: Finding }) {
  return (
    <a className={`finding-row is-${finding.status}`} href={findingHref(analysis, finding)}>
      <SeverityPill severity={finding.severity} />
      <span className="finding-row-text">
        <span className="finding-row-title">
          {finding.title}
          <KindTag kind={finding.kind} />
          <StatusTag status={finding.status} />
        </span>
        <span className="finding-row-location mono">{findingLocationLabel(finding, analysis.request)}</span>
      </span>
      <Icon name="chevron-right" color="#646b7b" />
    </a>
  )
}
