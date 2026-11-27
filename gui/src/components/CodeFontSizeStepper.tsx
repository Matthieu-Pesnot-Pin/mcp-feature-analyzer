import { useState, type KeyboardEvent } from 'react'
import { CODE_FONT_SIZE, clampCodeFontSize } from '../screens/review-diff-model'
import { Icon } from './Icon'

interface CodeFontSizeStepperProps {
  size: number
  onChange: (size: number) => void
}

function formatSize(size: number): string {
  return String(size).replace('.', ',')
}

/**
 * Réglage de la taille du texte du code : « − » et « + » changent la taille d'un pas ;
 * entre les deux, la saisie prend une valeur en pixels, appliquée à Entrée ou à la
 * sortie du champ. Une saisie qui n'est pas un nombre rétablit la taille courante.
 */
export function CodeFontSizeStepper({ size, onChange }: CodeFontSizeStepperProps) {
  // Saisie en cours ; null quand le champ affiche la taille courante.
  const [draft, setDraft] = useState<string | null>(null)

  const commit = () => {
    if (draft === null) return
    const parsed = Number(draft.trim().replace(',', '.'))
    setDraft(null)
    if (draft.trim() !== '' && Number.isFinite(parsed)) onChange(clampCodeFontSize(parsed))
  }
  const step = (delta: 1 | -1) => onChange(clampCodeFontSize(size + delta * CODE_FONT_SIZE.step))
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') commit()
    else if (event.key === 'Escape') setDraft(null)
    else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      setDraft(null)
      step(event.key === 'ArrowUp' ? 1 : -1)
    }
  }

  return (
    <div className="font-size-stepper" role="group" aria-label="Taille du code" title="Taille du code, en pixels">
      <button
        type="button"
        className="font-size-stepper-button"
        disabled={size <= CODE_FONT_SIZE.min}
        aria-label="Réduire la taille du code"
        onClick={() => step(-1)}
      >
        <Icon name="minus" size={13} />
      </button>
      <input
        className="font-size-stepper-input"
        type="text"
        inputMode="decimal"
        value={draft ?? formatSize(size)}
        aria-label="Taille du code en pixels"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className="font-size-stepper-button"
        disabled={size >= CODE_FONT_SIZE.max}
        aria-label="Agrandir la taille du code"
        onClick={() => step(1)}
      >
        <Icon name="plus" size={13} />
      </button>
    </div>
  )
}
