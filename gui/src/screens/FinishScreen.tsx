import { useState } from 'react'
import type { Analysis, Finding, Note, ReviewDecision } from '@shared/schemas/analysis.schema'
import { REVIEW_DECISIONS } from '@shared/schemas/analysis.schema'
import { DECISION_LABELS } from '@shared/labels'
import { buildAgentPrompt } from '@shared/prompt'
import { compareSeverity } from '@shared/severity'
import { Icon, type IconName } from '../components/Icon'
import { NotePill, SeverityPill } from '../components/Pills'
import { useAnalysisStore } from '../store/useAnalysisStore'
import { findingLocationLabel, formatDateTime, noteLocationLabel, plural } from '../utils/format'
import { hrefs, navigate } from '../utils/router'
import { firstFileToReview } from './review-model'

const DECISIONS: Record<ReviewDecision, { icon: IconName; color: string; description: string }> = {
  approve: { icon: 'circle-check', color: '#3fb950', description: 'La feature peut être fusionnée' },
  request_changes: { icon: 'pencil', color: '#e3a33b', description: "L'agent reprend son travail" },
  reject: { icon: 'circle-x', color: '#f0625a', description: 'La feature est abandonnée' },
}

/** Point transmissible à l'agent : un constat ouvert ou une remarque ; `key` est unique entre les deux. */
type Point = { key: string; finding: Finding; note?: undefined } | { key: string; note: Note; finding?: undefined }

function pointsOf(analysis: Analysis): Point[] {
  const findings = analysis.findings
    .map((finding, index) => ({ finding, index }))
    .filter(({ finding }) => finding.status === 'open')
    .sort((a, b) => compareSeverity(a.finding.severity, b.finding.severity) || a.index - b.index)
    .map(({ finding }): Point => ({ key: `f:${finding.id}`, finding }))
  const notes = analysis.notes.map((note): Point => ({ key: `n:${note.id}`, note }))
  return [...findings, ...notes]
}

/**
 * Points exclus au départ : aucun pour une revue en attente, ceux qui ne sont
 * pas dans la sélection pour une revue déjà enregistrée.
 */
function initialExcluded(analysis: Analysis): Set<string> {
  const review = analysis.review
  if (review.state !== 'submitted') return new Set()
  const selected = new Set([...review.selectedFindingIds.map((id) => `f:${id}`), ...review.selectedNoteIds.map((id) => `n:${id}`)])
  return new Set(pointsOf(analysis).map((point) => point.key).filter((key) => !selected.has(key)))
}

/** Écran Fin de revue : décision, points à transmettre, aperçu du prompt et enregistrement du retour. */
export function FinishScreen({ analysis }: { analysis: Analysis }) {
  const copy = useAnalysisStore((state) => state.copy)
  const submitReview = useAnalysisStore((state) => state.submitReview)
  const notify = useAnalysisStore((state) => state.notify)
  const saving = useAnalysisStore((state) => state.saving)

  const points = pointsOf(analysis)
  const [decision, setDecision] = useState<ReviewDecision>(
    () => analysis.review.decision ?? (points.length > 0 ? 'request_changes' : 'approve'),
  )
  const [excluded, setExcluded] = useState<Set<string>>(() => initialExcluded(analysis))

  const selected = points.filter((point) => !excluded.has(point.key))
  const findingIds = selected.flatMap((point) => (point.finding ? [point.finding.id] : []))
  const noteIds = selected.flatMap((point) => (point.note ? [point.note.id] : []))
  const prompt = buildAgentPrompt(analysis, { findingIds, noteIds, decision })
  const reviewed = analysis.files.filter((file) => file.reviewed).length
  const review = analysis.review

  const toggle = (key: string) => {
    const next = new Set(excluded)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setExcluded(next)
  }

  const save = async () => {
    if (await submitReview(decision, findingIds, noteIds)) {
      notify('info', "Retour enregistré : l'agent le lit avec l'outil get_review_feedback.")
    }
  }

  const backPath = firstFileToReview(analysis)

  return (
    <div className="page page-narrow">
      <h1 className="page-title page-title-small">Terminer la revue</h1>
      <p className="page-meta">
        {reviewed} / {plural(analysis.files.length, 'fichier revu', 'fichiers revus')} · {plural(findingIds.length, 'constat')} et{' '}
        {plural(noteIds.length, 'remarque')} à transmettre
      </p>

      {review.state === 'submitted' && review.submittedAt && review.decision && (
        <div className="submitted-banner">
          <Icon name="circle-check" color="#3fb950" size={16} />
          <span>
            Retour enregistré le {formatDateTime(review.submittedAt)} · décision « {DECISION_LABELS[review.decision]} ». L'agent
            le lit avec l'outil get_review_feedback ; un nouvel enregistrement le remplace.
          </span>
        </div>
      )}

      <h2 className="field-label">Décision</h2>
      <div className="decisions" role="radiogroup" aria-label="Décision">
        {REVIEW_DECISIONS.map((entry) => (
          <button
            type="button"
            role="radio"
            aria-checked={decision === entry}
            key={entry}
            className={`decision${decision === entry ? ' is-selected' : ''}`}
            onClick={() => setDecision(entry)}
          >
            <Icon name={DECISIONS[entry].icon} color={DECISIONS[entry].color} size={16} />
            <span className="decision-text">
              <span className="decision-title">{DECISION_LABELS[entry]}</span>
              <span className="decision-description">{DECISIONS[entry].description}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="field-head">
        <h2 className="field-label">Points à transmettre</h2>
        <span className="field-meta">
          {selected.length} sur {points.length} sélectionnés
        </span>
      </div>
      <div className="card points">
        {points.length === 0 && <p className="list-empty">Aucun constat ouvert ni remarque : le retour ne contiendra que la décision.</p>}
        {points.map((point) => {
          const checked = !excluded.has(point.key)
          return (
            <label key={point.key} className={`point${checked ? '' : ' is-excluded'}`}>
              <input type="checkbox" className="visually-hidden" checked={checked} onChange={() => toggle(point.key)} />
              <Icon name={checked ? 'square-check' : 'square'} color={checked ? '#8b97ff' : '#646b7b'} size={16} />
              {point.finding ? <SeverityPill severity={point.finding.severity} /> : <NotePill />}
              <span className="point-title">{point.finding ? point.finding.title : point.note.text}</span>
              <span className="point-location mono">
                {point.finding ? findingLocationLabel(point.finding, analysis.request) : noteLocationLabel(point.note)}
              </span>
            </label>
          )
        })}
      </div>

      <h2 className="field-label">Prompt pour l'agent</h2>
      <div className="prompt-box">
        <pre className="prompt-text">{prompt}</pre>
        <button
          type="button"
          className="icon-button prompt-copy"
          title="Copier le prompt"
          aria-label="Copier le prompt"
          onClick={() => void copy(prompt, 'Prompt copié dans le presse-papiers.')}
        >
          <Icon name="copy" color="#9aa1b1" />
        </button>
      </div>

      <footer className="finish-footer">
        <Icon name="info" color="#646b7b" />
        <span className="finish-hint">L'agent récupère ce retour avec l'outil get_review_feedback.</span>
        <span className="spacer" />
        <button
          type="button"
          className="button button-secondary button-medium"
          onClick={() => navigate(backPath ? hrefs.review(analysis.id, backPath) : hrefs.feature(analysis.id))}
        >
          Retour à la revue
        </button>
        <button type="button" className="button button-primary button-medium" disabled={saving} onClick={() => void save()}>
          <Icon name="save" color="#ffffff" />
          Enregistrer le retour
        </button>
      </footer>
    </div>
  )
}
