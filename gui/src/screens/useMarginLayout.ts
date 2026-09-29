import { useLayoutEffect, type RefObject } from 'react'

/** Écart vertical minimal entre deux cartes empilées. */
const CARD_GAP = 12

/**
 * Position d'une carte : alignée sur le haut de son ancre, ou poussée sous la
 * carte précédente quand elles se chevaucheraient. Les ancres sont données
 * dans l'ordre d'affichage, en pixels depuis le haut de la piste.
 */
export function stackCards(cards: Array<{ anchorTop: number; height: number }>): number[] {
  const tops: number[] = []
  let bottom = -CARD_GAP
  for (const card of cards) {
    const top = Math.max(card.anchorTop, bottom + CARD_GAP, 0)
    tops.push(top)
    bottom = top + card.height
  }
  return tops
}

/**
 * Aligne les cartes de la piste `trackRef` sur leur ancre dans `scopeRef`.
 * Chaque carte porte dans `data-anchor` le sélecteur de son ancre ; elle reçoit
 * sa position (`top`) et son décalage par rapport à l'ancre (`--shift`, utilisé
 * par la liaison vers le diff). La piste prend la hauteur des cartes empilées.
 * Le placement est refait à chaque rendu et quand le diff ou une carte change de taille.
 */
export function useMarginLayout(trackRef: RefObject<HTMLElement | null>, scopeRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const track = trackRef.current
    const scope = scopeRef.current
    if (!track || !scope) return

    const cards = [...track.querySelectorAll<HTMLElement>(':scope > [data-anchor]')]
    const place = () => {
      const trackTop = track.getBoundingClientRect().top
      const measures = cards.map((card) => {
        const anchor = scope.querySelector(card.dataset.anchor!)
        if (!anchor) throw new Error(`Ancre introuvable dans le diff : ${card.dataset.anchor}`)
        return { anchorTop: anchor.getBoundingClientRect().top - trackTop, height: card.offsetHeight }
      })
      const tops = stackCards(measures)
      cards.forEach((card, index) => {
        card.style.top = `${tops[index]}px`
        card.style.setProperty('--shift', `${tops[index] - measures[index].anchorTop}px`)
      })
      const last = cards.length - 1
      track.style.minHeight = last < 0 ? '' : `${tops[last] + measures[last].height}px`
    }

    place()
    const observer = new ResizeObserver(place)
    observer.observe(scope)
    for (const card of cards) observer.observe(card)
    return () => observer.disconnect()
  })
}
