import crypto from "crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Suite aléatoire de caractères [a-z0-9]. */
export function randomToken(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

/** "Refonte de l'Écran" -> "refonte-de-l-ecran" ; "analysis" quand rien ne reste. */
export function slugify(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "analysis";
}

/** Identifiant d'analyse : slug du titre suivi d'un identifiant court, par ex. "oauth-refresh-k3x9q2". */
export function analysisId(title: string): string {
  return `${slugify(title)}-${randomToken(6)}`;
}

/** Préfixe des identifiants générés, par type d'élément. */
export const ITEM_ID_PREFIXES = {
  finding: "f",
  note: "n",
  diagram: "d",
  node: "nd",
} as const;

export type ItemKind = keyof typeof ITEM_ID_PREFIXES;

/** Identifiant court d'élément, par ex. "f_a1b2c3", absent de `taken`. */
export function itemId(kind: ItemKind, taken: ReadonlySet<string>): string {
  for (;;) {
    const candidate = `${ITEM_ID_PREFIXES[kind]}_${randomToken(6)}`;
    if (!taken.has(candidate)) return candidate;
  }
}
