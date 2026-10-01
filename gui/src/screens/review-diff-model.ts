import type { Analysis, Explanation, Finding, Note, Severity } from '@shared/schemas/analysis.schema'
import type { DiffLine, FileDiff, Hunk } from '@shared/schemas/diff.schema'
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
 * Affichage des correctifs dans le diff :
 * - `off` : aucun correctif n'est dessiné ;
 * - `before-after` : lignes visées barrées, lignes proposées en dessous ;
 * - `applied` : lignes proposées à la place des lignes visées.
 */
export type FixMode = 'off' | 'before-after' | 'applied'

export const FIX_MODE_LABELS: Record<FixMode, string> = {
  off: 'Sans correctif',
  'before-after': 'Avant / après',
  applied: 'Code corrigé',
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
 * veut voir le correctif d'un constat ; en mode `off`, aucun n'est affiché.
 * Les correctifs sont placés dans l'ordre des numéros ; un correctif dont les
 * lignes recouvrent un correctif déjà placé n'est pas affiché dans le diff.
 */
export function resolveFixDisplays(
  numbered: NumberedFinding[],
  fileDiff: FileDiff,
  requested: (finding: Finding) => boolean,
  mode: FixMode,
): Map<string, FixDisplay> {
  const result = new Map<string, FixDisplay>()
  const placed: NumberedFinding[] = []
  for (const entry of numbered) {
    const { finding } = entry
    if (finding.suggestion === null) {
      result.set(finding.id, { state: 'none' })
    } else if (!inOneHunk(fileDiff, entry.startLine, entry.endLine)) {
      result.set(finding.id, { state: 'outside' })
    } else if (mode === 'off' || !requested(finding)) {
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
      /** Ligne visée par un correctif affiché avant / après : barrée. */
      replaced: boolean
      /** Ligne couverte par au moins une explication affichée. */
      explained: boolean
      bar: RowBar | null
      /** Pastilles des constats ancrés sur cette ligne dont le correctif n'est pas dans le diff. */
      pills: NumberedFinding[]
    }
  | {
      kind: 'fix-strip'
      entry: NumberedFinding
      bar: RowBar
      /** Pastilles des constats ancrés sur ce bandeau : leurs lignes affichées sont retirées par ce correctif appliqué. */
      pills: NumberedFinding[]
    }
  | { kind: 'fix-line'; text: string; entry: NumberedFinding; bar: RowBar }

export interface HunkRows {
  /** Bloc du diff figé dont sont issues les lignes. */
  hunk: Hunk
  rows: DiffRow[]
}

/** Élément du diff sur lequel s'aligne un constat ou une remarque : une ligne, ou le bandeau d'un correctif. */
export type DiffAnchor = { kind: 'line'; line: number } | { kind: 'fix'; entry: NumberedFinding }

/** Sélecteur de l'élément du diff désigné par `anchor`. */
export function anchorSelector(anchor: DiffAnchor): string {
  return anchor.kind === 'line' ? lineAnchor(anchor.line) : fixAnchor(anchor.entry.finding.id)
}

/** Position de `anchor` dans le diff, en numéro de ligne ; un bandeau précède sa première ligne visée. */
export function anchorOrder(anchor: DiffAnchor): number {
  return anchor.kind === 'line' ? anchor.line : anchor.entry.startLine - 0.5
}

/** Vrai quand `a` et `b` désignent le même élément du diff. */
export function sameAnchor(a: DiffAnchor | null, b: DiffAnchor | null): boolean {
  if (a === null || b === null) return false
  if (a.kind === 'line') return b.kind === 'line' && a.line === b.line
  return b.kind === 'fix' && a.entry.finding.id === b.entry.finding.id
}

/**
 * Lignes retirées de l'affichage en mode `applied`, associées au constat dont
 * le correctif les remplace. Vide dans les autres modes.
 */
export function appliedRemovals(
  numbered: NumberedFinding[],
  fixes: Map<string, FixDisplay>,
  mode: FixMode,
): Map<number, NumberedFinding> {
  const removed = new Map<number, NumberedFinding>()
  if (mode !== 'applied') return removed
  for (const entry of numbered) {
    if (fixes.get(entry.finding.id)?.state !== 'shown') continue
    for (let line = entry.startLine; line <= entry.endLine; line++) removed.set(line, entry)
  }
  return removed
}

/** Ancre d'une ligne du fichier : la ligne elle-même, ou le bandeau du correctif appliqué qui la retire. */
export function lineAnchorOf(line: number, removed: ReadonlyMap<number, NumberedFinding>): DiffAnchor {
  const entry = removed.get(line)
  return entry ? { kind: 'fix', entry } : { kind: 'line', line }
}

/**
 * Ancre d'un constat : le bandeau de son correctif quand celui-ci est dans le
 * diff, sinon la première ligne visible de sa plage, sinon le bandeau du
 * correctif appliqué qui retire sa première ligne affichée. Null quand aucune
 * de ses lignes n'est affichée.
 */
export function findingAnchor(
  entry: NumberedFinding,
  fixes: Map<string, FixDisplay>,
  shown: ReadonlySet<number>,
  removed: ReadonlyMap<number, NumberedFinding>,
): DiffAnchor | null {
  if (fixes.get(entry.finding.id)?.state === 'shown') return { kind: 'fix', entry }
  for (let line = entry.startLine; line <= entry.endLine; line++) {
    if (shown.has(line) && !removed.has(line)) return { kind: 'line', line }
  }
  const first = firstShownLine(shown, entry.startLine, entry.endLine)
  return first === null ? null : lineAnchorOf(first, removed)
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

/** Lignes proposées par le correctif de `entry`. */
function proposedRows(entry: NumberedFinding): DiffRow[] {
  return splitLines(entry.finding.suggestion ?? '').map((text) => ({ kind: 'fix-line', text, entry, bar: barOf(entry.finding) }))
}

/** Explications de `path`, dans l'ordre de leur première ligne, côté ancien avant côté nouveau à ligne égale. */
export function explanationsOfFile(analysis: Analysis, path: string): Explanation[] {
  return analysis.explanations
    .filter((explanation) => explanation.location.path === path)
    .sort(
      (a, b) =>
        a.location.startLine - b.location.startLine ||
        (a.location.side === b.location.side ? 0 : a.location.side === 'old' ? -1 : 1) ||
        a.location.endLine - b.location.endLine,
    )
}

/**
 * Vrai quand `line` appartient au côté et à la plage de lignes de `explanation` :
 * numéro du côté « nouveau » pour le côté `new`, numéro du côté « ancien » d'une
 * ligne supprimée ou de contexte pour le côté `old`.
 */
function coversLine(explanation: Explanation, line: DiffLine): boolean {
  const { side, startLine, endLine } = explanation.location
  const number = side === 'new' ? line.newNo : line.type === 'add' ? null : line.oldNo
  return number !== null && number >= startLine && number <= endLine
}

/** Élément du diff sur lequel s'aligne la carte d'une explication, et sa position parmi les autres cartes. */
export interface ExplanationAnchor {
  selector: string
  /** Position en numéros du côté « nouveau », comparable à `anchorOrder`. */
  order: number
}

/**
 * Ancre de la carte d'une explication : la première ligne du diff qu'elle couvre.
 * Une ligne du côté « nouveau » s'aligne comme celle d'un constat, bandeau du
 * correctif appliqué qui la retire compris ; une ligne supprimée s'aligne par son
 * numéro du côté « ancien » et se range juste avant la ligne suivante du bloc.
 * Null quand aucune des lignes couvertes n'est affichée.
 */
export function explanationAnchor(
  fileDiff: FileDiff,
  explanation: Explanation,
  removed: ReadonlyMap<number, NumberedFinding>,
): ExplanationAnchor | null {
  for (const hunk of fileDiff.hunks) {
    const index = hunk.lines.findIndex((line) => coversLine(explanation, line))
    if (index === -1) continue
    const line = hunk.lines[index]
    if (line.newNo !== null) {
      const anchor = lineAnchorOf(line.newNo, removed)
      return { selector: anchorSelector(anchor), order: anchorOrder(anchor) }
    }
    const next = hunk.lines.slice(index).find((entry) => entry.newNo !== null)
    const previous = hunk.lines.slice(0, index).findLast((entry) => entry.newNo !== null)
    const order = next ? next.newNo! - 0.25 : previous ? previous.newNo! + 0.25 : hunk.newStart
    return { selector: oldLineAnchor(line.oldNo!), order }
  }
  return null
}

/**
 * Lignes du diff, bloc par bloc, avec les correctifs affichés insérés à leur
 * place. En mode `before-after` : bandeau avant la première ligne visée, lignes
 * visées barrées, lignes proposées après la dernière ligne visée. En mode
 * `applied` : bandeau et lignes proposées à la place des lignes visées, qui ne
 * sont pas affichées. En mode `off`, `fixes` n'affiche aucun correctif. Les
 * lignes couvertes par une des `explanations` sont marquées.
 */
export function buildDiffRows(
  fileDiff: FileDiff,
  numbered: NumberedFinding[],
  fixes: Map<string, FixDisplay>,
  mode: FixMode,
  explanations: Explanation[],
): HunkRows[] {
  const shown = shownLineNumbers(fileDiff)
  const removed = appliedRemovals(numbered, fixes, mode)
  const placed = numbered.filter((entry) => fixes.get(entry.finding.id)?.state === 'shown')
  const pillsByLine = new Map<number, NumberedFinding[]>()
  const pillsByFix = new Map<string, NumberedFinding[]>()
  for (const entry of numbered) {
    if (fixes.get(entry.finding.id)?.state === 'shown') continue
    const anchor = findingAnchor(entry, fixes, shown, removed)
    if (anchor?.kind === 'line') pillsByLine.set(anchor.line, [...(pillsByLine.get(anchor.line) ?? []), entry])
    if (anchor?.kind === 'fix') {
      const id = anchor.entry.finding.id
      pillsByFix.set(id, [...(pillsByFix.get(id) ?? []), entry])
    }
  }
  const strip = (entry: NumberedFinding): DiffRow => ({
    kind: 'fix-strip',
    entry,
    bar: barOf(entry.finding),
    pills: pillsByFix.get(entry.finding.id) ?? [],
  })

  return fileDiff.hunks.map((hunk) => {
    const rows: DiffRow[] = []
    for (const line of hunk.lines) {
      const lineNo = line.newNo
      const fix = lineNo === null ? undefined : placed.find((entry) => lineNo >= entry.startLine && lineNo <= entry.endLine)

      if (mode === 'applied' && fix) {
        if (fix.startLine === lineNo) rows.push(strip(fix), ...proposedRows(fix))
        continue
      }

      if (fix && fix.startLine === lineNo) rows.push(strip(fix))
      rows.push({
        kind: 'line',
        line,
        replaced: fix !== undefined && line.type !== 'del',
        explained: explanations.some((explanation) => coversLine(explanation, line)),
        bar: fix ? barOf(fix.finding) : lineNo === null ? null : lineBar(numbered, lineNo),
        pills: lineNo === null ? [] : (pillsByLine.get(lineNo) ?? []),
      })
      if (fix && fix.endLine === lineNo) rows.push(...proposedRows(fix))
    }
    return { hunk, rows }
  })
}

/** Sélecteur de l'élément du diff sur lequel s'aligne une carte de la marge. */
export function lineAnchor(line: number): string {
  return `[data-line="${line}"]`
}

/** Sélecteur d'une ligne supprimée, par son numéro du côté « ancien ». */
export function oldLineAnchor(line: number): string {
  return `[data-old-line="${line}"]`
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
