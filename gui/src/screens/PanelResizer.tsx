import { useState, type RefObject } from 'react'
import { clampPanelWidth, type PanelWidthSetting, type WidthUpdate } from './usePanelWidth'

/**
 * Poignée sur le bord intérieur d'un panneau latéral de `containerRef` : un
 * glissé règle sa largeur, les flèches la changent de 16 px, un double-clic la
 * remet par défaut. `side` indique le bord du conteneur où se trouve le panneau.
 * Pendant le glissé, seul `preview` met le conteneur à la largeur visée ; la
 * largeur est enregistrée au relâchement.
 */
export function PanelResizer({
  setting,
  side,
  label,
  width,
  setWidth,
  containerRef,
  preview,
}: {
  setting: PanelWidthSetting
  side: 'left' | 'right'
  label: string
  width: number
  setWidth: (update: WidthUpdate) => void
  containerRef: RefObject<HTMLElement | null>
  preview: (container: HTMLElement, width: number) => void
}) {
  const [dragging, setDragging] = useState(false)
  const widthAt = (clientX: number) => {
    const box = containerRef.current?.getBoundingClientRect()
    if (!box) return width
    return clampPanelWidth(setting, side === 'left' ? clientX - box.left : box.right - clientX)
  }
  const growKey = side === 'left' ? 'ArrowRight' : 'ArrowLeft'
  const shrinkKey = side === 'left' ? 'ArrowLeft' : 'ArrowRight'

  return (
    <div
      className={`panel-resizer is-${side}${dragging ? ' is-dragging' : ''}`}
      style={{ [side]: width }}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={setting.min}
      aria-valuemax={setting.max}
      tabIndex={0}
      title="Glisser pour régler la largeur · double-clic pour la largeur par défaut"
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
      }}
      onPointerMove={(event) => {
        const container = containerRef.current
        if (!dragging || !container) return
        const next = widthAt(event.clientX)
        preview(container, next)
        event.currentTarget.style[side] = `${next}px`
      }}
      onPointerUp={(event) => {
        if (!dragging) return
        setDragging(false)
        setWidth(widthAt(event.clientX))
      }}
      onDoubleClick={() => setWidth(setting.default)}
      onKeyDown={(event) => {
        if (event.key === growKey) setWidth((current) => current + 16)
        if (event.key === shrinkKey) setWidth((current) => current - 16)
      }}
    />
  )
}
