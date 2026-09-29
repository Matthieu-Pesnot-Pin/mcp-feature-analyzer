import type { Analysis, Finding, Note, Severity } from '@shared/schemas/analysis.schema'
import type { DiffLine, FileDiff } from '@shared/schemas/diff.schema'
import { compareSeverity } from '@shared/severity'
import { splitLines } from '@shared/text'

/** Constat ancré sur le fichier revu, avec son numéro dans le fichier. */
export interface NumberedFinding {
  finding: Finding
  number: number
  startLine: number
  endLine: number
}

/**
 * Constats ancrés sur `path`, numérotés à partir de 1 dans l'ordre de leur
 * première ligne, puis de leur dernière ligne, puis de l'analyse.
 */
export function numberedFindingsOfFile(analysis: Analysis, path: string): NumberedFinding[] {
  const located = analysis.findings.flatMap((finding) =>
    finding.location?.path === path ? [{ finding, startLine: finding.location.startLine, endLine: finding.location.endLine }] : [],
  )
  located.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine)
  return located.map((entry, index) => ({ ...entry, number: index + 1 }))
}

/** Numéros de ligne du côté « nouveau » affichés par le diff. */
export function shownLineNumbers(fileDiff: FileDiff): Set<number> {
  const shown = new Set<number>()
  for (const hunk of fileDiff.hunks) {
    for (const line of hunk.lines) if (line.newNo !== null) shown.add(line.newNo)
  }
  return shown
}

/** Première ligne affichée de la plage `start`–`end` ; null quand aucune ne l'est. */
export function firstShownLine(shown: ReadonlySet<number>, start: number, end: number): number | null {
  for (let line = start; line <= end; line++) if (shown.has(line)) return line
  return null
}

/**
 * Affichage du correctif d'un constat :
 * - `none` : pas de correctif proposé ;
 * - `shown` / `hidden` : correctif affiché dans le diff, ou masqué par le relecteur ;
 * - `outside` : les lignes visées ne sont pas toutes dans un même bloc du diff ;
 * - `blocked` : ses lignes recouvrent celles d'un correctif déjà affiché (`blockedBy`).
 */
export type FixDisplay =
  | { state: 'none' }
  | { state: 'shown' }
  | { state: 'hidden' }
  | { state: 'outside' }
  | { state: 'blocked'; blockedBy: number }

/** Vrai quand toutes les lignes `start`–`end` sont affichées dans un même bloc du diff. */
function inOneHunk(fileDiff: FileDiff, start: number, end: number): boolean {
  return fileDiff.hunks.some((hunk) => {
    const numbers = hunk.lines.flatMap((line) => (line.newNo === null ? [] : [line.newNo]))
    return numbers.includes(start) && numbers.includes(end)
  })
}

/**
 * Affichage du correctif de chaque constat. `requested` dit si le relecteur
 * veut voir le correctif d'un constat. Les correctifs sont placés dans l'ordre
 * des numéros ; un correctif dont les lignes recouvrent un correctif déjà placé
 * n'est pas affiché dans le diff.
 */
export function resolveFixDisplays(
  numbered: NumberedFinding[],
  fileDiff: FileDiff,
  requested: (finding: Finding) => boolean,
): Map<string, FixDisplay> {
  const result = new Map<string, FixDisplay>()
  const placed: NumberedFinding[] = []
  for (const entry of numbered) {
    const { finding } = entry
    if (finding.suggestion === null) {
      result.set(finding.id, { state: 'none' })
    } else if (!inOneHunk(fileDiff, entry.startLine, entry.endLine)) {
      result.set(finding.id, { state: 'outside' })
    } else if (!requested(finding)) {
      result.set(finding.id, { state: 'hidden' })
    } else {
      const overlap = placed.find((other) => other.startLine <= entry.endLine && entry.startLine <= other.endLine)
      if (overlap) {
        result.set(finding.id, { state: 'blocked', blockedBy: overlap.number })
      } else {
        placed.push(entry)
        result.set(finding.id, { state: 'shown' })
      }
    }
  }
  return result
}

/** Repère vertical d'une ligne : gravité du constat, atténuée quand il n'est pas ouvert. */
export interface RowBar {
  severity: Severity
  muted: boolean
}

export type DiffRow =
  | {
      kind: 'line'
      line: DiffLine
      /** Ligne visée par un correctif affiché : barrée. */
      replaced: boolean
      bar: RowBar | null
      /** Pastilles des constats dont c'est la première ligne affichée et dont le correctif n'est pas dans le diff. */
      pills: NumberedFinding[]
    }
  | { kind: 'fix-strip'; entry: NumberedFinding; bar: RowBar }
  | { kind: 'fix-line'; text: string; entry: NumberedFinding; bar: RowBar }

export interface HunkRows {
  header: string
  rows: DiffRow[]
}

function barOf(finding: Finding): RowBar {
  return { severity: finding.severity, muted: finding.status !== 'open' }
}

/** Repère d'une ligne : le constat ouvert le plus grave qui la couvre, sinon le plus grave des autres. */
function lineBar(numbered: NumberedFinding[], lineNo: number): RowBar | null {
  let best: Finding | null = null
  for (const { finding, startLine, endLine } of numbered) {
    if (lineNo < startLine || lineNo > endLine) continue
    const better =
      best === null ||
      (finding.status === 'open' && best.status !== 'open') ||
      ((finding.status === 'open') === (best.status === 'open') && compareSeverity(finding.severity, best.severity) < 0)
    if (better) best = finding
  }
  return best ? barOf(best) : null
}

/**
 * Lignes du diff, bloc par bloc, avec les correctifs affichés insérés à leur
 * place : bandeau avant la première ligne visée, lignes visées barrées, lignes
 * proposées après la dernière ligne visée.
 */
export function buildDiffRows(fileDiff: FileDiff, numbered: NumberedFinding[], fixes: Map<string, FixDisplay>): HunkRows[] {
  const shown = shownLineNumbers(fileDiff)
  const placed = numbered.filter((entry) => fixes.get(entry.finding.id)?.state === 'shown')
  const pillsByLine = new Map<number, NumberedFinding[]>()
  for (const entry of numbered) {
    if (fixes.get(entry.finding.id)?.state === 'shown') continue
    const anchor = firstShownLine(shown, entry.startLine, entry.endLine)
    if (anchor !== null) pillsByLine.set(anchor, [...(pillsByLine.get(anchor) ?? []), entry])
  }

  return fileDiff.hunks.map((hunk) => {
    const rows: DiffRow[] = []
    for (const line of hunk.lines) {
      const lineNo = line.newNo
      const fixStart = lineNo === null ? undefined : placed.find((entry) => entry.startLine === lineNo)
      if (fixStart) rows.push({ kind: 'fix-strip', entry: fixStart, bar: barOf(fixStart.finding) })

      const fix = lineNo === null ? undefined : placed.find((entry) => lineNo >= entry.startLine && lineNo <= entry.endLine)
      rows.push({
        kind: 'line',
        line,
        replaced: fix !== undefined && line.type !== 'del',
        bar: fix ? barOf(fix.finding) : lineNo === null ? null : lineBar(numbered, lineNo),
        pills: lineNo === null ? [] : (pillsByLine.get(lineNo) ?? []),
      })

      const fixEnd = lineNo === null ? undefined : placed.find((entry) => entry.endLine === lineNo)
      if (fixEnd) {
        for (const text of splitLines(fixEnd.finding.suggestion ?? '')) {
          rows.push({ kind: 'fix-line', text, entry: fixEnd, bar: barOf(fixEnd.finding) })
        }
      }
    }
    return { header: hunk.header, rows }
  })
}

/** Sélecteur de l'élément du diff sur lequel s'aligne une carte de la marge. */
export function lineAnchor(line: number): string {
  return `[data-line="${line}"]`
}

export function fixAnchor(findingId: string): string {
  return `[data-fix="${findingId}"]`
}

/** Remarque du relecteur sur une ligne du fichier. */
export type LineNote = Note & { location: { path: string; line: number } }

/** Remarques posées sur une ligne de `path`, dans l'ordre des lignes. */
export function lineNotesOfFile(analysis: Analysis, path: string): LineNote[] {
  return analysis.notes
    .filter((note): note is LineNote => note.location?.path === path && note.location.line !== null)
    .sort((a, b) => a.location.line - b.location.line)
}

/** Plage de lignes remplacée par un correctif : « la ligne 12 », « les lignes 59 à 61 ». */
export function replacedLinesLabel(startLine: number, endLine: number): string {
  return startLine === endLine ? `la ligne ${startLine}` : `les lignes ${startLine} à ${endLine}`
}
