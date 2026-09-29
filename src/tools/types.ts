/** Forme de réponse attendue par le SDK MCP pour un appel d'outil. */
export interface ToolResult {
  // Signature d'index exigée par le type de retour du SDK MCP.
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/** Résultat d'un outil qui modifie une analyse : le texte et l'analyse concernée, à notifier. */
export interface MutationResult {
  result: ToolResult;
  analysisId: string;
}

/** Arguments d'un outil ou d'un élément de tableau. */
export type Args = Record<string, unknown> | undefined;

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text: `Error: ${text}` }], isError: true };
}

/** Nom d'un champ dans les messages d'erreur : `prefix` situe un élément de tableau, par ex. `findings[2].`. */
function label(field: string, prefix: string): string {
  return `"${prefix}${field}"`;
}

/** Vrai si le champ est présent (ni absent ni `undefined`). */
export function has(args: Args, field: string): boolean {
  return args !== undefined && args[field] !== undefined;
}

/** Lit un argument texte obligatoire, rogné ; lève une erreur s'il est absent ou vide. */
export function requireString(args: Args, field: string, prefix = ""): string {
  const value = args?.[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label(field, prefix)} is required and must be a non-empty string.`);
  }
  return value.trim();
}

/** Lit un argument texte facultatif, rogné ; `undefined` s'il est absent, erreur s'il est vide ou d'un autre type. */
export function optionalString(args: Args, field: string, prefix = ""): string | undefined {
  if (!has(args, field)) return undefined;
  return requireString(args, field, prefix);
}

/**
 * Lit un argument texte facultatif qui accepte `null` pour effacer la valeur :
 * `undefined` s'il est absent, `null` s'il vaut null, le texte rogné sinon.
 */
export function nullableString(args: Args, field: string, prefix = ""): string | null | undefined {
  if (!has(args, field)) return undefined;
  if (args![field] === null) return null;
  const value = args![field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label(field, prefix)} must be a non-empty string, or null to clear it.`);
  }
  return value.trim();
}

/** Lit un texte obligatoire non blanc, conservé tel quel (indentation et fins de ligne comprises). */
export function requireText(args: Args, field: string, prefix = ""): string {
  const value = args?.[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label(field, prefix)} is required and must be a non-empty string.`);
  }
  return value;
}

/**
 * Lit un texte facultatif conservé tel quel, `null` pour effacer : `undefined`
 * s'il est absent. `allowEmpty` accepte la chaîne vide.
 */
export function nullableText(args: Args, field: string, prefix = "", allowEmpty = false): string | null | undefined {
  if (!has(args, field)) return undefined;
  const value = args![field];
  if (value === null) return null;
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    const expected = allowEmpty ? "a string" : "a non-empty string";
    throw new Error(`${label(field, prefix)} must be ${expected}, or null to clear it.`);
  }
  return value;
}

/** Lit une valeur parmi `values` ; erreur explicite listant les valeurs admises. */
export function requireEnum<T extends string>(args: Args, field: string, values: readonly T[], prefix = ""): T {
  const value = args?.[field];
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
    const got = value === undefined ? "nothing" : JSON.stringify(value);
    throw new Error(`${label(field, prefix)} must be one of ${values.join(", ")} (got ${got}).`);
  }
  return value as T;
}

/** Lit une valeur facultative parmi `values` ; `undefined` si elle est absente. */
export function optionalEnum<T extends string>(args: Args, field: string, values: readonly T[], prefix = ""): T | undefined {
  if (!has(args, field)) return undefined;
  return requireEnum(args, field, values, prefix);
}

/** Lit un entier strictement positif obligatoire. */
export function requirePositiveInt(args: Args, field: string, prefix = ""): number {
  const value = args?.[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${label(field, prefix)} is required and must be an integer >= 1 (got ${JSON.stringify(value) ?? "nothing"}).`);
  }
  return value;
}

/** Lit un entier strictement positif facultatif ; `undefined` s'il est absent. */
export function optionalPositiveInt(args: Args, field: string, prefix = ""): number | undefined {
  if (!has(args, field)) return undefined;
  return requirePositiveInt(args, field, prefix);
}

/** Lit un tableau obligatoire, d'au moins `minItems` éléments. */
export function requireArray(args: Args, field: string, minItems = 0, prefix = ""): unknown[] {
  const value = args?.[field];
  if (!Array.isArray(value)) {
    throw new Error(`${label(field, prefix)} is required and must be an array.`);
  }
  if (value.length < minItems) {
    throw new Error(`${label(field, prefix)} must contain at least ${minItems} item(s).`);
  }
  return value;
}

/** Lit un tableau facultatif ; `undefined` s'il est absent. */
export function optionalArray(args: Args, field: string, prefix = ""): unknown[] | undefined {
  if (!has(args, field)) return undefined;
  return requireArray(args, field, 0, prefix);
}

/** Vérifie qu'un élément de tableau est un objet et le renvoie. */
export function requireObject(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`"${where}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

/** Lit un tableau de textes non vides, rognés. */
export function requireStringArray(args: Args, field: string, minItems = 0, prefix = ""): string[] {
  return requireArray(args, field, minItems, prefix).map((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      throw new Error(`${label(`${field}[${index}]`, prefix)} must be a non-empty string.`);
    }
    return item.trim();
  });
}

/** Lève une erreur si `args` contient des champs hors de `allowed` : une faute de frappe ne passe pas inaperçue. */
export function rejectUnknownFields(args: Args, allowed: readonly string[], prefix = ""): void {
  if (!args) return;
  const unknown = Object.keys(args).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    const where = prefix === "" ? "" : ` in ${prefix.replace(/\.$/, "")}`;
    throw new Error(`Unknown field(s)${where}: ${unknown.join(", ")}. Accepted fields: ${allowed.join(", ")}.`);
  }
}
