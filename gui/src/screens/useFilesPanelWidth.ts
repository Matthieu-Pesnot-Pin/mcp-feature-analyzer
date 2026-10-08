import { useCallback, useRef, useState } from 'react'

/** Largeur du panneau des fichiers, en pixels : par défaut et bornes du réglage. */
export const FILES_PANEL_WIDTH = { default: 280, min: 200, max: 600 }

const STORAGE_KEY = 'feature-analyzer.files-panel-width'

/** Largeur bornée entre le minimum et le maximum du réglage, arrondie au pixel. */
export function clampFilesPanelWidth(width: number): number {
  return Math.round(Math.min(Math.max(width, FILES_PANEL_WIDTH.min), FILES_PANEL_WIDTH.max))
}

/** Largeur enregistrée dans le navigateur ; la largeur par défaut quand rien n'est enregistré. */
function storedWidth(): number {
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY))
    return value > 0 ? clampFilesPanelWidth(value) : FILES_PANEL_WIDTH.default
  } catch {
    return FILES_PANEL_WIDTH.default
  }
}

function storeWidth(width: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(width))
  } catch {
    // Stockage du navigateur indisponible : la largeur vaut pour la page ouverte.
  }
}

/** Nouvelle largeur, ou fonction qui la calcule à partir de la largeur courante. */
export type WidthUpdate = number | ((current: number) => number)

/**
 * Largeur du panneau des fichiers, réglée par le relecteur et conservée dans le
 * navigateur d'un rechargement à l'autre. `setWidth` borne la valeur entre
 * 200 et 600 px et l'enregistre.
 */
export function useFilesPanelWidth(): { width: number; setWidth: (update: WidthUpdate) => void } {
  const [width, setState] = useState(storedWidth)
  const current = useRef(width)
  const setWidth = useCallback((update: WidthUpdate) => {
    const value = clampFilesPanelWidth(typeof update === 'function' ? update(current.current) : update)
    current.current = value
    setState(value)
    storeWidth(value)
  }, [])
  return { width, setWidth }
}
