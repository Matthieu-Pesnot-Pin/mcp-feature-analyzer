import { useIPC } from './hooks/useIPC'
import { useAnalysisStore } from './store/useAnalysisStore'

export default function App() {
  useIPC()
  const connected = useAnalysisStore((state) => state.connected)
  const config = useAnalysisStore((state) => state.config)
  const error = useAnalysisStore((state) => state.error)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Feature Analyzer
        </div>
        <div className="topbar-spacer" />
        <div className="connection" title={error ?? undefined}>
          <span className={`connection-dot${connected ? ' is-connected' : ''}`} />
          {connected ? 'Connecté' : 'Déconnecté'}
          {config && <span>· v{config.version}</span>}
        </div>
      </header>

      <main className="main">
        <div className="empty-state">
          <div className="empty-card">
            <p>
              Aucune analyse pour l'instant. L'agent en crée une avec l'outil <code>create_analysis</code>.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
