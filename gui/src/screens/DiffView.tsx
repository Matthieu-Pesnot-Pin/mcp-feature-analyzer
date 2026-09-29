import type { CSSProperties } from 'react'
import type { Analysis, FileEntry, Finding, Note, Severity } from '@shared/schemas/analysis.schema'
import type { DiffLine, FileDiff } from '@shared/schemas/diff.schema'
import { SEVERITY_STYLES } from '@shared/labels'
import { compareSeverity } from '@shared/severity'
import { FindingCard } from '../components/FindingCard'
import { NoteCard, NoteComposer } from '../components/Notes'
import { findingsOfFile } from './review-model'

/** Ligne où s'ouvre la saisie d'une remarque ; `line` null vise le fichier entier. */
export type ComposerTarget = { line: number | null } | null

interface DiffViewProps {
  analysis: Analysis
  file: FileEntry
  fileDiff: FileDiff
  /** Ligne mise en évidence (paramètre `?line=N`). */
  targetLine: number | null
  composer: ComposerTarget
  setComposer: (target: ComposerTarget) => void
}

const MARKERS: Record<DiffLine['type'], string> = { context: ' ', add: '+', del: '−' }

function groupBy<T>(items: T[], key: (item: T) => number): Map<number, T[]> {
  const map = new Map<number, T[]>()
  for (const item of items) {
    const value = key(item)
    map.set(value, [...(map.get(value) ?? []), item])
  }
  return map
}

/** Gravité la plus haute des constats ouverts qui couvrent la ligne `lineNo`. */
function markSeverity(findings: Finding[], lineNo: number): Severity | null {
  let best: Severity | null = null
  for (const finding of findings) {
    const location = finding.location
    if (finding.status !== 'open' || !location) continue
    if (lineNo < location.startLine || lineNo > location.endLine) continue
    if (best === null || compareSeverity(finding.severity, best) < 0) best = finding.severity
  }
  return best
}

/**
 * Diff d'un fichier : en-têtes de bloc, numéros de ligne du côté « nouveau »,
 * constats et remarques insérés sous leur ligne de fin. Un clic sur un numéro
 * ouvre la saisie d'une remarque sur cette ligne.
 */
export function DiffView({ analysis, file, fileDiff, targetLine, composer, setComposer }: DiffViewProps) {
  const findings = findingsOfFile(analysis, file.path)
  const lineNotes = analysis.notes.filter(
    (note): note is Note & { location: { path: string; line: number } } =>
      note.location?.path === file.path && note.location.line !== null,
  )
  const shownLines = new Set<number>()
  for (const hunk of fileDiff.hunks) {
    for (const line of hunk.lines) if (line.newNo !== null) shownLines.add(line.newNo)
  }

  const findingsByEnd = groupBy(
    findings.filter((finding) => shownLines.has(finding.location!.endLine)),
    (finding) => finding.location!.endLine,
  )
  const notesByLine = groupBy(
    lineNotes.filter((note) => shownLines.has(note.location.line)),
    (note) => note.location.line,
  )
  const outsideFindings = findings.filter((finding) => !shownLines.has(finding.location!.endLine))
  const outsideNotes = lineNotes.filter((note) => !shownLines.has(note.location.line))
  const canNote = file.contentAvailable
  const openComposer = (line: number) => setComposer({ line })

  return (
    <>
      {(outsideFindings.length > 0 || outsideNotes.length > 0) && (
        <section className="outside-block">
          <h3 className="block-title">Hors des lignes affichées du diff</h3>
          {outsideFindings.map((finding) => (
            <FindingCard
              key={finding.id}
              analysis={analysis}
              finding={finding}
              onAddNote={canNote ? () => openComposer(finding.location!.endLine) : undefined}
            />
          ))}
          {outsideNotes.map((note) => (
            <NoteCard key={note.id} note={note} />
          ))}
          {composer?.line !== null && composer !== null && !shownLines.has(composer.line) && (
            <NoteComposer path={file.path} line={composer.line} onClose={() => setComposer(null)} />
          )}
        </section>
      )}

      <div className="diff">
        {fileDiff.hunks.map((hunk, hunkIndex) => (
          <div key={hunkIndex} className="hunk">
            <div className="hunk-header mono">{hunk.header}</div>
            {hunk.lines.map((line, lineIndex) => {
              const lineNo = line.newNo
              const severity = lineNo === null ? null : markSeverity(findings, lineNo)
              const style = severity ? ({ '--mark': SEVERITY_STYLES[severity].color } as CSSProperties) : undefined
              const classes = [
                'diff-line',
                `is-${line.type}`,
                severity ? `is-marked mark-${severity}` : '',
                lineNo !== null && lineNo === targetLine ? 'is-target' : '',
              ]
              const cards = lineNo === null ? [] : (findingsByEnd.get(lineNo) ?? [])
              const notes = lineNo === null ? [] : (notesByLine.get(lineNo) ?? [])
              const composing = lineNo !== null && composer?.line === lineNo

              return (
                <div key={lineIndex} className="diff-line-group">
                  <div className={classes.filter(Boolean).join(' ')} style={style} data-line={lineNo ?? undefined}>
                    {notes.length > 0 && <span className="diff-note-dot" title={`${notes.length} remarque(s)`} />}
                    {lineNo !== null && canNote ? (
                      <button
                        type="button"
                        className="diff-num"
                        title={`Ajouter une remarque sur la ligne ${lineNo}`}
                        onClick={() => openComposer(lineNo)}
                      >
                        {lineNo}
                      </button>
                    ) : (
                      <span className="diff-num">{lineNo ?? ''}</span>
                    )}
                    <span className="diff-marker">{MARKERS[line.type]}</span>
                    <span className="diff-code">{line.text}</span>
                  </div>
                  {(cards.length > 0 || notes.length > 0 || composing) && (
                    <div className="diff-inserts">
                      {cards.map((finding) => (
                        <FindingCard
                          key={finding.id}
                          analysis={analysis}
                          finding={finding}
                          onAddNote={canNote ? () => openComposer(lineNo!) : undefined}
                        />
                      ))}
                      {notes.map((note) => (
                        <NoteCard key={note.id} note={note} />
                      ))}
                      {composing && <NoteComposer path={file.path} line={lineNo} onClose={() => setComposer(null)} />}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}
