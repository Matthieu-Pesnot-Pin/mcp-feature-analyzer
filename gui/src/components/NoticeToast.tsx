import { useAnalysisStore } from '../store/useAnalysisStore'
import { Icon } from './Icon'

/** Message bref en bas à droite : confirmation, conflit de révision ou erreur. */
export function NoticeToast() {
  const notice = useAnalysisStore((state) => state.notice)
  const dismiss = useAnalysisStore((state) => state.dismissNotice)
  if (!notice) return null
  return (
    <div key={notice.id} className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      <Icon name={notice.kind === 'error' ? 'triangle-alert' : 'info'} />
      <span className="notice-text">{notice.text}</span>
      <button type="button" className="notice-close" onClick={dismiss} aria-label="Fermer le message">
        <Icon name="circle-x" />
      </button>
    </div>
  )
}
