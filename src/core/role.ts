/**
 * Rôle du serveur, fixé par la variable MCP_FEATURE_ANALYZER_ROLE.
 *
 * - `standalone` (défaut) : le serveur tourne sur la machine qui porte les dépôts et y
 *   exécute git lui-même.
 * - `remote` : le serveur tourne derrière mcp-http-gateway, sur une autre machine ; git
 *   et la lecture des fichiers s'exécutent sur la machine de l'agent, par le relais agent
 *   (`mcp-http-gateway --mcp`, route listée dans GATEWAY_EXEC_ROUTES).
 */
export type Role = "standalone" | "remote";

const ROLES: readonly Role[] = ["standalone", "remote"];

export function resolveRole(): Role {
  const raw = process.env.MCP_FEATURE_ANALYZER_ROLE?.trim();
  if (!raw) return "standalone";
  if ((ROLES as readonly string[]).includes(raw)) return raw as Role;
  throw new Error(`MCP_FEATURE_ANALYZER_ROLE="${raw}" is invalid (expected: ${ROLES.join(" | ")}).`);
}
