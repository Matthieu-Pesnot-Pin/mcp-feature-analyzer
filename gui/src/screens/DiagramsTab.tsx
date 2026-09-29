import { useEffect, useEffectEvent, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Analysis, Diagram, DiagramNode, Severity } from '@shared/schemas/analysis.schema'
import { NODE_STATUS_STYLES, SEVERITY_STYLES } from '@shared/labels'
import {
  BOX_RADIUS,
  DETAIL_FONT,
  ICON_SLOT,
  NODE_PADDING_X,
  PILL_PADDING_X,
  hasFileIcon,
  labelFont,
  layoutDiagram,
  showsDetailLine,
  type DiagramLayout,
  type LaidOutNode,
} from '@shared/diagram-layout'
import { Icon } from '../components/Icon'
import { relativeTime } from '../utils/format'
import { hrefs, navigate } from '../utils/router'
import {
  DIAGRAM_KIND_ICONS,
  ZOOM_STEP,
  canvasHeight,
  clampViewport,
  diamondPoints,
  fileIconOf,
  fitViewport,
  linkPath,
  openSeverityByPath,
  overflows,
  panBy,
  presentStatuses,
  viewBoxOf,
  zoomAround,
  type Viewport,
} from './diagram-model'

/** Couleur des liens et de leurs flèches. */
const LINK_COLOR = '#3a4052'
/** Déplacement du pointeur au-delà duquel un appui devient un glissement. */
const DRAG_THRESHOLD = 3
/** Facteur de zoom d'un cran de molette. */
const WHEEL_STEP = 1.1

type LayoutResult = { layout: DiagramLayout; error: null } | { layout: null; error: string }

function computeLayout(diagram: Diagram): LayoutResult {
  try {
    return { layout: layoutDiagram(diagram), error: null }
  } catch (err) {
    return { layout: null, error: (err as Error).message }
  }
}

/** Onglet Schémas : sélecteur des schémas de l'analyse et rendu du schéma choisi. */
export function DiagramsTab({ analysis }: { analysis: Analysis }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const diagram = analysis.diagrams.find((entry) => entry.id === selectedId) ?? analysis.diagrams[0]

  if (!diagram) {
    return (
      <div className="card diagram-empty">
        <h2 className="empty-title">Aucun schéma pour cette analyse</h2>
        <p>
          L'agent dessine les schémas avec l'outil <code>set_diagram</code> : périmètre d'impact en couches, flux de process
          ou carte mentale. Ils apparaîtront ici automatiquement.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="diagram-picker">
        {analysis.diagrams.map((entry) => {
          const active = entry.id === diagram.id
          return (
            <button
              key={entry.id}
              type="button"
              className={`diagram-pick${active ? ' is-active' : ''}`}
              aria-pressed={active}
              onClick={() => setSelectedId(entry.id)}
            >
              <Icon name={DIAGRAM_KIND_ICONS[entry.kind]} color={active ? '#8b97ff' : '#646b7b'} />
              {entry.title}
            </button>
          )
        })}
        <span className="spacer" />
        <span className="diagram-meta">Dessiné par l'agent · {relativeTime(diagram.updatedAt)}</span>
      </div>
      <DiagramView key={diagram.id} analysis={analysis} diagram={diagram} />
    </>
  )
}

function DiagramView({ analysis, diagram }: { analysis: Analysis; diagram: Diagram }) {
  const result = useMemo(() => computeLayout(diagram), [diagram])
  if (result.error !== null) {
    return (
      <div className="card diagram-error" role="alert">
        <Icon name="triangle-alert" color="#f0625a" size={16} />
        <div>
          <p className="diagram-error-title">Ce schéma ne peut pas être affiché.</p>
          <p className="diagram-error-text">{result.error}</p>
          <p className="diagram-error-text">L'agent doit le corriger avec l'outil set_diagram.</p>
        </div>
      </div>
    )
  }
  return <DiagramCanvas analysis={analysis} diagram={diagram} layout={result.layout} />
}

function DiagramCanvas({ analysis, diagram, layout }: { analysis: Analysis; diagram: Diagram; layout: DiagramLayout }) {
  const areaRef = useRef<HTMLDivElement>(null)
  const [areaWidth, setAreaWidth] = useState(0)
  const height = areaWidth > 0 ? canvasHeight(layout, areaWidth) : 0
  // Vue choisie par l'utilisateur, valable tant que les dimensions du schéma et de la zone ne changent pas.
  const [view, setView] = useState<{ key: string; viewport: Viewport } | null>(null)
  const drag = useRef<{ x: number; y: number; origin: Viewport; moved: boolean; pointerId: number } | null>(null)
  const suppressClick = useRef(false)

  const severities = useMemo(() => openSeverityByPath(analysis), [analysis])
  const boxById = useMemo(() => new Map(layout.nodes.map((box) => [box.id, box])), [layout])
  const statuses = presentStatuses(diagram.nodes)
  const hasDots = diagram.nodes.some((node) => node.location && severities.has(node.location.path))
  const markerId = `arrow-${diagram.id}`
  const arrows = diagram.kind === 'flow'

  useEffect(() => {
    const element = areaRef.current
    if (!element) return
    const observer = new ResizeObserver(() => setAreaWidth(element.clientWidth))
    observer.observe(element)
    setAreaWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])

  const fitKey = `${layout.width}x${layout.height}@${areaWidth}x${height}`
  const fitted = areaWidth > 0 ? fitViewport(layout, areaWidth, height) : null
  const viewport = view && view.key === fitKey ? view.viewport : fitted
  const setViewport = (change: (current: Viewport) => Viewport) => {
    if (viewport) setView({ key: fitKey, viewport: clampViewport(change(viewport), layout, areaWidth, height) })
  }
  const pannable = viewport !== null && overflows(layout, viewport, areaWidth, height)

  // Molette : zoom autour du pointeur (écouteur non passif pour bloquer le défilement de la page).
  const onWheel = useEffectEvent((event: WheelEvent) => {
    const element = areaRef.current
    if (!element) return
    event.preventDefault()
    const rect = element.getBoundingClientRect()
    const factor = event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP
    setViewport((current) => zoomAround(current, factor, { x: event.clientX - rect.left, y: event.clientY - rect.top }))
  })
  useEffect(() => {
    const element = areaRef.current
    if (!element) return
    const listener = (event: WheelEvent) => onWheel(event)
    element.addEventListener('wheel', listener, { passive: false })
    return () => element.removeEventListener('wheel', listener)
  }, [])

  const zoomCenter = (factor: number) =>
    setViewport((current) => zoomAround(current, factor, { x: areaWidth / 2, y: height / 2 }))

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || !viewport) return
    drag.current = { x: event.clientX, y: event.clientY, origin: viewport, moved: false, pointerId: event.pointerId }
    suppressClick.current = false
  }
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    const dx = event.clientX - state.x
    const dy = event.clientY - state.y
    if (!state.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      state.moved = true
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    setView({ key: fitKey, viewport: clampViewport(panBy(state.origin, dx, dy), layout, areaWidth, height) })
  }
  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    suppressClick.current = state.moved
    drag.current = null
  }

  const open = (node: DiagramNode) => {
    if (suppressClick.current || !node.location) return
    navigate(hrefs.review(analysis.id, node.location.path, node.location.line))
  }

  return (
    <section className="card diagram-card">
      <div ref={areaRef} className="diagram-area" style={{ height: height || undefined }}>
        {viewport && (
          <svg
            className="diagram-svg"
            width={areaWidth}
            height={height}
            viewBox={viewBoxOf(viewport, areaWidth, height)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            role="img"
            aria-label={diagram.title}
          >
            {arrows && (
              <defs>
                <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 1 1 L 9 5 L 1 9" fill="none" stroke={LINK_COLOR} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </marker>
              </defs>
            )}

            {layout.headers.map((header) => (
              <text key={header.label} className="diagram-header" x={header.x} y={header.y + 7} dominantBaseline="central">
                {header.label.toUpperCase()}
              </text>
            ))}

            {layout.links.map((link, index) => (
              <path
                key={`link-${index}`}
                className="diagram-link"
                d={linkPath(link.points)}
                stroke={LINK_COLOR}
                markerEnd={arrows ? `url(#${markerId})` : undefined}
              />
            ))}

            {layout.links.map((link, index) => {
              const label = diagram.links[index].label
              if (!label) return null
              return (
                <text
                  key={`label-${index}`}
                  className="diagram-link-label"
                  x={link.labelPosition.x}
                  y={link.labelPosition.y}
                  textAnchor={link.labelAnchor}
                  dominantBaseline="central"
                >
                  {label}
                </text>
              )
            })}

            {diagram.nodes.map((node) => (
              <DiagramNodeShape
                key={node.id}
                node={node}
                box={boxById.get(node.id)!}
                severity={node.location ? (severities.get(node.location.path) ?? null) : null}
                onOpen={open}
              />
            ))}
          </svg>
        )}
      </div>

      <div className="diagram-footer">
        <div className="diagram-legend">
          {statuses.map((status) => {
            const style = NODE_STATUS_STYLES[status]
            return (
              <span key={status} className="legend-item">
                <span
                  className="legend-swatch"
                  style={{ background: style.fill ?? 'transparent', borderColor: style.stroke }}
                />
                {style.label}
              </span>
            )
          })}
          {hasDots && (
            <span className="legend-item">
              <span className="legend-dot" style={{ background: SEVERITY_STYLES.critical.color }} />
              Constat ouvert
            </span>
          )}
        </div>
        <span className="spacer" />
        {pannable && (
          <span className="diagram-hint">
            <Icon name="move" color="#646b7b" size={12} />
            Glisser pour parcourir le schéma
          </span>
        )}
        <div className="icon-button-group diagram-zoom">
          <button type="button" className="icon-button" title="Zoom arrière" aria-label="Zoom arrière" onClick={() => zoomCenter(1 / ZOOM_STEP)}>
            <Icon name="minus" color="#9aa1b1" />
          </button>
          <button type="button" className="icon-button" title="Zoom avant" aria-label="Zoom avant" onClick={() => zoomCenter(ZOOM_STEP)}>
            <Icon name="plus" color="#9aa1b1" />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Ajuster à la fenêtre"
            aria-label="Ajuster à la fenêtre"
            onClick={() => setView(null)}
          >
            <Icon name="maximize" color="#9aa1b1" />
          </button>
        </div>
      </div>
    </section>
  )
}

interface NodeShapeProps {
  node: DiagramNode
  box: LaidOutNode
  severity: Severity | null
  onOpen: (node: DiagramNode) => void
}

function DiagramNodeShape({ node, box, severity, onOpen }: NodeShapeProps) {
  const style = NODE_STATUS_STYLES[node.status]
  const { width, height } = box
  const clickable = node.location !== null
  const missing = node.status === 'missing'
  const icon = hasFileIcon(node) ? fileIconOf(node) : null
  const detailLine = showsDetailLine(node)
  const font = labelFont(node)
  const padding = node.shape === 'pill' ? PILL_PADDING_X - 4 : NODE_PADDING_X
  const textX = icon ? padding + ICON_SLOT : width / 2
  const textY = detailLine ? height / 2 - 8 : height / 2
  const shapeProps = {
    className: 'diagram-shape',
    fill: style.fill ?? 'transparent',
    stroke: style.stroke,
    strokeWidth: missing ? 1.5 : 1,
  }
  const tooltip = [node.detail, node.location ? `${node.location.path}${node.location.line ? `:${node.location.line}` : ''}` : null]
    .filter(Boolean)
    .join('\n')

  const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen(node)
    }
  }

  return (
    <g
      className={`diagram-node${clickable ? ' is-clickable' : ''}`}
      transform={`translate(${box.x} ${box.y})`}
      onClick={clickable ? () => onOpen(node) : undefined}
      onKeyDown={clickable ? onKeyDown : undefined}
      tabIndex={clickable ? 0 : undefined}
      role={clickable ? 'link' : undefined}
    >
      {tooltip && <title>{tooltip}</title>}
      {node.shape === 'decision' ? (
        <polygon points={diamondPoints(width, height)} strokeLinejoin="round" {...shapeProps} />
      ) : (
        <rect width={width} height={height} rx={node.shape === 'pill' ? height / 2 : BOX_RADIUS} {...shapeProps} />
      )}
      {icon && (
        <g transform={`translate(${padding} ${height / 2 - 7})`}>
          <Icon name={icon} size={14} color={style.accent} />
        </g>
      )}
      <text
        x={textX}
        y={textY}
        textAnchor={icon ? 'start' : 'middle'}
        dominantBaseline="central"
        fill={style.text}
        fontSize={font.size}
        fontWeight={font.weight}
        className={font.mono ? 'diagram-label mono' : 'diagram-label'}
      >
        {node.label}
      </text>
      {detailLine && (
        <text
          x={width / 2}
          y={height / 2 + 10}
          textAnchor="middle"
          dominantBaseline="central"
          fill={style.accent}
          fontSize={DETAIL_FONT.size}
          className="diagram-label"
        >
          {node.detail}
        </text>
      )}
      {severity && (
        <circle cx={node.shape === 'decision' ? width - 22 : width - 18} cy={height / 2} r={3} fill={SEVERITY_STYLES[severity].color}>
          <title>{`Constat ${SEVERITY_STYLES[severity].label.toLowerCase()} ouvert sur ce fichier`}</title>
        </circle>
      )}
    </g>
  )
}
