import type { Analysis, AnalysisSummary, Finding, Note, Severity } from '@shared/schemas/analysis.schema'
import { MODE_LABELS, SEVERITY_STYLES } from '@shared/labels'
import { lineRange } from '@shared/text'

/** Sépare un chemin en dossier (barre finale comprise) et nom de fichier. */
export function splitPath(path: string): { folder: string; name: string } {
  const index = path.lastIndexOf('/')
  return index === -1 ? { folder: '', name: path } : { folder: path.slice(0, index + 1), name: path.slice(index + 1) }
}

/** « il y a 12 min », à partir d'une date ISO. */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (seconds < 60) return "à l'instant"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `il y a ${hours} h`
  return `il y a ${Math.round(hours / 24)} j`
}

/** « 29/09/2026 à 14:32 ». */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  const day = date.toLocaleDateString('fr-FR')
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return `${day} à ${time}`
}

/**
 * Date courte sur une ligne : « 14:32 » le jour même, « 29/09 14:32 » dans
 * l'année, « 29/09/2025 » au-delà.
 */
export function formatShortDateTime(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  if (date.toDateString() === now.toDateString()) return time
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${time}`
  }
  return date.toLocaleDateString('fr-FR')
}

/** « 1 fichier », « 3 fichiers ». */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`
}

/** Compteur d'une gravité : « 2 majeurs », « 1 détail ». */
export function severityCount(severity: Severity, count: number): string {
  return plural(count, SEVERITY_STYLES[severity].label.toLowerCase())
}

/** Qualificatif d'un constat selon sa gravité, au singulier et au pluriel. */
const SEVERITY_QUALIFIERS: Record<Severity, [string, string]> = {
  critical: ['critique', 'critiques'],
  major: ['majeur', 'majeurs'],
  minor: ['mineur', 'mineurs'],
  trivial: ['de détail', 'de détail'],
}

/** « 1 constat mineur ouvert », « 3 constats de détail ouverts ». */
export function openFindingsLabel(severity: Severity, count: number): string {
  const [singular, pluralForm] = SEVERITY_QUALIFIERS[severity]
  return count > 1 ? `${count} constats ${pluralForm} ouverts` : `${count} constat ${singular} ouvert`
}

/**
 * Nom de fichier découpé pour une ellipse au milieu : `head` se tronque,
 * `tail` (extension et `keep` caractères avant elle) reste toujours visible.
 */
export function middleEllipsisParts(name: string, keep = 4): { head: string; tail: string } {
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.length - dot : 0
  const cut = Math.max(0, name.length - extension - keep)
  return { head: name.slice(0, cut), tail: name.slice(cut) }
}

/** Ref affichée : un sha complet est abrégé à 7 caractères, un nom de branche ou de tag reste entier. */
export function refLabel(ref: string): string {
  return /^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref
}

/** Référence affichée d'une analyse : la ref de tête en mode `branch`, « Copie de travail » sinon. */
export function headLabel(analysis: Pick<AnalysisSummary, 'id' | 'mode' | 'head'>): string {
  if (analysis.mode === 'working_tree') return MODE_LABELS.working_tree
  if (analysis.head === null) throw new Error(`L'analyse ${analysis.id} est en mode branche sans ref de tête.`)
  return refLabel(analysis.head)
}

/** Refs d'une analyse dans une liste : « feat/x → master », ou « Copie de travail ». */
export function refsLabel(analysis: Pick<AnalysisSummary, 'id' | 'mode' | 'head' | 'base'>): string {
  if (analysis.mode === 'working_tree') return MODE_LABELS.working_tree
  return `${headLabel(analysis)} → ${refLabel(analysis.base)}`
}

/** Emplacement court d'un constat : « refreshService.ts:57 » ; sans emplacement, la source de la demande. */
export function findingLocationLabel(finding: Finding, request: Analysis['request']): string {
  const location = finding.location
  if (!location) return request?.source ? `demande ${request.source}` : 'exigence manquante'
  return `${splitPath(location.path).name}:${lineRange(location.startLine, location.endLine, '–')}`
}

/** Emplacement court d'une remarque. */
export function noteLocationLabel(note: Note): string {
  if (!note.location) return 'analyse entière'
  const name = splitPath(note.location.path).name
  return note.location.line === null ? name : `${name}:${note.location.line}`
}

/** « lignes 59–61 » ou « ligne 12 ». */
export function linesLabel(startLine: number, endLine: number): string {
  return startLine === endLine ? `ligne ${startLine}` : `lignes ${startLine}–${endLine}`
}

/** Totaux +/− des fichiers de l'analyse. */
export function diffTotals(analysis: Analysis): { additions: number; deletions: number } {
  return analysis.files.reduce(
    (totals, file) => ({ additions: totals.additions + file.additions, deletions: totals.deletions + file.deletions }),
    { additions: 0, deletions: 0 },
  )
}
