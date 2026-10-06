import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from './Icon'

/** Choix d'un menu : icône, libellé et description d'une ligne. */
export interface MenuOption {
  icon: IconName
  label: string
  description: string
}

interface OptionMenuProps<T extends string> {
  /** Nom du réglage : infobulle du bouton et titre de la liste. */
  label: string
  options: Record<T, MenuOption>
  value: T
  onChange: (value: T) => void
  /** Choix indisponibles, avec la raison affichée à la place de leur description. */
  disabled?: Partial<Record<T, string>>
}

/**
 * Bouton qui affiche la valeur courante d'un réglage ; un clic ouvre la liste
 * de ses choix, chacun avec son icône et sa description. Un clic hors du menu,
 * Échap, un défilement ou un redimensionnement de la fenêtre le referme.
 */
export function OptionMenu<T extends string>({ label, options, value, onChange, disabled }: OptionMenuProps<T>) {
  // Position de la liste ouverte, alignée sur le bord droit du bouton ; null quand elle est fermée.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null)
  const open = anchor !== null
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const close = () => setAnchor(null)
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const toggle = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    setAnchor(open || !rect ? null : { top: rect.bottom + 6, right: window.innerWidth - rect.right })
  }
  const current = options[value]
  return (
    <div className="option-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`option-menu-button${open ? ' is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={label}
        onClick={toggle}
      >
        <Icon name={current.icon} color={open ? '#c3caff' : '#9aa1b1'} />
        <span className="option-menu-value">{current.label}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} color={open ? '#9aa1b1' : '#646b7b'} />
      </button>
      {anchor && (
        <div className="option-menu-list" role="listbox" aria-label={label} style={anchor}>
          <div className="option-menu-title">{label}</div>
          {(Object.keys(options) as T[]).map((entry) => {
            const option = options[entry]
            const reason = disabled?.[entry]
            const selected = entry === value
            return (
              <button
                key={entry}
                type="button"
                role="option"
                aria-selected={selected}
                className={`option-menu-item${selected ? ' is-selected' : ''}`}
                disabled={reason !== undefined}
                onClick={() => {
                  setAnchor(null)
                  onChange(entry)
                }}
              >
                <Icon name={option.icon} color={selected ? '#c3caff' : '#9aa1b1'} />
                <span className="option-menu-item-text">
                  <span className="option-menu-item-label">{option.label}</span>
                  <span className="option-menu-item-description">{reason ?? option.description}</span>
                </span>
                {selected && <Icon name="check" color="#c3caff" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
