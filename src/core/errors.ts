/** Erreur métier dont le message s'adresse directement à l'agent ou à la GUI. */
export class AnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisError";
  }
}

/** Échec d'accès au dépôt git : chemin invalide, dépôt absent, ref inconnue, commande en erreur. */
export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}
