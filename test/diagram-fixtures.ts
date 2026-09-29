/** Schémas de test partagés : maquettes 4 (couches) et 5 (flux), carte mentale. */
import type { Diagram, DiagramKind, DiagramNode, NodeShape, NodeStatus } from "../shared/schemas/analysis.schema.js";

export interface NodeSpec {
  id: string;
  label?: string;
  shape?: NodeShape;
  status?: NodeStatus;
  layer?: string;
  detail?: string;
  path?: string;
}

export function diagram(kind: DiagramKind, nodes: NodeSpec[], links: Array<[string, string, string?]>, layers: string[] = []): Diagram {
  return {
    id: `d_${kind}`,
    title: kind,
    kind,
    layers,
    nodes: nodes.map(
      (spec): DiagramNode => ({
        id: spec.id,
        label: spec.label ?? spec.id,
        shape: spec.shape ?? "box",
        status: spec.status ?? "existing",
        layer: spec.layer ?? null,
        detail: spec.detail ?? null,
        location: spec.path ? { path: spec.path, line: null } : null,
      })
    ),
    links: links.map(([from, to, label]) => ({ from, to, label: label ?? null })),
    updatedAt: "2026-09-29T10:00:00.000Z",
  };
}

/** Schéma de la maquette 4 : périmètre d'impact en quatre couches. */
export function impactLayers(): Diagram {
  const file = (id: string, layer: string, status: NodeStatus) => ({ id, label: id, layer, status, path: `src/${id}` });
  return diagram(
    "layers",
    [
      file("token.ts", "Données", "modified"),
      file("tokenStore.ts", "Données", "modified"),
      file("config.ts", "Données", "modified"),
      file("refreshService.ts", "Service", "new"),
      file("refresh.spec.ts", "Service", "new"),
      file("httpClient.ts", "Transport", "modified"),
      file("retry.ts", "Transport", "new"),
      file("documents.ts", "Appelants", "modified"),
      file("users.ts", "Appelants", "modified"),
      file("admin.ts", "Appelants", "impacted"),
      file("session.ts", "Appelants", "modified"),
      file("session.spec.ts", "Appelants", "modified"),
    ],
    [
      ["token.ts", "refreshService.ts"],
      ["tokenStore.ts", "refreshService.ts"],
      ["config.ts", "refreshService.ts"],
      ["refreshService.ts", "httpClient.ts"],
      ["refreshService.ts", "retry.ts"],
      ["refreshService.ts", "refresh.spec.ts"],
      ["httpClient.ts", "documents.ts"],
      ["httpClient.ts", "users.ts"],
      ["httpClient.ts", "admin.ts"],
      ["httpClient.ts", "session.ts"],
      ["session.ts", "session.spec.ts"],
    ],
    ["Données", "Service", "Transport", "Appelants"]
  );
}

/** Schéma de la maquette 5 : flux de rafraîchissement. */
export function refreshFlow(): Diagram {
  return diagram(
    "flow",
    [
      { id: "request", label: "Requête API", shape: "pill" },
      { id: "is401", label: "401 ?", shape: "decision", status: "modified" },
      { id: "refresh", label: "refresh()", status: "new", path: "src/refreshService.ts" },
      { id: "forward", label: "Réponse transmise" },
      { id: "post", label: "POST /token", status: "new", path: "src/httpClient.ts" },
      { id: "success", label: "Succès ?", shape: "decision", status: "modified" },
      { id: "replay", label: "Rejouer la requête", status: "new" },
      { id: "null", label: "Renvoie null", status: "finding", path: "src/refreshService.ts" },
      { id: "end", label: "Fin", shape: "pill" },
      { id: "logout", label: "Déconnexion après 3 échecs", status: "missing", detail: "absente, demandée par TM-142" },
    ],
    [
      ["request", "is401"],
      ["is401", "refresh", "oui"],
      ["is401", "forward", "non"],
      ["refresh", "post"],
      ["post", "success"],
      ["success", "replay", "oui"],
      ["success", "null", "non"],
      ["replay", "end"],
      ["null", "logout", "attendu"],
    ]
  );
}

/** Carte mentale de douze nœuds sur trois niveaux. */
export function conceptMap(): Diagram {
  return diagram(
    "mindmap",
    [
      { id: "root", label: "Rafraîchissement OAuth", shape: "pill", status: "new" },
      { id: "tokens", label: "Tokens" },
      { id: "access", label: "Token d'accès", status: "modified" },
      { id: "refreshToken", label: "Token de rafraîchissement", status: "new" },
      { id: "storage", label: "Stockage chiffré", status: "impacted" },
      { id: "network", label: "Réseau" },
      { id: "retry", label: "retry.ts", status: "new", path: "src/retry.ts" },
      { id: "client", label: "httpClient.ts", status: "modified", path: "src/httpClient.ts" },
      { id: "errors", label: "Erreurs", status: "finding" },
      { id: "logout", label: "Déconnexion", status: "missing", detail: "après 3 échecs" },
      { id: "nullReturn", label: "Renvoie null", status: "finding" },
      { id: "tests", label: "Tests", status: "new" },
    ],
    [
      ["root", "tokens"],
      ["tokens", "access"],
      ["tokens", "refreshToken"],
      ["refreshToken", "storage"],
      ["root", "network"],
      ["network", "retry"],
      ["network", "client"],
      ["root", "errors"],
      ["errors", "logout"],
      ["errors", "nullReturn"],
      ["root", "tests"],
    ]
  );
}
