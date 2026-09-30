import os from "os";

/** Interface d'écoute du GUI worker : la boucle locale uniquement. */
export const LISTEN_HOST = "127.0.0.1";

/** Méthodes HTTP sans effet de bord, exemptées du contrôle des modifications. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Refus d'une requête : code HTTP et message renvoyé au client. */
export interface GuardRejection {
  status: 403 | 415;
  error: string;
}

/**
 * Nom d'hôte d'un en-tête `Host` ou d'une URL d'origine, sans port ni crochets,
 * en minuscules. Renvoie null quand la valeur n'est pas exploitable.
 */
export function hostnameOf(hostHeader: string): string | null {
  const value = hostHeader.trim().toLowerCase();
  if (value === "") return null;
  try {
    return new URL(`http://${value}`).hostname.replace(/^\[(.*)\]$/, "$1");
  } catch {
    return null;
  }
}

/**
 * Noms d'hôte sous lesquels la GUI est légitimement appelée : boucle locale,
 * nom et adresses de la machine (accès par le proxy depuis le réseau, qui
 * transmet l'en-tête `Host` d'origine) et hôte du proxy.
 */
export function allowedHostnames(proxyUrl: string | undefined): Set<string> {
  const names = new Set(["localhost", "127.0.0.1", "::1"]);
  names.add(os.hostname().toLowerCase());
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) names.add(address.address.toLowerCase());
  }
  if (proxyUrl) {
    const proxyHost = hostnameOf(new URL(proxyUrl).host);
    if (proxyHost !== null) names.add(proxyHost);
  }
  return names;
}

/**
 * Contrôle d'une requête entrante.
 * - L'en-tête `Host` doit désigner un hôte autorisé : une page tierce qui fait
 *   pointer son domaine vers 127.0.0.1 (DNS rebinding) est refusée.
 * - Une requête de modification exige `Content-Type: application/json`, qu'un
 *   navigateur ne peut envoyer vers une autre origine sans requête préalable
 *   CORS, refusée ici ; une origine différente de l'hôte appelé est refusée.
 */
export function checkRequest(
  request: { method: string; host: string | undefined; origin: string | undefined; contentType: string | undefined },
  allowed: Set<string>
): GuardRejection | null {
  const hostname = request.host === undefined ? null : hostnameOf(request.host);
  if (hostname === null || !allowed.has(hostname)) {
    return { status: 403, error: `Host "${request.host ?? ""}" is not allowed: open the GUI through the proxy or http://localhost.` };
  }

  if (SAFE_METHODS.has(request.method.toUpperCase())) return null;

  const mediaType = request.contentType?.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return { status: 415, error: `Content-Type must be application/json, got "${request.contentType ?? ""}".` };
  }
  if (request.origin === undefined) return null;
  let originHost: string;
  try {
    originHost = new URL(request.origin).host.toLowerCase();
  } catch {
    return { status: 403, error: `Cross-origin request refused: origin "${request.origin}" is not a valid URL.` };
  }
  if (originHost !== request.host!.trim().toLowerCase()) {
    return { status: 403, error: `Cross-origin request refused: origin "${request.origin}" does not match host "${request.host}".` };
  }
  return null;
}
