import type { Analysis, Finding } from '@shared/schemas/analysis.schema'
import { buildAgentPrompt } from '@shared/prompt'
import { splitLines } from '@shared/text'
import { useAnalysisStore } from '../store/useAnalysisStore'
import { linesLabel } from '../utils/format'
import { Icon } from './Icon'
import { KindTag, SeverityPill, StatusTag } from './Pills'

/** Correctif proposé : lignes visées retirées, lignes proposées ajoutées. */
export function SuggestedFix({ anchorText, suggestion }: { anchorText: string; suggestion: string }) {
  const removed = splitLines(anchorText)
  const added = splitLines(suggestion)
  return (
    <div className="fix">
      {removed.map((line, index) => (
        <div key={`del-${index}`} className="fix-line is-del">
          <span className="fix-marker">−</span>
          <span className="fix-code">{line}</span>
        </div>
      ))}
      {added.map((line, index) => (
        <div key={`add-${index}`} className="fix-line is-add">
          <span className="fix-marker">+</span>
          <span className="fix-code">{line}</span>
        </div>
      ))}
      {added.length === 0 && <div className="fix-empty">Les lignes visées sont supprimées.</div>}
    </div>
  )
}

interface FindingCardProps {
  analysis: Analysis
  finding: Finding
  /** Ouvre la saisie d'une remarque ; absent quand aucune remarque ne peut viser ces lignes. */
  onAddNote?: () => void
}

/** Constat détaillé : gravité, texte, correctif proposé et actions du relecteur. */
export function FindingCard({ analysis, finding, onAddNote }: FindingCardProps) {
  const setFindingStatus = useAnalysisStore((state) => state.setFindingStatus)
  const copy = useAnalysisStore((state) => state.copy)
  const saving = useAnalysisStore((state) => state.saving)
  const location = finding.location

  const copyPrompt = () =>
    void copy(
      buildAgentPrompt(analysis, { findingIds: [finding.id], noteIds: [], decision: null }),
      'Prompt du constat copié dans le presse-papiers.',
    )

  return (
    <article className={`finding-card is-${finding.status}`} id={`finding-${finding.id}`}>
      <header className="finding-head">
        <SeverityPill severity={finding.severity} />
        <h3 className="finding-title">{finding.title}</h3>
        <KindTag kind={finding.kind} />
        <StatusTag status={finding.status} />
        {location && <span className="finding-lines mono">{linesLabel(location.startLine, location.endLine)}</span>}
      </header>
      {finding.body.trim() !== '' && <p className="finding-body">{finding.body}</p>}
      {finding.status === 'outdated' && (
        <p className="finding-outdated">
          Les lignes visées ont changé depuis la rédaction de ce constat : l'agent doit le réancrer avec update_finding.
        </p>
      )}
      {finding.suggestion !== null && finding.anchorText !== null && (
        <>
          <div className="finding-section-title">Correctif proposé</div>
          <SuggestedFix anchorText={finding.anchorText} suggestion={finding.suggestion} />
        </>
      )}
      <footer className="finding-actions">
        <button type="button" className="button button-secondary" onClick={copyPrompt}>
          <Icon name="bot" color="#b18cff" />
          Copier le prompt pour l'agent
        </button>
        {finding.status === 'open' && (
          <button type="button" className="link-button muted" disabled={saving} onClick={() => void setFindingStatus(finding.id, 'ignored')}>
            Ignorer
          </button>
        )}
        {finding.status === 'ignored' && (
          <button type="button" className="link-button muted" disabled={saving} onClick={() => void setFindingStatus(finding.id, 'open')}>
            Rouvrir
          </button>
        )}
        <span className="spacer" />
        {onAddNote && (
          <button type="button" className="link-button accent" onClick={onAddNote}>
            Ajouter une remarque
          </button>
        )}
      </footer>
    </article>
  )
}
