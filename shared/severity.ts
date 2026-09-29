import { SEVERITIES, type Severity } from "./schemas/analysis.schema.js";

/** Rang d'une gravité : 0 pour la plus grave. */
export function severityRank(severity: Severity): number {
  return SEVERITIES.indexOf(severity);
}

/** Comparateur qui trie de la plus grave à la moins grave. */
export function compareSeverity(a: Severity, b: Severity): number {
  return severityRank(a) - severityRank(b);
}

/** Copie triée de la plus grave à la moins grave ; à gravité égale, l'ordre d'origine est conservé. */
export function sortBySeverity<T extends { severity: Severity }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => compareSeverity(a.severity, b.severity));
}

/** Compteur à zéro pour chaque gravité. */
export function emptySeverityCounts(): Record<Severity, number> {
  return { critical: 0, major: 0, minor: 0, trivial: 0 };
}
