/**
 * Mises à niveau des fichiers de données, appliquées à la lecture avant la
 * validation de schéma. Chaque étape est idempotente : elle renvoie null quand
 * le document est déjà dans le format qu'elle produit.
 */

export type RawDocument = Record<string, unknown>;

/** Étape de migration : document mis à niveau, ou null si elle n'a rien à changer. */
export type MigrationStep = (raw: RawDocument) => RawDocument | null;

/** Étapes appliquées aux analyses (`analyses/<id>.json`), dans l'ordre. */
export const ANALYSIS_MIGRATIONS: readonly MigrationStep[] = [];

/** Étapes appliquées aux snapshots de diff (`diffs/<id>.json`), dans l'ordre. */
export const SNAPSHOT_MIGRATIONS: readonly MigrationStep[] = [];

/** Applique `steps` à la suite. Renvoie null si aucune étape n'a modifié le document. */
export function applyMigrations(raw: unknown, steps: readonly MigrationStep[]): RawDocument | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  let current = raw as RawDocument;
  let changed = false;
  for (const step of steps) {
    const next = step(current);
    if (next !== null) {
      current = next;
      changed = true;
    }
  }
  return changed ? current : null;
}

/** Met à niveau une analyse brute ; null si elle est déjà à jour. */
export function migrateAnalysis(raw: unknown): RawDocument | null {
  return applyMigrations(raw, ANALYSIS_MIGRATIONS);
}

/** Met à niveau un snapshot de diff brut ; null s'il est déjà à jour. */
export function migrateSnapshot(raw: unknown): RawDocument | null {
  return applyMigrations(raw, SNAPSHOT_MIGRATIONS);
}
