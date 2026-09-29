import { create } from 'zustand'
import { api } from '../utils/api'
import type { AppConfig } from '../types'

interface AnalysisState {
  /** Flux SSE ouvert avec le GUI worker. */
  connected: boolean
  config: AppConfig | null
  error: string | null
  setConnected: (connected: boolean) => void
  loadConfig: () => Promise<void>
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
  connected: false,
  config: null,
  error: null,

  setConnected: (connected) => set({ connected }),

  loadConfig: async () => {
    try {
      set({ config: await api.getConfig(), error: null })
    } catch (err) {
      set({ error: `Configuration illisible : ${(err as Error).message}` })
    }
  },
}))
