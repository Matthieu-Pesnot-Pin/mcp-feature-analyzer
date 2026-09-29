import { create } from 'zustand'
import type { Analysis, AnalysisSummary, FindingStatus, ReviewDecision } from '@shared/schemas/analysis.schema'
import type { DiffSnapshot } from '@shared/schemas/diff.schema'
import { ApiError, api } from '../utils/api'
import { copyText } from '../utils/clipboard'
import type { AppConfig, AnalysisListing } from '../types'

/** Message bref affiché en bas de l'écran. */
export interface Notice {
  id: number
  kind: 'info' | 'error'
  text: string
}

/** Analyse affichée : `analysis` est null tant qu'elle charge ou si son chargement a échoué (`error`). */
interface CurrentAnalysis {
  id: string
  analysis: Analysis | null
  error: string | null
}

/** Snapshot de diff chargé, avec la date du snapshot de l'analyse à laquelle il correspond. */
interface LoadedDiff {
  id: string
  snapshotAt: string
  snapshot: DiffSnapshot
}

interface AnalysisState {
  /** Flux SSE ouvert avec le GUI worker. */
  connected: boolean
  config: AppConfig | null
  /** Liste des analyses ; null tant qu'elle n'a pas été reçue. */
  analyses: AnalysisSummary[] | null
  unreadable: AnalysisListing['unreadable']
  listError: string | null
  current: CurrentAnalysis | null
  diff: LoadedDiff | null
  diffError: string | null
  /** Une modification est en cours d'envoi. */
  saving: boolean
  notice: Notice | null

  setConnected: (connected: boolean) => void
  loadConfig: () => Promise<void>
  setListing: (listing: AnalysisListing) => void
  loadAnalyses: () => Promise<void>
  /** Affiche l'analyse `id` : la charge si ce n'est pas déjà celle affichée. */
  openAnalysis: (id: string) => void
  /** Recharge l'analyse affichée, et son diff si le snapshot a changé. */
  reloadCurrent: () => Promise<void>
  /** Charge le diff de l'analyse affichée s'il manque ou ne correspond plus à son snapshot. */
  ensureDiff: () => Promise<void>

  setFileReviewed: (path: string, reviewed: boolean) => Promise<boolean>
  setFindingStatus: (findingId: string, status: FindingStatus) => Promise<boolean>
  addNote: (path: string, line: number | null, text: string) => Promise<boolean>
  deleteNote: (noteId: string) => Promise<boolean>
  submitReview: (decision: ReviewDecision, findingIds: string[], noteIds: string[]) => Promise<boolean>

  copy: (text: string, successMessage: string) => Promise<void>
  notify: (kind: Notice['kind'], text: string) => void
  dismissNotice: () => void
}

const NOTICE_DURATION_MS = 5000
let noticeCounter = 0
let noticeTimer: ReturnType<typeof setTimeout> | undefined

const CONFLICT_MESSAGE =
  "L'analyse a été modifiée entre-temps (par l'agent ou un autre onglet) : elle vient d'être rechargée. Vérifiez l'état affiché puis refaites votre action."

export const useAnalysisStore = create<AnalysisState>((set, get) => {
  /**
   * Envoie une modification basée sur la révision affichée et applique
   * l'analyse renvoyée. Un conflit de révision recharge l'analyse et le signale.
   */
  async function mutate(label: string, send: (analysis: Analysis) => Promise<{ analysis: Analysis }>): Promise<boolean> {
    const analysis = get().current?.analysis
    if (!analysis) return false
    set({ saving: true })
    try {
      const response = await send(analysis)
      if (get().current?.id === response.analysis.id) {
        set({ current: { id: response.analysis.id, analysis: response.analysis, error: null } })
      }
      return true
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        await get().reloadCurrent()
        get().notify('info', CONFLICT_MESSAGE)
      } else {
        get().notify('error', `${label} : ${(err as Error).message}`)
      }
      return false
    } finally {
      set({ saving: false })
    }
  }

  return {
    connected: false,
    config: null,
    analyses: null,
    unreadable: [],
    listError: null,
    current: null,
    diff: null,
    diffError: null,
    saving: false,
    notice: null,

    setConnected: (connected) => set({ connected }),

    loadConfig: async () => {
      try {
        set({ config: await api.getConfig() })
      } catch (err) {
        get().notify('error', `Configuration illisible : ${(err as Error).message}`)
      }
    },

    setListing: (listing) => set({ analyses: listing.analyses, unreadable: listing.unreadable, listError: null }),

    loadAnalyses: async () => {
      try {
        get().setListing(await api.listAnalyses())
      } catch (err) {
        set({ listError: `Liste des analyses illisible : ${(err as Error).message}` })
      }
    },

    openAnalysis: (id) => {
      if (get().current?.id === id) return
      set({ current: { id, analysis: null, error: null } })
      void get().reloadCurrent()
    },

    reloadCurrent: async () => {
      const id = get().current?.id
      if (!id) return
      try {
        const { analysis } = await api.getAnalysis(id)
        if (get().current?.id !== id) return
        set({ current: { id, analysis, error: null } })
        await get().ensureDiff()
      } catch (err) {
        if (get().current?.id !== id) return
        set({ current: { id, analysis: null, error: (err as Error).message } })
      }
    },

    ensureDiff: async () => {
      const analysis = get().current?.analysis
      if (!analysis) return
      const loaded = get().diff
      if (loaded && loaded.id === analysis.id && loaded.snapshotAt === analysis.snapshotAt) return
      try {
        const { diff } = await api.getDiff(analysis.id)
        if (get().current?.analysis?.id !== analysis.id) return
        set({ diff: { id: analysis.id, snapshotAt: analysis.snapshotAt, snapshot: diff }, diffError: null })
      } catch (err) {
        set({ diffError: `Diff illisible : ${(err as Error).message}` })
      }
    },

    setFileReviewed: (path, reviewed) =>
      mutate('Marquage du fichier impossible', (analysis) =>
        api.setFileReviewed(analysis.id, { path, reviewed, baseRevision: analysis.revision }),
      ),

    setFindingStatus: (findingId, status) =>
      mutate('Changement de statut impossible', (analysis) =>
        api.setFindingStatus(analysis.id, findingId, { status, baseRevision: analysis.revision }),
      ),

    addNote: (path, line, text) =>
      mutate('Remarque non enregistrée', (analysis) =>
        api.addNote(analysis.id, { path, line, text, baseRevision: analysis.revision }),
      ),

    deleteNote: (noteId) =>
      mutate('Suppression impossible', (analysis) => api.deleteNote(analysis.id, noteId, { baseRevision: analysis.revision })),

    submitReview: (decision, findingIds, noteIds) =>
      mutate('Retour non enregistré', (analysis) =>
        api.submitReview(analysis.id, { decision, findingIds, noteIds, baseRevision: analysis.revision }),
      ),

    copy: async (text, successMessage) => {
      try {
        await copyText(text)
        get().notify('info', successMessage)
      } catch (err) {
        get().notify('error', `Copie impossible : ${(err as Error).message}`)
      }
    },

    notify: (kind, text) => {
      clearTimeout(noticeTimer)
      set({ notice: { id: ++noticeCounter, kind, text } })
      noticeTimer = setTimeout(() => set({ notice: null }), NOTICE_DURATION_MS)
    },

    dismissNotice: () => {
      clearTimeout(noticeTimer)
      set({ notice: null })
    },
  }
})
