import { z } from "zod";

/**
 * Nature d'une erreur renvoyée par le maître à une requête du GUI worker, qui
 * la traduit en code HTTP : invalid → 400, not_found → 404, conflict → 409,
 * internal → 500.
 */
export const IPC_ERROR_KINDS = ["invalid", "not_found", "conflict", "internal"] as const;

export type IpcErrorKind = (typeof IPC_ERROR_KINDS)[number];

/** Message échangé entre le processus maître MCP et le GUI worker. */
export const IPCMessageSchema = z.object({
  type: z.string(),
  correlationId: z.string().optional(),
  data: z.any().optional(),
  error: z.string().optional(),
  errorKind: z.enum(IPC_ERROR_KINDS).optional(),
  timestamp: z.string(),
});

export type IPCMessage = z.infer<typeof IPCMessageSchema>;

/** Types d'IPC envoyés par le maître, journalisés par le GUI worker et servis tels quels par `/api/changes`. */
export const PUSHED_EVENT_TYPES = ["ANALYSES_UPDATED", "ANALYSIS_UPDATED"] as const;

export type PushedEventType = (typeof PUSHED_EVENT_TYPES)[number];

/**
 * Réponse de `GET /api/changes`. `epoch` identifie l'instance du GUI worker,
 * `seq` le dernier évènement journalisé. `reset: true` signifie que le client
 * doit tout recharger ; sinon `events` liste les évènements postérieurs à `since`.
 */
export type ChangesResponse =
  | { epoch: string; seq: number; reset: true }
  | { epoch: string; seq: number; reset: false; events: IPCMessage[] };

/** Requêtes du GUI worker au maître ; chacune reçoit une réponse de même `correlationId`. */
export const GUI_REQUEST_TYPES = [
  "GET_CONFIG",
  "LIST_ANALYSES",
  "GET_ANALYSIS",
  "GET_DIFF",
  "SET_FILE_REVIEWED",
  "SET_FINDING_STATUS",
  "ADD_NOTE",
  "UPDATE_NOTE",
  "DELETE_NOTE",
  "SUBMIT_REVIEW",
  "MARK_PROCESSED",
] as const;

export type GuiRequestType = (typeof GUI_REQUEST_TYPES)[number];
