import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type RefObject } from 'react'
import type { Note } from '@shared/schemas/analysis.schema'
import { NoteCard } from '../components/Notes'
import { Icon } from '../components/Icon'
import { plural } from '../utils/format'
import type { MarginItem } from './margin-items'

interface ZenRailProps {
  /** Cartes du fichier ; celles sans ancre dans le diff vont dans le groupe du haut du rail. */
  items: MarginItem[]
  fileNotes: Note[]
  /** Zone du diff où se trouvent les ancres des cartes. */
  scopeRef: RefObject<HTMLElement | null>
  /** Conteneur qui fait défiler le diff. */
  scrollRef: RefObject<HTMLElement | null>
}

/** Écart minimal entre deux repères du rail, en pixels ; plus proches, ils n'en forment qu'un. */
const MARKER_GAP = 14
/** Délai avant la fermeture d'une carte non épinglée quand le pointeur la quitte, en millisecondes. */
const CLOSE_DELAY = 200
/** Débord de la carte au-dessus (ou au-dessous) de son repère, en pixels. */
const POPOVER_OVERLAP = 22
/** Marge entre la carte et les bords du rail, en pixels. */
const POPOVER_MARGIN = 8
/** Clé du groupe des cartes sans ancre, en haut du rail. */
const UNPLACED = 'unplaced'

/** Repère du rail : une ou plusieurs cartes proches, à la hauteur `top` (pixels) de la piste. */
interface Marker {
  key: string
  top: number
  items: MarginItem[]
}

/** Carte ouverte ; `pinned` la garde ouverte quand le pointeur s'en va. */
interface OpenState {
  key: string
  pinned: boolean
}

function isFormField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

/**
 * Rail des repères du mode zen, le long du bord droit de l'écran : toute sa
 * hauteur représente tout le contenu qui défile. Un repère par constat (rond,
 * couleur de sa gravité), explication (losange sarcelle) ou remarque (carré
 * violet) ; les repères trop proches n'en forment qu'un, avec leur nombre. Un
 * cadre suit la partie visible. Le survol d'un repère ouvre sa carte, avec
 * toutes ses actions, qui reste ouverte tant que le pointeur est sur le repère
 * ou la carte ; un clic sur le repère fait défiler le diff jusqu'à lui et
 * épingle la carte, comme un clic dans la carte. Échap ou un clic hors du rail
 * referme une carte épinglée. Un clic ailleurs sur la piste fait défiler le
 * diff jusqu'à l'endroit visé. En haut du rail, un groupe réunit les remarques
 * sur le fichier entier et les cartes dont les lignes ne sont pas affichées.
 */
export function ZenRail({ items, fileNotes, scopeRef, scrollRef }: ZenRailProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Haut de l'ancre de chaque carte, en fraction de la hauteur du contenu qui défile.
  const [positions, setPositions] = useState<ReadonlyMap<string, number>>(new Map())
  const [view, setView] = useState<{ top: number; height: number } | null>(null)
  const [sizes, setSizes] = useState({ root: 0, track: 0, trackTop: 0 })
  const [open, setOpen] = useState<OpenState | null>(null)

  const placed = items.filter((item) => item.anchor !== null)

  // Mesure refaite à chaque rendu et quand le diff ou le rail change de taille ; un état inchangé ne relance pas de rendu.
  useLayoutEffect(() => {
    const body = scrollRef.current
    const scope = scopeRef.current
    const root = rootRef.current
    const track = trackRef.current
    if (!body || !scope || !root || !track) return
    const updateView = () => {
      const total = body.scrollHeight
      const next = total > 0 ? { top: body.scrollTop / total, height: body.clientHeight / total } : null
      setView((previous) => (previous?.top === next?.top && previous?.height === next?.height ? previous : next))
    }
    const measure = () => {
      const total = body.scrollHeight
      const origin = body.getBoundingClientRect().top - body.scrollTop
      const next = new Map<string, number>()
      for (const item of placed) {
        const element = scope.querySelector(item.anchor!)
        if (!element) throw new Error(`Ancre introuvable dans le diff : ${item.anchor}`)
        if (total > 0) next.set(item.key, (element.getBoundingClientRect().top - origin) / total)
      }
      setPositions((previous) =>
        previous.size === next.size && [...next].every(([key, value]) => previous.get(key) === value) ? previous : next,
      )
      const nextSizes = { root: root.offsetHeight, track: track.offsetHeight, trackTop: track.offsetTop }
      setSizes((previous) =>
        previous.root === nextSizes.root && previous.track === nextSizes.track && previous.trackTop === nextSizes.trackTop
          ? previous
          : nextSizes,
      )
      updateView()
    }
    measure()
    body.addEventListener('scroll', updateView, { passive: true })
    const observer = new ResizeObserver(measure)
    observer.observe(body)
    observer.observe(scope)
    observer.observe(root)
    return () => {
      body.removeEventListener('scroll', updateView)
      observer.disconnect()
    }
  })

  useEffect(() => {
    if (!open?.pinned) return
    const close = () => setOpen(null)
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isFormField(event.target)) close()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open?.pinned])

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  const markers: Marker[] = []
  const located = placed
    .filter((item) => positions.has(item.key))
    .map((item) => ({ item, top: positions.get(item.key)! * sizes.track }))
    .sort((a, b) => a.top - b.top || a.item.line - b.item.line || a.item.rank - b.item.rank)
  for (const { item, top } of located) {
    const last = markers[markers.length - 1]
    if (last && top - last.top < MARKER_GAP) last.items.push(item)
    else markers.push({ key: item.key, top, items: [item] })
  }
  const unplaced = items.filter((item) => item.anchor === null)
  const unplacedCount = unplaced.length + fileNotes.length

  const show = (key: string) => {
    clearTimeout(closeTimer.current)
    setOpen((current) => (current?.key === key ? current : { key, pinned: false }))
  }
  const leave = () => {
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen((current) => (current?.pinned ? current : null)), CLOSE_DELAY)
  }
  const pin = (key: string) => {
    clearTimeout(closeTimer.current)
    setOpen({ key, pinned: true })
  }

  const reveal = (marker: Marker) => {
    const anchor = marker.items[0].anchor
    if (anchor) scopeRef.current?.querySelector(anchor)?.scrollIntoView({ block: 'center' })
    pin(marker.key)
  }

  /** Fait défiler le contenu pour centrer l'endroit situé à la hauteur `clientY` de la piste. */
  const onTrackPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const body = scrollRef.current
    const track = trackRef.current
    if (event.button !== 0 || event.target !== event.currentTarget || !body || !track) return
    const rect = track.getBoundingClientRect()
    const fraction = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1)
    body.scrollTop = fraction * body.scrollHeight - body.clientHeight / 2
  }

  let popover: { y: number; content: ReactNode } | null = null
  if (open?.key === UNPLACED && unplacedCount > 0) {
    popover = {
      y: 20,
      content: (
        <>
          {fileNotes.length > 0 && (
            <section className="zen-popover-section">
              <h3 className="block-title">Sur le fichier entier</h3>
              {fileNotes.map((note) => (
                <NoteCard key={note.id} note={note} />
              ))}
            </section>
          )}
          {unplaced.length > 0 && (
            <section className="zen-popover-section">
              <h3 className="block-title">Hors des lignes affichées du diff</h3>
              {unplaced.map((item) => (
                <Fragment key={item.key}>{item.content}</Fragment>
              ))}
            </section>
          )}
        </>
      ),
    }
  }
  const openMarker = open === null ? undefined : markers.find((marker) => marker.key === open.key)
  if (openMarker) {
    popover = {
      y: sizes.trackTop + openMarker.top,
      content: openMarker.items.map((item) => <Fragment key={item.key}>{item.content}</Fragment>),
    }
  }

  const popoverStyle = (y: number): CSSProperties =>
    y > sizes.root / 2
      ? { bottom: Math.max(sizes.root - y - POPOVER_OVERLAP, POPOVER_MARGIN), maxHeight: y + POPOVER_OVERLAP - POPOVER_MARGIN }
      : { top: Math.max(y - POPOVER_OVERLAP, POPOVER_MARGIN), maxHeight: sizes.root - Math.max(y - POPOVER_OVERLAP, POPOVER_MARGIN) - POPOVER_MARGIN }

  return (
    <aside className="zen-rail" ref={rootRef} aria-label="Repères des constats, explications et remarques">
      <div className="zen-rail-slot">
        {unplacedCount > 0 && (
          <button
            type="button"
            className={`zen-rail-group${open?.key === UNPLACED ? ' is-open' : ''}`}
            title="Remarques sur le fichier et cartes hors des lignes affichées"
            aria-label={plural(unplacedCount, 'élément hors du diff', 'éléments hors du diff')}
            onPointerEnter={() => show(UNPLACED)}
            onPointerLeave={leave}
            onFocus={() => show(UNPLACED)}
            onBlur={leave}
            onClick={() => pin(UNPLACED)}
          >
            <Icon name="list" color="#9aa1b1" />
            <span className="zen-rail-group-count">{unplacedCount}</span>
          </button>
        )}
      </div>
      <div className="zen-rail-track" ref={trackRef} onPointerDown={onTrackPointerDown}>
        {view && <div className="zen-rail-view" style={{ top: `${view.top * 100}%`, height: `${view.height * 100}%` }} />}
        {markers.map((marker) => {
          const lead = marker.items.find((item) => item.kind === 'finding') ?? marker.items[0]
          return (
            <button
              key={marker.key}
              type="button"
              className={`zen-marker is-${lead.kind}${open?.key === marker.key ? ' is-open' : ''}`}
              style={{ top: marker.top, '--marker': lead.color } as CSSProperties}
              aria-label={marker.items.map((item) => item.label).join(' ; ')}
              onPointerEnter={() => show(marker.key)}
              onPointerLeave={leave}
              onFocus={() => show(marker.key)}
              onBlur={leave}
              onClick={() => reveal(marker)}
            >
              {marker.items.length > 1 && <span className="zen-marker-count">{marker.items.length}</span>}
            </button>
          )
        })}
      </div>
      {popover && open && (
        <div
          className="zen-popover"
          style={popoverStyle(popover.y)}
          onPointerEnter={() => show(open.key)}
          onPointerLeave={leave}
          onPointerDown={() => pin(open.key)}
        >
          {popover.content}
        </div>
      )}
    </aside>
  )
}
