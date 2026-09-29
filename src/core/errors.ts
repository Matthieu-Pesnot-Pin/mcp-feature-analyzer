/** Erreur métier dont le message s'adresse directement à l'agent ou à la GUI. */
export class AnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisError";
  }
}

/** Analyse, constat ou remarque introuvable. */
export class NotFoundError extends AnalysisError {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Modification basée sur une révision qui n'est plus la révision enregistrée. */
export class RevisionConflictError extends AnalysisError {
  constructor(message: string) {
    super(message);
    this.name = "RevisionConflictError";
  }
}

/** Échec d'accès au dépôt git : chemin invalide, dépôt absent, ref inconnue, commande en erreur. */
export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}
