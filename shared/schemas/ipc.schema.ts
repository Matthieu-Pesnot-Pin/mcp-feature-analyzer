import { z } from "zod";

/** Message échangé entre le processus maître MCP et le GUI worker. */
export const IPCMessageSchema = z.object({
  type: z.string(),
  correlationId: z.string().optional(),
  data: z.any().optional(),
  error: z.string().optional(),
  timestamp: z.string(),
});

export type IPCMessage = z.infer<typeof IPCMessageSchema>;

/** Types d'IPC envoyés par le maître et relayés tels quels aux clients SSE de la GUI. */
export const PUSHED_EVENT_TYPES = ["INITIAL_STATE", "ANALYSES_UPDATED", "ANALYSIS_UPDATED"] as const;

export type PushedEventType = (typeof PUSHED_EVENT_TYPES)[number];
