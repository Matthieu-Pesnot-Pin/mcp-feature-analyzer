import type { CSSProperties } from 'react'
import type { Analysis } from '@shared/schemas/analysis.schema'
import { SEVERITY_STYLES } from '@shared/labels'
import { buildAgentPrompt } from '@shared/prompt'
import { lineRange } from '@shared/text'
import { useAnalysisStore } from '../store/useAnalysisStore'
import type { FixDisplay, NumberedFinding } from '../screens/review-diff-model'
import { SuggestedFix } from './FindingCard'
import { Icon } from './Icon'
import { KindTag, StatusTag } from './Pills'

/** Numéro d'un constat dans le fichier, dans un rond aux couleurs de sa gravité. */
export function FindingNumber({ entry, small }: { entry: NumberedFinding; small?: boolean }) {
  const style = SEVERITY_STYLES[entry.finding.severity]
  return (
    <span
      className={`finding-number${small ? ' is-small' : ''}`}
      style={{ color: style.color, background: style.background, borderColor: style.color }}
      aria-label={`Constat ${entry.number}`}
    >
      {entry.number}
    </span>
  )
}

interface MarginFindingCardProps {
  analysis: Analysis
  entry: NumberedFinding
  fix: FixDisplay
  onToggleFix: (shown: boolean) => void
  /** Ouvre la saisie d'une remarque ; absent quand aucune remarque ne peut viser ces lignes. */
  onAddNote?: () => void
}

/**
 * Carte d'un constat dans la colonne des constats : numéro, gravité, lignes,
 * titre, explication, interrupteur du correctif dans le code et actions.
 */
export function MarginFindingCard({ analysis, entry, fix, onToggleFix, onAddNote }: MarginFindingCardProps) {
  const setFindingStatus = useAnalysisStore((state) => state.setFindingStatus)
  const copy = useAnalysisStore((state) => state.copy)
  const saving = useAnalysisStore((state) => state.saving)
  const { finding } = entry
  const severity = SEVERITY_STYLES[finding.severity]
  const shown = fix.state === 'shown'

  const copyPrompt = () =>
    void copy(
      buildAgentPrompt(analysis, { findingIds: [finding.id], noteIds: [], decision: null }),
      'Prompt du constat copié dans le presse-papiers.',
    )

  return (
    <article
      className={`margin-card is-${finding.status}${shown ? ' is-fix-shown' : ''}`}
      id={`finding-${finding.id}`}
      style={{ '--severity': severity.color } as CSSProperties}
    >
      <header className="margin-card-head">
        <FindingNumber entry={entry} />
        <span className="pill pill-small margin-card-severity" style={{ color: severity.color, background: severity.background }}>
          {severity.label}
        </span>
        <KindTag kind={finding.kind} />
        <StatusTag status={finding.status} />
        <span className="margin-card-lines mono">l. {lineRange(entry.startLine, entry.endLine, '–')}</span>
      </header>
      <h3 className="margin-card-title">{finding.title}</h3>
      {finding.body.trim() !== '' && <p className="margin-card-body">{finding.body}</p>}
      {finding.status === 'outdated' && (
        <p className="finding-outdated">
          Les lignes visées ont changé depuis la rédaction de ce constat : l'agent doit le réancrer avec update_finding.
        </p>
      )}

      {(fix.state === 'shown' || fix.state === 'hidden' || fix.state === 'blocked') && (
        <label className={`fix-toggle${shown ? ' is-on' : ''}${fix.state === 'blocked' ? ' is-disabled' : ''}`}>
          <input
            type="checkbox"
            className="visually-hidden"
            checked={shown}
            disabled={fix.state === 'blocked'}
            onChange={(event) => onToggleFix(event.target.checked)}
          />
          <span className="switch" aria-hidden="true" />
          {shown ? 'Correctif affiché dans le code' : 'Afficher le correctif dans le code'}
        </label>
      )}
      {fix.state === 'blocked' && (
        <p className="margin-card-hint">
          Ses lignes recouvrent le correctif du constat {fix.blockedBy} : masquez-le pour afficher celui-ci dans le code.
        </p>
      )}
      {fix.state === 'outside' && finding.suggestion !== null && finding.anchorText !== null && (
        <>
          <p className="margin-card-hint">Les lignes visées ne sont pas toutes affichées dans le diff : voici le correctif proposé.</p>
          <SuggestedFix anchorText={finding.anchorText} suggestion={finding.suggestion} />
        </>
      )}

      <footer className="margin-card-actions">
        <button type="button" className="margin-button" onClick={copyPrompt}>
          <Icon name="bot" color="#b18cff" />
          Copier le prompt
        </button>
        {finding.status === 'open' && (
          <button type="button" className="margin-button" disabled={saving} onClick={() => void setFindingStatus(finding.id, 'ignored')}>
            <Icon name="eye-off" color="#9aa1b1" />
            Ignorer
          </button>
        )}
        {finding.status === 'ignored' && (
          <button type="button" className="margin-button" disabled={saving} onClick={() => void setFindingStatus(finding.id, 'open')}>
            <Icon name="rotate-ccw" color="#9aa1b1" />
            Rouvrir
          </button>
        )}
        {onAddNote && (
          <button type="button" className="margin-button" onClick={onAddNote}>
            <Icon name="message-square" color="#9aa1b1" />
            Remarque
          </button>
        )}
      </footer>
    </article>
  )
}
