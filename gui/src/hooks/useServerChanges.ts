import { useEffect } from 'react'
import type { IPCMessage } from '@shared/schemas/ipc.schema'
import { useAnalysisStore } from '../store/useAnalysisStore'
import { api } from '../utils/api'

const TAG = '[mcp-feature-analyzer]'

/** Délai entre la fin d'une interrogation de `api/changes` et la suivante. */
const POLL_INTERVAL_MS = 3000

/** Recharge ce qu'affiche la GUI pour un évènement poussé par le maître MCP. */
function applyEvent(message: IPCMessage) {
  // La liste poussée ne signale pas les analyses illisibles : elle est relue par l'API.
  const store = useAnalysisStore.getState()
  switch (message.type) {
    case 'ANALYSES_UPDATED':
      void store.loadAnalyses()
      return
    case 'ANALYSIS_UPDATED':
      if (store.current?.id === message.data.analysisId) void store.reloadCurrent()
      return
  }
}

/**
 * Canal descendant serveur -> GUI : interroge `api/changes` toutes les 3 s,
 * sans requêtes simultanées. Un `reset` (premier appel, redémarrage du worker,
 * évènements perdus) recharge tout ; sinon chaque évènement recharge ce qui
 * est affiché.
 */
export function useServerChanges() {
  useEffect(() => {
    let cursor: { epoch: string; seq: number } | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false

    async function poll() {
      try {
        const changes = await api.getChanges(cursor)
        if (stopped) return
        const store = useAnalysisStore.getState()
        if (changes.reset) {
          void store.loadConfig()
          void store.loadAnalyses()
          void store.reloadCurrent()
        } else {
          for (const event of changes.events) applyEvent(event)
        }
        cursor = { epoch: changes.epoch, seq: changes.seq }
      } catch (err) {
        console.error(`${TAG} Polling api/changes failed, retrying in ${POLL_INTERVAL_MS} ms: ${(err as Error).message}`)
      }
      if (!stopped) timer = setTimeout(poll, POLL_INTERVAL_MS)
    }

    void poll()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [])
}
