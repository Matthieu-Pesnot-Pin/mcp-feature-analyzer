import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** Hauteur, en bas de la zone de défilement, masquée par l'indication « plus bas ». */
const HIDDEN_BOTTOM = 40

/**
 * Identifiants des cartes de constat de `columnRef` (attribut
 * `data-finding-card`) dont le haut est sous la partie visible de `scrollRef`,
 * de la plus haute à la plus basse. Recalculé à chaque rendu, au défilement et
 * quand la zone ou la colonne change de taille.
 */
export function useFindingsBelow(scrollRef: RefObject<HTMLElement | null>, columnRef: RefObject<HTMLElement | null>): readonly string[] {
  const [below, setBelow] = useState<readonly string[]>([])
  const measureRef = useRef<() => void>(() => {})

  useLayoutEffect(() => {
    measureRef.current = () => {
      const scroller = scrollRef.current
      const column = columnRef.current
      if (!scroller || !column) return
      const limit = scroller.getBoundingClientRect().bottom - HIDDEN_BOTTOM
      const ids = [...column.querySelectorAll<HTMLElement>('[data-finding-card]')]
        .map((card) => ({ id: card.dataset.findingCard!, top: card.getBoundingClientRect().top }))
        .filter((card) => card.top > limit)
        .sort((a, b) => a.top - b.top)
        .map((card) => card.id)
      setBelow((previous) => (previous.join('\n') === ids.join('\n') ? previous : ids))
    }
    measureRef.current()
  })

  useEffect(() => {
    const scroller = scrollRef.current
    const column = columnRef.current
    if (!scroller || !column) return
    const onChange = () => measureRef.current()
    scroller.addEventListener('scroll', onChange, { passive: true })
    const observer = new ResizeObserver(onChange)
    observer.observe(scroller)
    observer.observe(column)
    return () => {
      scroller.removeEventListener('scroll', onChange)
      observer.disconnect()
    }
  }, [scrollRef, columnRef])

  return below
}
