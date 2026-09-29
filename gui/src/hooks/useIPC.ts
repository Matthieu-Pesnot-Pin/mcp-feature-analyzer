import { useEffect } from 'react'
import type { IPCMessage } from '@shared/schemas/ipc.schema'
import { useAnalysisStore } from '../store/useAnalysisStore'

const TAG = '[mcp-feature-analyzer]'

function readyStateLabel(state: number): string {
  if (state === EventSource.CONNECTING) return 'CONNECTING'
  if (state === EventSource.OPEN) return 'OPEN'
  if (state === EventSource.CLOSED) return 'CLOSED'
  return `UNKNOWN(${state})`
}

/**
 * Canal descendant serveur -> GUI : état initial à la connexion, puis
 * évènements poussés par le maître MCP quand une analyse change. Chaque
 * évènement recharge ce qui est affiché.
 */
export function useIPC() {
  useEffect(() => {
    const sseUrl = 'api/events'
    const eventSource = new EventSource(sseUrl)
    let lastDiagnosticsAt = 0

    eventSource.onopen = () => {
      useAnalysisStore.getState().setConnected(true)
      void useAnalysisStore.getState().loadConfig()
    }

    eventSource.onerror = () => {
      const state = eventSource.readyState
      const label = readyStateLabel(state)
      const hint =
        state === EventSource.CONNECTING
          ? 'Browser is reconnecting (server unreachable, proxy timeout, or network issue)'
          : state === EventSource.CLOSED
            ? 'Connection permanently closed (HTTP error, server stopped, or proxy reset)'
            : 'Stream was OPEN when error fired: transient glitch or browser quirk'

      console.error(`${TAG} SSE onerror — readyState=${label} (${state}). ${hint}`)
      useAnalysisStore.getState().setConnected(false)

      const now = Date.now()
      if (now - lastDiagnosticsAt < 8000) return
      lastDiagnosticsAt = now

      void fetch('api/client-diagnostics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mcp: 'mcp-feature-analyzer',
          kind: 'EventSource_error',
          sseUrl,
          readyState: state,
          readyStateLabel: label,
          hint,
          time: new Date().toISOString(),
        }),
      }).catch(() => {
        console.warn(`${TAG} Could not POST client-diagnostics (server probably down)`)
      })
    }

    eventSource.onmessage = (event) => {
      let message: IPCMessage
      try {
        message = JSON.parse(event.data)
      } catch (err) {
        console.error(`${TAG} SSE message is not JSON, ignored: ${(err as Error).message}`, event.data)
        return
      }

      // La liste poussée ne signale pas les analyses illisibles : elle est relue par l'API.
      const store = useAnalysisStore.getState()
      switch (message.type) {
        case 'INITIAL_STATE':
          void store.loadAnalyses()
          void store.reloadCurrent()
          return
        case 'ANALYSES_UPDATED':
          void store.loadAnalyses()
          return
        case 'ANALYSIS_UPDATED':
          if (store.current?.id === message.data.analysisId) void store.reloadCurrent()
          return
      }
    }

    return () => eventSource.close()
  }, [])
}
