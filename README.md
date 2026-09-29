# MCP Feature Analyzer

Serveur MCP doté d'une interface web qui présente à un relecteur humain une feature développée par un agent IA (résumé, fichiers modifiés, diff figé, constats classés par gravité, schémas), puis lui permet de renvoyer à l'agent un retour structuré.

## Installation

```bash
npx -y @imenam/mcp-feature-analyzer
```

Le serveur communique en JSON-RPC sur stdio. Il est lancé par le client MCP (Claude Code, par exemple), pas à la main.

## Déclaration dans un projet

Depuis la racine du projet à relire :

```bash
npx -y @imenam/mcp-feature-analyzer --claude-setup-mcp [--force] [--proxy_url=URL | --app_port=N]
```

La commande crée `.mcp.json`, ou y ajoute l'entrée `mcp-feature-analyzer` en conservant les autres serveurs.

| Option | Effet |
|---|---|
| `--force` | Remplace une entrée `mcp-feature-analyzer` existante. Sans cette option, la commande refuse d'écraser. |
| `--proxy_url=URL` | Expose la GUI via le proxy à cette URL (`PROXY_URL`). |
| `--app_port=N` | Sert la GUI directement sur `http://localhost:N` (`APP_PORT`), sans proxy. |

`--proxy_url` et `--app_port` s'excluent. Sans l'un ni l'autre, `PROXY_URL` reçoit le modèle `http://localhost:` dont il faut compléter le port.

## Variables d'environnement

Elles se renseignent dans le champ `env` de `.mcp.json`, ou dans un fichier `.env` à la racine du package (le `.env` prime).

| Variable | Rôle |
|---|---|
| `PROXY_URL` | URL du proxy qui expose la GUI. Prime sur `APP_PORT`. |
| `APP_PORT` | Port local de la GUI quand aucun proxy n'est utilisé. |
| `APP_PATH` | Chemin de montage de la GUI derrière le proxy (défaut : `/feature-analyzer`). |
| `APP_NAME` | Nom affiché dans le tableau de bord du proxy. |
| `APP_GROUP` | Groupe d'affichage dans le tableau de bord du proxy. |
| `MCP_FEATURE_ANALYZER_DATA_DIR` | Répertoire des données. À défaut : `MCP_DATA_DIR`, puis `<racine du package>/.feature-analyzer-data`. |
| `MCP_LOG_DIR` | Répertoire des logs (défaut : `<répertoire des données>/logs`). |

Sans `PROXY_URL` ni `APP_PORT`, la GUI est désactivée ; les outils MCP restent utilisables. L'outil `reconnect_gui` relance la GUI et la réenregistre auprès du proxy, par exemple quand le proxy a démarré après le serveur MCP.

## Développement

```bash
npm install
npm run build   # version, backend (tsc -> dist/) et GUI (gui/dist)
npm test        # node --test sur dist/test
```

| Dossier | Contenu |
|---|---|
| `src/index.ts` | Processus maître MCP (stdio) : outils, IPC, lancement de la GUI. |
| `src/gui-worker.ts` | Processus GUI : serveur Hono, SSE `/api/events`, fichiers statiques, enregistrement auprès du proxy. |
| `src/core/` | Logique métier (répertoires de données et de logs). |
| `src/cli/setup-mcp.ts` | Commande `--claude-setup-mcp`. |
| `shared/` | Code commun au backend et à la GUI : schémas zod, prompt de retour, placement des schémas (`diagram-layout.ts`). |
| `gui/` | Application Vite + React 19 + zustand. |
| `test/` | Tests `node --test`. |

Le test de bout en bout lance le serveur avec le proxy `E2E_PROXY_URL` (défaut `http://localhost:3000`) ; il est ignoré si le proxy ne répond pas.
