import type { ReactNode } from 'react'
import type { Analysis, Explanation, FileEntry, Note } from '@shared/schemas/analysis.schema'
import type { FileDiff } from '@shared/schemas/diff.schema'
import { NOTE_STYLE, SEVERITY_STYLES } from '@shared/labels'
import { MarginExplanationCard } from '../components/MarginExplanationCard'
import { MarginFindingCard } from '../components/MarginFindingCard'
import { NoteCard } from '../components/Notes'
import type { ComposerTarget } from './DiffView'
import {
  anchorOrder,
  anchorSelector,
  explanationAnchor,
  findingAnchor,
  firstShownLine,
  lineAnchorOf,
  type CodeView,
  type FixDisplay,
  type FixMode,
  type LineNote,
  type NumberedFinding,
} from './review-diff-model'

/** Remarques du relecteur sur le fichier entier. */
export function fileNotesOf(analysis: Analysis, file: FileEntry): Note[] {
  return analysis.notes.filter((note) => note.location?.path === file.path && note.location.line === null)
}

/** Carte d'un constat, d'une explication ou d'une remarque de ligne, avec l'élément du diff où elle s'aligne. */
export interface MarginItem {
  key: string
  kind: 'finding' | 'explanation' | 'note'
  /** Sélecteur de l'élément du diff où s'aligne la carte ; null quand ses lignes ne sont pas affichées. */
  anchor: string | null
  /** Position dans le diff, pour l'ordre des cartes. */
  line: number
  rank: number
  color: string
  /** Description courte : nature, numéro ou ligne, titre. */
  label: string
  content: ReactNode
}

interface MarginItemsInput {
  analysis: Analysis
  file: FileEntry
  numbered: NumberedFinding[]
  explanations: Explanation[]
  fileDiff: FileDiff | null
  fixes: Map<string, FixDisplay>
  mode: FixMode
  codeView: CodeView
  removed: ReadonlyMap<number, NumberedFinding>
  lineNotes: LineNote[]
  /** Lignes affichées par le diff. */
  shown: ReadonlySet<number>
  setComposer: (target: ComposerTarget) => void
  onToggleFix: (findingId: string, shown: boolean) => void
  revealedId: string | null
}

/**
 * Cartes des constats, des explications et des remarques de ligne d'un fichier,
 * dans cet ordre, chacune avec l'élément du diff où elle s'aligne. À hauteur
 * égale, l'explication précède les constats, qui précèdent les remarques.
 */
export function marginItems({
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
}: MarginItemsInput): MarginItem[] {
  const canNote = file.contentAvailable
  const items: MarginItem[] = []
  for (const entry of numbered) {
    const { finding } = entry
    const anchor = findingAnchor(entry, fixes, shown, removed)
    const noteLine = firstShownLine(shown, entry.startLine, entry.endLine)
    const placed = anchor !== null && noteLine !== null
    items.push({
      key: `finding-${finding.id}`,
      kind: 'finding',
      anchor: placed ? anchorSelector(anchor) : null,
      line: placed ? anchorOrder(anchor) : entry.startLine,
      rank: entry.number,
      color: finding.status === 'open' ? SEVERITY_STYLES[finding.severity].color : '#3a4050',
      label: `Constat ${entry.number} · ${SEVERITY_STYLES[finding.severity].label} · ${finding.title}`,
      content: (
        <MarginFindingCard
          analysis={analysis}
          entry={entry}
          fix={fixes.get(finding.id)!}
          mode={mode}
          onToggleFix={(value) => onToggleFix(finding.id, value)}
          onAddNote={canNote ? () => setComposer({ line: noteLine ?? entry.startLine, findingId: finding.id }) : undefined}
          highlighted={finding.id === revealedId}
        />
      ),
    })
  }
  for (const explanation of explanations) {
    const anchor = fileDiff === null ? null : explanationAnchor(fileDiff, explanation, removed, codeView)
    items.push({
      key: `explanation-${explanation.id}`,
      kind: 'explanation',
      anchor: anchor?.selector ?? null,
      line: anchor?.order ?? explanation.location.startLine,
      rank: 0,
      color: explanation.status === 'current' ? '#3cc4b4' : '#3a4050',
      label: `Explication · ${explanation.title}`,
      content: <MarginExplanationCard explanation={explanation} />,
    })
  }
  for (const note of lineNotes) {
    const placed = shown.has(note.location.line)
    const anchor = lineAnchorOf(note.location.line, removed)
    items.push({
      key: `note-${note.id}`,
      kind: 'note',
      anchor: placed ? anchorSelector(anchor) : null,
      line: placed ? anchorOrder(anchor) : note.location.line,
      rank: 1000,
      color: NOTE_STYLE.color,
      label: `Remarque · ligne ${note.location.line}`,
      content: <NoteCard note={note} />,
    })
  }
  return items
}
