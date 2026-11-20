import { useCallback, useRef, useState } from 'react'

/** Réglage de la largeur d'un panneau : clé d'enregistrement, largeur par défaut et bornes, en pixels. */
export interface PanelWidthSetting {
  storageKey: string
  default: number
  min: number
  max: number
}

/** Panneau des fichiers, à gauche de l'écran Revue. */
export const FILES_PANEL_WIDTH: PanelWidthSetting = {
  storageKey: 'feature-analyzer.files-panel-width',
  default: 280,
  min: 200,
  max: 600,
}

/** Colonne des constats et explications, à droite de l'écran Revue. */
export const FINDINGS_PANEL_WIDTH: PanelWidthSetting = {
  storageKey: 'feature-analyzer.findings-panel-width',
  default: 400,
  min: 280,
  max: 720,
}

/** Largeur bornée entre le minimum et le maximum du réglage, arrondie au pixel. */
export function clampPanelWidth(setting: PanelWidthSetting, width: number): number {
  return Math.round(Math.min(Math.max(width, setting.min), setting.max))
}

/** Largeur enregistrée dans le navigateur ; la largeur par défaut quand rien n'est enregistré. */
function storedWidth(setting: PanelWidthSetting): number {
  try {
    const value = Number(window.localStorage.getItem(setting.storageKey))
    return value > 0 ? clampPanelWidth(setting, value) : setting.default
  } catch {
    return setting.default
  }
}

function storeWidth(setting: PanelWidthSetting, width: number): void {
  try {
    window.localStorage.setItem(setting.storageKey, String(width))
  } catch {
    // Stockage du navigateur indisponible : la largeur vaut pour la page ouverte.
  }
}

/** Nouvelle largeur, ou fonction qui la calcule à partir de la largeur courante. */
export type WidthUpdate = number | ((current: number) => number)

/**
 * Largeur d'un panneau, réglée par le relecteur et conservée dans le navigateur
 * d'un rechargement à l'autre. `setWidth` borne la valeur selon le réglage et
 * l'enregistre.
 */
export function usePanelWidth(setting: PanelWidthSetting): { width: number; setWidth: (update: WidthUpdate) => void } {
  const [width, setState] = useState(() => storedWidth(setting))
  const current = useRef(width)
  const setWidth = useCallback(
    (update: WidthUpdate) => {
      const value = clampPanelWidth(setting, typeof update === 'function' ? update(current.current) : update)
      current.current = value
      setState(value)
      storeWidth(setting, value)
    },
    [setting],
  )
  return { width, setWidth }
}
