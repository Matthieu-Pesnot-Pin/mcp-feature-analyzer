import type { DiffSnapshot } from '@shared/schemas/diff.schema'
import type {
  AddNoteBody,
  DeleteNoteBody,
  SetFileReviewedBody,
  SetFindingStatusBody,
  SubmitReviewBody,
  UpdateNoteBody,
} from '@shared/schemas/api.schema'
import type { AnalysisListing, AnalysisResponse, AppConfig } from '../types'

/** Erreur HTTP de l'API : `status` distingue un conflit de révision (409) des autres échecs. */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * Les routes sont relatives : la SPA est montée derrière un préfixe de proxy
 * variable, résolu par la balise <base> injectée par le GUI worker.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`api/${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })

  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const body = await response.json()
      if (body?.error) message = body.error
    } catch {
      // Réponse non-JSON : le code HTTP reste le message disponible.
    }
    throw new ApiError(response.status, message)
  }
  return (await response.json()) as T
}

function analysisPath(id: string): string {
  return `analyses/${encodeURIComponent(id)}`
}

function send<T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body: unknown): Promise<T> {
  return request<T>(path, { method, body: JSON.stringify(body) })
}

export const api = {
  getConfig: () => request<AppConfig>('config'),

  listAnalyses: () => request<AnalysisListing>('analyses'),

  getAnalysis: (id: string) => request<AnalysisResponse>(analysisPath(id)),

  getDiff: (id: string) => request<{ diff: DiffSnapshot }>(`${analysisPath(id)}/diff`),

  setFileReviewed: (id: string, body: SetFileReviewedBody) =>
    send<AnalysisResponse>('POST', `${analysisPath(id)}/files/reviewed`, body),

  setFindingStatus: (id: string, findingId: string, body: SetFindingStatusBody) =>
    send<AnalysisResponse>('POST', `${analysisPath(id)}/findings/${encodeURIComponent(findingId)}/status`, body),

  addNote: (id: string, body: AddNoteBody) => send<AnalysisResponse>('POST', `${analysisPath(id)}/notes`, body),

  updateNote: (id: string, noteId: string, body: UpdateNoteBody) =>
    send<AnalysisResponse>('PATCH', `${analysisPath(id)}/notes/${encodeURIComponent(noteId)}`, body),

  deleteNote: (id: string, noteId: string, body: DeleteNoteBody) =>
    send<AnalysisResponse>('DELETE', `${analysisPath(id)}/notes/${encodeURIComponent(noteId)}`, body),

  submitReview: (id: string, body: SubmitReviewBody) => send<AnalysisResponse>('POST', `${analysisPath(id)}/review`, body),
}
