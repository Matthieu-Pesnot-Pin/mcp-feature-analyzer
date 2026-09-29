import { ITEM_ID_PATTERN } from "../../shared/schemas/analysis.schema.js";
import { has, nullableString, optionalPositiveInt, type Args } from "./types.js";

/** Emplacement demandé par l'agent : `null` pour retirer l'emplacement, `undefined` s'il n'en donne pas. */
export type LocationInput = { path: string; startLine: number; endLine: number | undefined } | null | undefined;

/**
 * Lit `path`, `start_line` et `end_line`. `path` et `start_line` vont ensemble ;
 * `end_line` vaut `start_line` quand il est omis. `path: null` retire l'emplacement.
 */
export function readLocation(args: Args, prefix = ""): LocationInput {
  const path = nullableString(args, "path", prefix);
  const startLine = optionalPositiveInt(args, "start_line", prefix);
  const endLine = optionalPositiveInt(args, "end_line", prefix);

  if (path === null) {
    if (startLine !== undefined || endLine !== undefined) {
      throw new Error(`"${prefix}path" is null (location removed), so "start_line" and "end_line" cannot be set.`);
    }
    return null;
  }
  if (path === undefined) {
    if (startLine !== undefined || endLine !== undefined) {
      throw new Error(`"${prefix}start_line" and "${prefix}end_line" need "${prefix}path": give the file they refer to.`);
    }
    return undefined;
  }
  if (startLine === undefined) {
    throw new Error(`"${prefix}start_line" is required with "${prefix}path": give the first new-side line (see get_diff).`);
  }
  if (endLine !== undefined && endLine < startLine) {
    throw new Error(`"${prefix}end_line" (${endLine}) must be >= "${prefix}start_line" (${startLine}).`);
  }
  return { path, startLine, endLine };
}

/** Lit un identifiant d'élément facultatif fourni par l'agent. */
export function readItemId(args: Args, field: string, prefix = ""): string | undefined {
  if (!has(args, field)) return undefined;
  const value = args![field];
  if (typeof value !== "string" || !ITEM_ID_PATTERN.test(value)) {
    throw new Error(`"${prefix}${field}" must contain only letters, digits, '_' or '-' (1 to 64 characters).`);
  }
  return value;
}
