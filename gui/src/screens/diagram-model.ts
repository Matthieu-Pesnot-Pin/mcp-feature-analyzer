import type { Analysis, DiagramKind, DiagramNode, NodeStatus, Severity } from '@shared/schemas/analysis.schema'
import { NODE_STATUSES } from '@shared/schemas/analysis.schema'
import type { DiagramLayout, Point } from '@shared/diagram-layout'
import { compareSeverity } from '@shared/severity'
import type { IconName } from '../components/Icon'

/** Icône de chaque sorte de schéma dans le sélecteur. */
export const DIAGRAM_KIND_ICONS: Record<DiagramKind, IconName> = {
  layers: 'network',
  flow: 'workflow',
  mindmap: 'brain-circuit',
}

/** Icône d'un nœud rattaché à un fichier : fiole pour un fichier de test, fichier de code sinon. */
export function fileIconOf(node: DiagramNode): IconName | null {
  if (!node.location) return null
  return /\.(spec|test)\./.test(node.location.path) ? 'flask-conical' : 'file-code'
}

/** Gravité la plus haute des constats ouverts de chaque fichier. */
export function openSeverityByPath(analysis: Analysis): Map<string, Severity> {
  const result = new Map<string, Severity>()
  for (const finding of analysis.findings) {
    if (finding.status !== 'open' || !finding.location) continue
    const current = result.get(finding.location.path)
    if (!current || compareSeverity(finding.severity, current) < 0) result.set(finding.location.path, finding.severity)
  }
  return result
}

/** Entrées de la légende : les statuts présents dans le schéma, dans l'ordre des statuts. */
export function presentStatuses(nodes: DiagramNode[]): NodeStatus[] {
  return NODE_STATUSES.filter((status) => nodes.some((node) => node.status === status))
}

/** Rayon des coins arrondis des liens coudés. */
const CORNER_RADIUS = 6

/** Tracé SVG d'une ligne brisée, coins arrondis. */
export function linkPath(points: Point[]): string {
  if (points.length === 0) return ''
  const parts = [`M ${points[0].x} ${points[0].y}`]
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1]
    const corner = points[i]
    const next = points[i + 1]
    const before = Math.hypot(corner.x - previous.x, corner.y - previous.y)
    const after = Math.hypot(next.x - corner.x, next.y - corner.y)
    const radius = Math.min(CORNER_RADIUS, before / 2, after / 2)
    if (radius <= 0) {
      parts.push(`L ${corner.x} ${corner.y}`)
      continue
    }
    const start = { x: corner.x - ((corner.x - previous.x) / before) * radius, y: corner.y - ((corner.y - previous.y) / before) * radius }
    const end = { x: corner.x + ((next.x - corner.x) / after) * radius, y: corner.y + ((next.y - corner.y) / after) * radius }
    parts.push(`L ${start.x} ${start.y}`, `Q ${corner.x} ${corner.y} ${end.x} ${end.y}`)
  }
  const last = points[points.length - 1]
  parts.push(`L ${last.x} ${last.y}`)
  return parts.join(' ')
}

/** Losange inscrit dans un rectangle de `width` × `height`. */
export function diamondPoints(width: number, height: number): string {
  return `${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`
}

/** Portion du schéma affichée : coin supérieur gauche en coordonnées du schéma et facteur de zoom. */
export interface Viewport {
  x: number
  y: number
  scale: number
}

export const MIN_SCALE = 0.2
export const MAX_SCALE = 3
/** Facteur appliqué par les boutons − et +. */
export const ZOOM_STEP = 1.25
/** Hauteur minimale et maximale de la zone de dessin. */
const MIN_CANVAS_HEIGHT = 320
const MAX_CANVAS_HEIGHT = 620

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/** Hauteur de la zone de dessin : celle du schéma ajusté à la largeur disponible, bornée. */
export function canvasHeight(layout: DiagramLayout, width: number): number {
  const scale = Math.min(1, width / layout.width)
  return Math.round(Math.min(MAX_CANVAS_HEIGHT, Math.max(MIN_CANVAS_HEIGHT, layout.height * scale)))
}

/** Vue qui montre tout le schéma, centré, sans l'agrandir au-delà de sa taille réelle. */
export function fitViewport(layout: DiagramLayout, width: number, height: number): Viewport {
  const scale = clampScale(Math.min(1, width / layout.width, height / layout.height))
  return { x: (layout.width - width / scale) / 2, y: (layout.height - height / scale) / 2, scale }
}

/** Zoom de `factor` autour du point `anchor` de la zone de dessin (en pixels écran). */
export function zoomAround(viewport: Viewport, factor: number, anchor: Point): Viewport {
  const scale = clampScale(viewport.scale * factor)
  const worldX = viewport.x + anchor.x / viewport.scale
  const worldY = viewport.y + anchor.y / viewport.scale
  return { x: worldX - anchor.x / scale, y: worldY - anchor.y / scale, scale }
}

/** Déplacement de la vue d'un glissement de `dx` × `dy` pixels écran. */
export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
  return { x: viewport.x - dx / viewport.scale, y: viewport.y - dy / viewport.scale, scale: viewport.scale }
}

/** Attribut `viewBox` de la vue. */
export function viewBoxOf(viewport: Viewport, width: number, height: number): string {
  return `${viewport.x} ${viewport.y} ${width / viewport.scale} ${height / viewport.scale}`
}
