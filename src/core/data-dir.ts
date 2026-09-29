import path from "path";

/**
 * Répertoire des données : MCP_FEATURE_ANALYZER_DATA_DIR, puis MCP_DATA_DIR,
 * puis <racine du package>/.feature-analyzer-data.
 */
export function resolveDataDir(rootDir: string): string {
  const configured = process.env.MCP_FEATURE_ANALYZER_DATA_DIR?.trim() || process.env.MCP_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(rootDir, ".feature-analyzer-data");
}
