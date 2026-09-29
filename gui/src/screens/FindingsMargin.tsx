import { useRef, type CSSProperties, type ReactNode, type RefObject } from 'react'
import type { Analysis, FileEntry } from '@shared/schemas/analysis.schema'
import { FINDING_STATUS_LABELS, NOTE_STYLE, SEVERITY_STYLES } from '@shared/labels'
import { FindingNumber, MarginFindingCard } from '../components/MarginFindingCard'
import { NoteCard, NoteComposer } from '../components/Notes'
import { linesLabel, plural } from '../utils/format'
import type { ComposerTarget } from './DiffView'
import {
  anchorOrder,
  anchorSelector,
  findingAnchor,
  firstShownLine,
  lineAnchorOf,
  type FixDisplay,
  type FixMode,
  type LineNote,
  type NumberedFinding,
} from './review-diff-model'
import { useFindingsBelow } from './useFindingsBelow'
import { useMarginLayout } from './useMarginLayout'

interface FindingsMarginProps {
  analysis: Analysis
  file: FileEntry
  numbered: NumberedFinding[]
  fixes: Map<string, FixDisplay>
  mode: FixMode
  /** Lignes retirées du diff par un correctif appliqué, avec le constat qui les remplace. */
  removed: ReadonlyMap<number, NumberedFinding>
  lineNotes: LineNote[]
  /** Lignes affichées par le diff ; null tant que le diff charge. */
  shownLines: ReadonlySet<number> | null
  composer: ComposerTarget
  setComposer: (target: ComposerTarget) => void
  onToggleFix: (findingId: string, shown: boolean) => void
  /** Zone du diff où se trouvent les ancres des cartes alignées. */
  scopeRef: RefObject<HTMLElement | null>
  /** Zone de défilement commune au diff et à la colonne. */
  scrollRef: RefObject<HTMLElement | null>
  /** Amène à l'écran un constat, sa carte et ses lignes. */
  onReveal: (entry: NumberedFinding) => void
  /** Constat dont la carte est mise en évidence ; null pour aucun. */
  revealedId: string | null
}

/** Index compact des constats du fichier : numéro et première ligne, dans l'ordre des numéros. */
function FindingsIndex({ numbered, onReveal }: { numbered: NumberedFinding[]; onReveal: (entry: NumberedFinding) => void }) {
  return (
    <nav className="margin-index" aria-label="Index des constats du fichier">
      {numbered.map((entry) => {
        const { finding } = entry
        const status = finding.status === 'open' ? '' : ` · ${FINDING_STATUS_LABELS[finding.status].toLowerCase()}`
        return (
          <button
            key={finding.id}
            type="button"
            className={`margin-index-item${finding.status === 'open' ? '' : ' is-muted'}`}
            style={{ color: SEVERITY_STYLES[finding.severity].color }}
            title={`${finding.title} · ${linesLabel(entry.startLine, entry.endLine)}${status}`}
            onClick={() => onReveal(entry)}
          >
            <FindingNumber entry={entry} small />
            <span className="mono">l.{entry.startLine}</span>
          </button>
        )
      })}
    </nav>
  )
}

/** Carte alignée sur une ancre du diff, avec sa liaison horizontale. */
interface AlignedItem {
  key: string
  anchor: string
  /** Position dans le diff, pour l'ordre des cartes. */
  line: number
  rank: number
  color: string
  content: ReactNode
}

/**
 * Colonne « Constats de ce fichier » : remarques sur le fichier et éléments
 * hors des lignes affichées en tête, puis cartes des constats et des remarques
 * alignées sur leur première ligne dans le diff, empilées sans chevauchement.
 * L'en-tête compte les constats ouverts et porte l'index des constats ; une
 * indication collée en bas de la colonne compte les cartes de constat
 * situées sous la partie visible.
 */
export function FindingsMargin({
  analysis,
  file,
  numbered,
  fixes,
  mode,
  removed,
  lineNotes,
  shownLines,
  composer,
  setComposer,
  onToggleFix,
  scopeRef,
  scrollRef,
  onReveal,
  revealedId,
}: FindingsMarginProps) {
  const columnRef = useRef<HTMLElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  useMarginLayout(trackRef, scopeRef)
  const below = useFindingsBelow(scrollRef, columnRef)
  const nextBelow = below.length === 0 ? undefined : numbered.find((entry) => entry.finding.id === below[0])

  const canNote = file.contentAvailable
  const shown = shownLines ?? new Set<number>()
  const fileNotes = analysis.notes.filter((note) => note.location?.path === file.path && note.location.line === null)

  const findingCard = (entry: NumberedFinding, noteLine: number) => (
    <MarginFindingCard
      analysis={analysis}
      entry={entry}
      fix={fixes.get(entry.finding.id)!}
      mode={mode}
      onToggleFix={(value) => onToggleFix(entry.finding.id, value)}
      onAddNote={canNote ? () => setComposer({ line: noteLine }) : undefined}
      highlighted={entry.finding.id === revealedId}
    />
  )
  const composerCard = (line: number | null) => <NoteComposer path={file.path} line={line} onClose={() => setComposer(null)} />

  const aligned: AlignedItem[] = []
  const outside: ReactNode[] = []
  for (const entry of numbered) {
    const anchor = findingAnchor(entry, fixes, shown, removed)
    const noteLine = firstShownLine(shown, entry.startLine, entry.endLine)
    if (anchor === null || noteLine === null) {
      outside.push(<div key={entry.finding.id}>{findingCard(entry, entry.startLine)}</div>)
      continue
    }
    aligned.push({
      key: `finding-${entry.finding.id}`,
      anchor: anchorSelector(anchor),
      line: anchorOrder(anchor),
      rank: entry.number,
      color: entry.finding.status === 'open' ? SEVERITY_STYLES[entry.finding.severity].color : '#3a4050',
      content: findingCard(entry, noteLine),
    })
  }
  for (const note of lineNotes) {
    if (!shown.has(note.location.line)) {
      outside.push(<NoteCard key={note.id} note={note} />)
      continue
    }
    const anchor = lineAnchorOf(note.location.line, removed)
    aligned.push({
      key: `note-${note.id}`,
      anchor: anchorSelector(anchor),
      line: anchorOrder(anchor),
      rank: 1000,
      color: NOTE_STYLE.color,
      content: <NoteCard note={note} />,
    })
  }
  const composerLine = composer?.line ?? null
  const composerAligned = composer !== null && composerLine !== null && shown.has(composerLine)
  if (composerAligned) {
    const anchor = lineAnchorOf(composerLine, removed)
    aligned.push({
      key: 'composer',
      anchor: anchorSelector(anchor),
      line: anchorOrder(anchor),
      rank: 2000,
      color: '#6d7cff',
      content: composerCard(composerLine),
    })
  }
  if (composer !== null && composerLine !== null && !composerAligned) outside.push(<div key="composer">{composerCard(composerLine)}</div>)
  aligned.sort((a, b) => a.line - b.line || a.rank - b.rank)

  const empty = numbered.length === 0 && lineNotes.length === 0 && fileNotes.length === 0 && composer === null
  const openCount = numbered.filter((entry) => entry.finding.status === 'open').length

  return (
    <aside className="margin-column" aria-label="Constats de ce fichier" ref={columnRef}>
      <div className="margin-head">
        <h2 className="margin-title">
          Constats de ce fichier{' '}
          <span
            className="margin-count"
            title="Constats ouverts de ce fichier ; le total compte aussi les constats ignorés et obsolètes."
          >
            {plural(openCount, 'ouvert')}
            {numbered.length !== openCount && ` · ${numbered.length} au total`}
          </span>
        </h2>
        {empty ? (
          <p className="margin-subtitle">Aucun constat ni remarque sur ce fichier. Cliquez sur un numéro de ligne pour ajouter une remarque.</p>
        ) : (
          <p className="margin-subtitle is-aligned-hint">Chaque carte est alignée sur les lignes qu'elle concerne.</p>
        )}
        {numbered.length > 0 && <FindingsIndex numbered={numbered} onReveal={onReveal} />}
      </div>

      {(fileNotes.length > 0 || composer?.line === null) && (
        <section className="margin-section">
          <h3 className="block-title">Sur le fichier entier</h3>
          {fileNotes.map((note) => (
            <NoteCard key={note.id} note={note} />
          ))}
          {composer?.line === null && composerCard(null)}
        </section>
      )}

      {shownLines !== null && outside.length > 0 && (
        <section className="margin-section">
          <h3 className="block-title">Hors des lignes affichées du diff</h3>
          {outside}
        </section>
      )}

      <div className="margin-track" ref={trackRef}>
        {shownLines !== null &&
          aligned.map((item) => (
            <div key={item.key} className="margin-item" data-anchor={item.anchor} style={{ '--link': item.color } as CSSProperties}>
              <span className="margin-link-a" aria-hidden="true" />
              <span className="margin-link-b" aria-hidden="true" />
              {item.content}
            </div>
          ))}
      </div>

      {nextBelow && (
        <button type="button" className="margin-more" onClick={() => onReveal(nextBelow)}>
          {plural(below.length, 'constat')} plus bas ↓
        </button>
      )}
    </aside>
  )
}
