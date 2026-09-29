import { useRef, type CSSProperties, type ReactNode, type RefObject } from 'react'
import type { Analysis, FileEntry } from '@shared/schemas/analysis.schema'
import { NOTE_STYLE, SEVERITY_STYLES } from '@shared/labels'
import { MarginFindingCard } from '../components/MarginFindingCard'
import { NoteCard, NoteComposer } from '../components/Notes'
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
}: FindingsMarginProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  useMarginLayout(trackRef, scopeRef)

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

  return (
    <aside className="margin-column" aria-label="Constats de ce fichier">
      <div className="margin-head">
        <h2 className="margin-title">
          Constats de ce fichier <span className="margin-count">{numbered.length}</span>
        </h2>
        {empty ? (
          <p className="margin-subtitle">Aucun constat ni remarque sur ce fichier. Cliquez sur un numéro de ligne pour ajouter une remarque.</p>
        ) : (
          <p className="margin-subtitle is-aligned-hint">Chaque carte est alignée sur les lignes qu'elle concerne.</p>
        )}
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
    </aside>
  )
}
