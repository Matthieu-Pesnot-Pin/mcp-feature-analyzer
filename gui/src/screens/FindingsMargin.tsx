import { useRef, type CSSProperties, type ReactNode, type RefObject } from 'react'
import type { Analysis, Explanation, FileEntry } from '@shared/schemas/analysis.schema'
import type { FileDiff } from '@shared/schemas/diff.schema'
import { FINDING_STATUS_LABELS, SEVERITY_STYLES } from '@shared/labels'
import { FindingNumber } from '../components/MarginFindingCard'
import { NoteCard, NoteComposer } from '../components/Notes'
import { linesLabel, plural } from '../utils/format'
import type { ComposerTarget } from './DiffView'
import { fileNotesOf, marginItems } from './margin-items'
import {
  anchorOrder,
  anchorSelector,
  lineAnchorOf,
  type FixDisplay,
  type CodeView,
  type FixMode,
  type LineNote,
  type NumberedFinding,
} from './review-diff-model'
import { useFindingsBelow } from './useFindingsBelow'
import { useMarginLayout } from './useMarginLayout'

/** Choix des éléments affichés dans la colonne et le diff, avec le nombre d'éléments de chaque type du fichier. */
export interface MarginFilters {
  findingCount: number
  explanationCount: number
  findingsShown: boolean
  explanationsShown: boolean
  onFindingsShownChange: (shown: boolean) => void
  onExplanationsShownChange: (shown: boolean) => void
}

/**
 * Boutons « Constats » et « Explications » : chacun affiche ou masque son type,
 * indépendamment de l'autre. Masquer les constats permet de parcourir le code
 * avec ses seules explications, et inversement.
 */
function MarginFilterButtons({ filters }: { filters: MarginFilters }) {
  const buttons = [
    {
      key: 'findings',
      label: 'Constats',
      count: filters.findingCount,
      shown: filters.findingsShown,
      color: '#e3a33b',
      onChange: filters.onFindingsShownChange,
    },
    {
      key: 'explanations',
      label: 'Explications',
      count: filters.explanationCount,
      shown: filters.explanationsShown,
      color: '#3cc4b4',
      onChange: filters.onExplanationsShownChange,
    },
  ]
  return (
    <div className="margin-filters" role="group" aria-label="Éléments affichés">
      {buttons.map((button) => (
        <button
          key={button.key}
          type="button"
          className={`margin-filter${button.shown ? ' is-on' : ''}`}
          style={{ '--filter': button.color } as CSSProperties}
          aria-pressed={button.shown}
          title={button.shown ? `Masquer les ${button.label.toLowerCase()}` : `Afficher les ${button.label.toLowerCase()}`}
          onClick={() => button.onChange(!button.shown)}
        >
          <span className="margin-filter-dot" aria-hidden="true" />
          {button.label}
          <span className="margin-filter-count">{button.count}</span>
        </button>
      ))}
    </div>
  )
}

interface FindingsMarginProps {
  analysis: Analysis
  file: FileEntry
  numbered: NumberedFinding[]
  /** Explications du fichier à afficher ; vide quand le relecteur les masque. */
  explanations: Explanation[]
  filters: MarginFilters
  /** Diff du fichier ; null tant qu'il charge. */
  fileDiff: FileDiff | null
  fixes: Map<string, FixDisplay>
  mode: FixMode
  /** Code affiché dans le diff, dont dépend l'ancre des explications de lignes supprimées. */
  codeView: CodeView
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
 * hors des lignes affichées en tête, puis cartes des explications, des constats
 * et des remarques alignées sur leur première ligne dans le diff, empilées sans
 * chevauchement ; à hauteur égale, l'explication précède les constats.
 * L'en-tête compte les constats ouverts et porte l'index des constats ; une
 * indication collée en bas de la colonne compte les cartes de constat
 * situées sous la partie visible.
 */
export function FindingsMargin({
  analysis,
  file,
  numbered,
  explanations,
  filters,
  fileDiff,
  fixes,
  mode,
  codeView,
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

  const shown = shownLines ?? new Set<number>()
  const fileNotes = fileNotesOf(analysis, file)

  const composerCard = (line: number | null) => (
    <NoteComposer path={file.path} line={line} findingId={composer?.findingId ?? null} onClose={() => setComposer(null)} />
  )

  const items = marginItems({
    analysis,
    file,
    numbered,
    explanations,
    fileDiff,
    fixes,
    mode,
    codeView,
    removed,
    lineNotes,
    shown,
    setComposer,
    onToggleFix,
    revealedId,
  })
  const aligned: AlignedItem[] = []
  const outside: ReactNode[] = []
  for (const item of items) {
    if (item.anchor === null) outside.push(<div key={item.key}>{item.content}</div>)
    else aligned.push({ ...item, anchor: item.anchor })
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

  const empty =
    numbered.length === 0 && explanations.length === 0 && lineNotes.length === 0 && fileNotes.length === 0 && composer === null
  const hiddenCount =
    (filters.findingsShown ? 0 : filters.findingCount) + (filters.explanationsShown ? 0 : filters.explanationCount)
  const openCount = numbered.filter((entry) => entry.finding.status === 'open').length

  return (
    <aside className="margin-column" aria-label="Constats et explications de ce fichier" ref={columnRef}>
      <div className="margin-head">
        <h2 className="margin-title">
          Constats et explications{' '}
          {filters.findingsShown && (
            <span
              className="margin-count"
              title="Constats ouverts de ce fichier ; le total compte aussi les constats ignorés et obsolètes."
            >
              {plural(openCount, 'constat ouvert', 'constats ouverts')}
              {numbered.length !== openCount && ` · ${numbered.length} au total`}
            </span>
          )}
        </h2>
        <MarginFilterButtons filters={filters} />
        {empty && hiddenCount > 0 ? (
          <p className="margin-subtitle">
            {plural(hiddenCount, 'élément masqué', 'éléments masqués')} sur ce fichier : affichez-les avec les boutons ci-dessus.
          </p>
        ) : empty ? (
          <p className="margin-subtitle">
            Aucun constat, explication ni remarque sur ce fichier. Cliquez sur un numéro de ligne pour ajouter une remarque.
          </p>
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
