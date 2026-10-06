import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from 'react'
import { NOTE_STYLE, SEVERITY_STYLES } from '@shared/labels'
import type { MinimapChangeKind, MinimapDot, MinimapModel } from './review-diff-model'

interface DiffMinimapProps {
  model: MinimapModel
  /** Rangées du diff que la carte représente. */
  rowsRef: RefObject<HTMLDivElement | null>
  /** Conteneur qui fait défiler le diff. */
  scrollRef: RefObject<HTMLDivElement | null>
  /** Hauteur de la barre d'outils collée en haut du diff, qui masque le haut du conteneur. */
  toolbarHeight: number
}

/** Marge entre les bords de la carte et ses pistes (`.diff-minimap-inner`), en pixels. */
const TRACK_INSET = 4

/** Débord de l'infobulle au-delà du haut du repère survolé, vers le haut ou vers le bas selon sa moitié de carte. */
const TOOLTIP_OVERLAP = 6

/** Zone du conteneur où les rangées sont visibles, en coordonnées d'écran. */
function visibleArea(body: HTMLElement, toolbarHeight: number) {
  const rect = body.getBoundingClientRect()
  return { top: rect.top + toolbarHeight, bottom: rect.bottom }
}

/** Infobulle d'un repère survolé, à la hauteur `top` (pixels) de la carte. */
interface Hover {
  top: number
  color: string
  title: string
  detail: string | null
}

function dotHover(dot: MinimapDot): Omit<Hover, 'top'> {
  if (dot.kind === 'note') return { color: NOTE_STYLE.color, title: `Remarque · ligne ${dot.line}`, detail: null }
  const { finding, number } = dot.entry
  return { color: SEVERITY_STYLES[finding.severity].color, title: `Constat ${number} · ${SEVERITY_STYLES[finding.severity].label}`, detail: finding.title }
}

/**
 * Mini-carte du fichier entier, le long du bord droit du diff : toute sa
 * hauteur représente toutes les rangées affichées. Piste de gauche : suites de
 * lignes ajoutées, supprimées ou réindentées ; piste de droite : un point par
 * constat, de la couleur de sa gravité, et par remarque. Un cadre suit la
 * portion visible. Un clic ou un glissé fait défiler le diff jusqu'au point
 * visé ; le survol d'un repère affiche sa description.
 */
export function DiffMinimap({ model, rowsRef, scrollRef, toolbarHeight }: DiffMinimapProps) {
  const innerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [trackHeight, setTrackHeight] = useState(0)
  const [view, setView] = useState<{ top: number; height: number } | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  // Haut de chaque rangée affichée puis bas de la dernière, en fraction de la hauteur des rangées.
  const [positions, setPositions] = useState<number[] | null>(null)

  useLayoutEffect(() => {
    const rows = rowsRef.current
    if (!rows) return
    const measure = () => {
      const height = rows.offsetHeight
      const elements = rows.querySelectorAll<HTMLElement>(':scope > .hunk > :not(.hunk-header)')
      if (height === 0 || elements.length === 0) return setPositions(null)
      const tops = Array.from(elements, (element) => element.offsetTop / height)
      const last = elements[elements.length - 1]
      setPositions([...tops, (last.offsetTop + last.offsetHeight) / height])
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(rows)
    return () => observer.disconnect()
  }, [rowsRef, model])

  useEffect(() => {
    const body = scrollRef.current
    const rows = rowsRef.current
    if (!body || !rows) return
    const update = () => {
      const area = visibleArea(body, toolbarHeight)
      const rect = rows.getBoundingClientRect()
      setTrackHeight(Math.max(Math.min(area.bottom - area.top, rect.height), 0))
      if (rect.height === 0) return setView(null)
      const top = Math.max(area.top, rect.top)
      const bottom = Math.min(area.bottom, rect.bottom)
      setView({ top: (top - rect.top) / rect.height, height: Math.max(bottom - top, 0) / rect.height })
    }
    update()
    body.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(body)
    observer.observe(rows)
    return () => {
      body.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [scrollRef, rowsRef, toolbarHeight])

  /** Fait défiler le diff pour centrer la rangée située à la hauteur `clientY` de la carte. */
  const scrollToPointer = (clientY: number) => {
    const body = scrollRef.current
    const rows = rowsRef.current
    const inner = innerRef.current
    if (!body || !rows || !inner) return
    const track = inner.getBoundingClientRect()
    const fraction = Math.min(Math.max((clientY - track.top) / track.height, 0), 1)
    const area = visibleArea(body, toolbarHeight)
    const rect = rows.getBoundingClientRect()
    body.scrollTop += rect.top + fraction * rect.height - (area.top + area.bottom) / 2
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    dragging.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    setHover(null)
    scrollToPointer(event.clientY)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) scrollToPointer(event.clientY)
  }
  const onPointerUp = () => {
    dragging.current = false
  }

  const showHover = (top: number, content: Omit<Hover, 'top'>) => {
    if (!dragging.current) setHover({ top: TRACK_INSET + top * (trackHeight - 2 * TRACK_INSET), ...content })
  }
  const at = (row: number) => positions?.[row] ?? 0

  return (
    <div className="diff-minimap">
      <div className="diff-minimap-track" style={{ top: toolbarHeight, height: trackHeight }}>
        <div
          ref={innerRef}
          className="diff-minimap-inner"
          aria-hidden="true"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => setHover(null)}
        >
          <div className="minimap-lane is-changes">
            {positions &&
              model.changes.map((change, index) => (
                <span
                  key={index}
                  className={`minimap-change is-${change.kind}`}
                  style={{ top: `${at(change.start) * 100}%`, height: `${(at(change.end) - at(change.start)) * 100}%` }}
                  onPointerEnter={() => showHover(at(change.start), { color: changeColor(change.kind), title: change.label, detail: null })}
                />
              ))}
          </div>
          <div className="minimap-lane is-dots">
            {positions &&
              model.dots.map((dot) => (
                <span
                  key={dot.kind === 'note' ? `note-${dot.line}` : dot.entry.finding.id}
                  className={`minimap-dot is-${dot.kind}${dot.kind === 'finding' && dot.entry.finding.status !== 'open' ? ' is-muted' : ''}`}
                  style={{ top: `${at(dot.row) * 100}%`, '--dot': dotHover(dot).color } as CSSProperties}
                  onPointerEnter={() => showHover(at(dot.row), dotHover(dot))}
                />
              ))}
          </div>
          {view && <div className="minimap-view" style={{ top: `${view.top * 100}%`, height: `${view.height * 100}%` }} />}
        </div>
        {hover && (
          <div
            className="minimap-tooltip"
            style={hover.top > trackHeight / 2 ? { bottom: trackHeight - hover.top - TOOLTIP_OVERLAP } : { top: hover.top - TOOLTIP_OVERLAP }}
          >
            <span className="minimap-tooltip-title">
              <span className="minimap-tooltip-swatch" style={{ background: hover.color }} />
              {hover.title}
            </span>
            {hover.detail && <span className="minimap-tooltip-detail">{hover.detail}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

/** Fond de la pastille de l'infobulle d'un changement, identique à celui de son repère. */
function changeColor(kind: MinimapChangeKind): string {
  switch (kind) {
    case 'add':
      return 'var(--add)'
    case 'del':
      return 'var(--del)'
    case 'mod':
      return 'linear-gradient(90deg, var(--del) 50%, var(--add) 50%)'
    case 'reindent':
      return 'var(--accent-soft)'
  }
}
