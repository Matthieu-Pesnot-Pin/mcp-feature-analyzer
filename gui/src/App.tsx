import { useEffect, type ReactNode } from 'react'
import { FinishReviewButton } from './components/FinishReviewButton'
import { NoticeToast } from './components/NoticeToast'
import { ReviewProgressMeter } from './components/ReviewProgressMeter'
import { TopBar } from './components/TopBar'
import { useServerChanges } from './hooks/useServerChanges'
import { FeatureScreen } from './screens/FeatureScreen'
import { FinishScreen } from './screens/FinishScreen'
import { HomeScreen } from './screens/HomeScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { zenApplies } from './screens/review-model'
import { useAnalysisStore } from './store/useAnalysisStore'
import { hrefs, useRoute, type Route } from './utils/router'

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

export default function App() {
  useServerChanges()
  const route = useRoute()
  const current = useAnalysisStore((state) => state.current)
  const openAnalysis = useAnalysisStore((state) => state.openAnalysis)
  const zenMode = useAnalysisStore((state) => state.zenMode)
  const routeId = routeAnalysisId(route)

  useEffect(() => {
    if (routeId) openAnalysis(routeId)
  }, [routeId, openAnalysis])

  const analysis = current && current.id === routeId ? current.analysis : null
  const loadError = current && current.id === routeId ? current.error : null
  const links = current && current.id === routeId ? current.links : null

  // En mode zen, l'écran Revue porte sa propre barre à la place de la barre supérieure.
  const zen = route.name === 'review' && analysis !== null && zenApplies(zenMode, analysis, route.path)

  const action =
    route.name === 'review' && analysis ? (
      <>
        <ReviewProgressMeter analysis={analysis} />
        <FinishReviewButton analysis={analysis} />
      </>
    ) : null

  let screen: ReactNode
  if (route.name === 'home') {
    screen = <HomeScreen />
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
    screen = <FeatureScreen analysis={analysis} links={links} tab={route.tab} />
  } else if (route.name === 'review') {
    screen = <ReviewScreen analysis={analysis} path={route.path} line={route.line} />
  } else {
    screen = <FinishScreen key={analysis.id} analysis={analysis} />
  }

  return (
    <div className="app">
      {!zen && <TopBar currentId={routeId} action={action} />}
      <main className={`main${route.name === 'review' ? ' main-fixed' : ''}`}>{screen}</main>
      <NoticeToast />
    </div>
  )
}
