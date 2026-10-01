import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

/** Délai de survol, en millisecondes, avant l'ouverture de la bulle. */
const SHOW_DELAY = 250
/** Écart, en pixels, entre le texte et la bulle. */
const GAP = 6
/** Hauteur, en pixels, en dessous de laquelle la bulle s'ouvre au-dessus du texte. */
const MIN_SPACE_BELOW = 120

/** Marge, en pixels, entre la bulle et le bord droit de la fenêtre. */
const EDGE = 16
/** Largeur maximale, en pixels, de la bulle. */
const MAX_WIDTH = 560

type Placement = { left: number; maxWidth: number } & ({ top: number } | { bottom: number })

/**
 * Texte sur une ligne, coupé par des points de suspension quand la place manque.
 * Au survol d'un texte coupé, une bulle affiche le texte entier, sous le texte,
 * ou au-dessus quand le bas de la fenêtre est trop proche. La bulle se ferme
 * quand le pointeur quitte le texte ou que la page défile.
 */
export function TruncatedText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const [placement, setPlacement] = useState<Placement | null>(null)

  const hide = () => {
    window.clearTimeout(timer.current)
    setPlacement(null)
  }

  const show = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const element = ref.current
      if (!element || element.scrollWidth <= element.clientWidth) return
      const rect = element.getBoundingClientRect()
      const horizontal = { left: rect.left, maxWidth: Math.min(MAX_WIDTH, window.innerWidth - rect.left - EDGE) }
      setPlacement(
        window.innerHeight - rect.bottom < MIN_SPACE_BELOW
          ? { ...horizontal, bottom: window.innerHeight - rect.top + GAP }
          : { ...horizontal, top: rect.bottom + GAP },
      )
    }, SHOW_DELAY)
  }

  useEffect(() => {
    if (placement === null) return
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [placement])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <>
      <span ref={ref} className={`truncated-text${className ? ` ${className}` : ''}`} onMouseEnter={show} onMouseLeave={hide}>
        {text}
      </span>
      {placement !== null &&
        createPortal(
          <span className="truncated-text-bubble" role="tooltip" style={placement satisfies CSSProperties}>
            {text}
          </span>,
          document.body,
        )}
    </>
  )
}
