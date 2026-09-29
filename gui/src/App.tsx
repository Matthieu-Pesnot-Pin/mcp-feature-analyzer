import { useEffect, type ReactNode } from 'react'
import { NoticeToast } from './components/NoticeToast'
import { TopBar } from './components/TopBar'
import { useIPC } from './hooks/useIPC'
import { FeatureScreen } from './screens/FeatureScreen'
import { FinishScreen } from './screens/FinishScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { useAnalysisStore } from './store/useAnalysisStore'
import { hrefs, navigate, useRoute, type Route } from './utils/router'

function routeAnalysisId(route: Route): string | null {
  return route.name === 'feature' || route.name === 'review' || route.name === 'finish' ? route.id : null
}

function Message({ children }: { children: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-card">{children}</div>
    </div>
  )
}

/** Accueil : ouvre l'analyse la plus récente, sinon explique comment en créer une. */
function Home() {
  const analyses = useAnalysisStore((state) => state.analyses)
  const listError = useAnalysisStore((state) => state.listError)
  const latest = analyses?.[0]?.id

  useEffect(() => {
    if (latest) navigate(hrefs.feature(latest), { replace: true })
  }, [latest])

  if (listError) return <Message><p className="error-text">{listError}</p></Message>
  if (analyses === null) return <Message><p>Chargement des analyses…</p></Message>
  if (analyses.length > 0) return null
  return (
    <Message>
      <h1 className="empty-title">Aucune analyse à revoir</h1>
      <p>
        L'agent crée une analyse avec l'outil <code>create_analysis</code> une fois la feature développée. Elle apparaîtra ici
        automatiquement.
      </p>
    </Message>
  )
}

export default function App() {
  useIPC()
  const route = useRoute()
  const current = useAnalysisStore((state) => state.current)
  const openAnalysis = useAnalysisStore((state) => state.openAnalysis)
  const routeId = routeAnalysisId(route)

  useEffect(() => {
    if (routeId) openAnalysis(routeId)
  }, [routeId, openAnalysis])

  const analysis = current && current.id === routeId ? current.analysis : null
  const loadError = current && current.id === routeId ? current.error : null

  const action =
    route.name === 'review' && analysis ? (
      <button type="button" className="button button-primary topbar-action" onClick={() => navigate(hrefs.finish(analysis.id))}>
        Terminer la revue
      </button>
    ) : null

  let screen: ReactNode
  if (route.name === 'home') {
    screen = <Home />
  } else if (route.name === 'not_found') {
    screen = (
      <Message>
        <p>
          Adresse inconnue : <code>{route.hash}</code>. <a href={hrefs.home()}>Revenir à l'accueil</a>.
        </p>
      </Message>
    )
  } else if (loadError) {
    screen = (
      <Message>
        <p className="error-text">Analyse illisible : {loadError}</p>
        <p>
          <a href={hrefs.home()}>Revenir à l'accueil</a>
        </p>
      </Message>
    )
  } else if (!analysis) {
    screen = <Message><p>Chargement de l'analyse…</p></Message>
  } else if (route.name === 'feature') {
    screen = <FeatureScreen analysis={analysis} tab={route.tab} />
  } else if (route.name === 'review') {
    screen = <ReviewScreen analysis={analysis} path={route.path} line={route.line} />
  } else {
    screen = <FinishScreen key={analysis.id} analysis={analysis} />
  }

  return (
    <div className="app">
      <TopBar currentId={routeId} action={action} />
      <main className={`main${route.name === 'review' ? ' main-fixed' : ''}`}>{screen}</main>
      <NoticeToast />
    </div>
  )
}
