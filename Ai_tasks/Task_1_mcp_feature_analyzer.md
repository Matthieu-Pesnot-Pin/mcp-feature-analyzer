# Task 1 — MCP Feature Analyzer : aide à la revue humaine du code produit par une IA

**Date :** 2026-09-29
**Projet :** mcp-feature-analyzer (`@imenam/mcp-feature-analyzer`)
**Objectif :** un serveur MCP doté d'une GUI web qui présente à un relecteur humain une feature développée par un agent IA : résumé, fichiers modifiés, diff, constats classés par gravité, schémas (impact, process, carte mentale), puis un retour structuré que l'agent relit.

Maquettes de référence (mcp-design, groupe « MCP Feature Analyzer / Propositions ») :
`1-vue-d-ensemble-de-la-feature` (résumé), `2-revue-d-un-fichier`, `3-fin-de-revue-et-retour-a-l-agent`, `4-schema-perimetre-d-impact`, `5-schema-flux-de-process`.

---

## 1. Décisions de cadrage

| Sujet | Décision |
|---|---|
| Qui rédige l'analyse | L'agent, via les outils MCP. Le serveur n'appelle aucun LLM. |
| Source du diff | Calculée par le serveur avec `git`, deux modes au choix à la création : `branch` (base...head) ou `working_tree` (modifications non commitées, index compris, par rapport à HEAD). |
| Figement | Le diff est figé (snapshot) à la création ; `refresh_analysis` le recalcule. |
| Correctif proposé | Affiché uniquement (lignes actuelles barrées / lignes proposées). Aucune écriture dans le dépôt. |
| Retour à l'agent | Lecture seule : `get_review_feedback`. Pas d'outil bloquant. |
| Exécution | Locale : le serveur tourne sur la machine du dépôt et lance `git` lui-même. Aucun support de mcp-http-gateway pour la création d'analyse (échec explicite si le dépôt est introuvable). |
| Livraison | `git init` local, un commit par phase validée. Pas de remote, pas de publication npm. |
| Tests | `node --test` (unitaires, outils, e2e agent → GUI → agent via le proxy) + vérification visuelle des écrans par l'orchestrateur. |

## 2. Conventions à respecter (issues des autres projets, référence : mcp-design)

- **Structure** : `src/index.ts` (processus maître MCP stdio), `src/gui-worker.ts` (processus GUI forké : Hono + SSE + fichiers statiques), `src/tools/<nom-outil>.ts` (une fonction pure par outil, `(store, args) => ToolResult`), `src/core/` (logique métier), `src/cli/setup-mcp.ts`, `src/version.ts` (généré), `shared/` (code commun backend + GUI : schémas zod, logique pure), `gui/` (Vite + React 19 + zustand, CSS écrit à la main avec variables), `scripts/generate-version.js`, `test/`.
- **Manifestes** : `package.json` créé et modifié uniquement par des commandes npm (`npm init -y`, `npm pkg set`, `npm install`), jamais écrit à la main. Même règle pour `gui/package.json`.
- **Build** : `tsc` compile `src/`, `shared/`, `test/` vers `dist/` (NodeNext, strict, imports en `.js`). `build:gui` construit `gui/dist`. Scripts identiques à mcp-design (`generate-version`, `build:backend`, `build:gui`, `build`, `start`, `test`, `prepublishOnly`, `release`).
- **Serveur MCP** : `Server` bas niveau du SDK, schémas JSON écrits à la main dans `index.ts`, descriptions de champs partagées via des constantes. Noms d'outils en snake_case, descriptions en anglais, impératives, qui disent quand utiliser l'outil et comment il s'articule avec les autres. Champ `instructions` du serveur pour présenter les concepts (analyse, constat, schéma, retour).
- **Résultats d'outils** : `textResult` / `errorResult` (`Error: …`, `isError: true`) ; les messages d'erreur disent à l'agent quoi faire ensuite. Les résultats de mutation indiquent l'URL de la GUI (`Open the review: <url>#/<id>`).
- **GUI** : `GuiLauncher` de `@imenam/mcp-gui-interface` ; modes proxy (`PROXY_URL`, `APP_PATH`, `APP_NAME`, `APP_GROUP`) et standalone (`APP_PORT`) ; GUI désactivée si aucun des deux n'est défini, les outils restent utilisables. Outil `reconnect_gui` construit avec les helpers de la bibliothèque (`reconnectGuiToolDefinition`, `handleReconnectTool`). IPC `{type, correlationId, data, error, timestamp}` validé par zod. Le worker expose REST + SSE (`/api/events`), `<base href>` injecté pour le proxy, `?__direct=1`.
- **Persistance** : un fichier JSON par analyse dans `<dataDir>/analyses/<id>.json` et son snapshot de diff dans `<dataDir>/diffs/<id>.json`. `dataDir` = `MCP_FEATURE_ANALYZER_DATA_DIR`, puis `MCP_DATA_DIR`, puis `<racine du package>/.feature-analyzer-data`. Écritures atomiques (`.tmp` + `rename`), verrou inter-processus (`.lock`), cache par `mtime/size`, `mutate(id, editor, fn, {baseRevision})` comme point unique de modification, validation zod à la lecture et à l'écriture, `migrate.ts` idempotent.
- **Journalisation** : `setupLogging` / `createLogger` ; `MCP_LOG_DIR`, puis `<dataDir>/logs`. stdout réservé au JSON-RPC.
- **setup-mcp** : `npx -y @imenam/mcp-feature-analyzer --claude-setup-mcp [--force] [--proxy_url=URL | --app_port=N]` écrit ou fusionne `<cwd>/.mcp.json` (entrée `mcp-feature-analyzer`), avec `MCP_FEATURE_ANALYZER_DATA_DIR = <cwd>/.feature-analyzer-data`, tableau d'explication en français.
- **Langue** : commentaires, README, messages CLI et libellés de la GUI en français ; noms, descriptions et textes de résultat des outils en anglais.
- **Commentaires** : décrivent ce que fait le code, au présent. Jamais d'état du chantier, d'historique de la demande ni de récit de développement.
- **Jamais de repli** : un mécanisme qui échoue échoue franchement, avec un message qui indique la marche à suivre. Pas de valeur devinée.
- **.gitignore** : `node_modules/ dist/ gui/dist/ gui/node_modules/ .env .feature-analyzer-data/ .mcp.json`. `gui/.npmignore` contenant `node_modules`.

## 3. Modèle de données (`shared/schemas/`)

### Analysis (`analysis.schema.ts`)

```
Analysis {
  id: string                       // slug du titre + identifiant court
  title: string
  repoPath: string                 // chemin absolu du dépôt git
  mode: "branch" | "working_tree"
  base: string                     // ref de base (branch) ; "HEAD" en working_tree
  head: string | null              // ref de tête (branch) ; null en working_tree
  baseCommit: string               // sha figé au dernier snapshot
  headCommit: string | null        // sha figé (branch) ; null en working_tree
  snapshotAt: string               // ISO
  request: { text: string, source: string | null } | null   // demande initiale (ticket, prompt)
  summary: string[]                // puces « Ce que l'agent a fait »
  files: FileEntry[]
  findings: Finding[]
  notes: Note[]                    // remarques du relecteur
  diagrams: Diagram[]
  review: Review
  revision: number, createdAt, updatedAt, lastEditor: "agent" | "user"
}

FileEntry { path, oldPath: string | null, status: "added" | "modified" | "deleted" | "renamed",
            additions, deletions, binary: boolean, reviewed: boolean }

Finding {
  id, severity: "critical" | "major" | "minor" | "trivial",
  kind: "issue" | "requirement_gap",
  title, body,
  location: { path, startLine, endLine } | null     // lignes du côté « nouveau » du diff
  anchorText: string | null        // lignes visées, copiées du snapshot à la création
  suggestion: string | null        // texte de remplacement proposé pour les lignes visées
  prompt: string | null            // prompt spécifique fourni par l'agent ; sinon généré
  status: "open" | "ignored" | "outdated"
  createdAt
}

Note { id, location: { path, line } | null, text, createdAt }

Diagram { id, title, kind: "flow" | "layers" | "mindmap",
          layers: string[]                          // ordre des colonnes, kind = layers
          nodes: DiagramNode[], links: DiagramLink[], updatedAt }
DiagramNode { id, label, shape: "box" | "pill" | "decision",
              status: "new" | "modified" | "impacted" | "existing" | "finding" | "missing",
              layer: string | null, detail: string | null,
              location: { path, line: number | null } | null }
DiagramLink { from, to, label: string | null }

Review { state: "pending" | "submitted",
         decision: "approve" | "request_changes" | "reject" | null,
         selectedFindingIds: string[], selectedNoteIds: string[],
         prompt: string | null, submittedAt: string | null }
```

### Snapshot de diff (`diff.schema.ts`)

```
DiffSnapshot { analysisId, files: FileDiff[] }
FileDiff { path, hunks: Hunk[] }
Hunk { header, oldStart, oldLines, newStart, newLines,
       lines: { type: "context" | "add" | "del", oldNo: number | null, newNo: number | null, text }[] }
```

### Invariants (appliqués dans `mutate`)

- Les `id` de constats, remarques, schémas et nœuds sont uniques dans leur liste.
- Un constat `location` référence un fichier présent dans `files`, avec `1 ≤ startLine ≤ endLine ≤` nombre de lignes du fichier au snapshot ; sinon refus explicite.
- Un constat `requirement_gap` peut ne pas avoir de `location`.
- Les liens d'un schéma référencent des nœuds existants ; un `layer` de nœud figure dans `layers` quand `kind = layers`.
- `review.selected*Ids` ne référencent que des constats et remarques existants.

## 4. Logique partagée (`shared/`)

- `shared/prompt.ts` : `buildAgentPrompt(analysis, selection)` produit le prompt de correction (utilisé par la GUI pour l'aperçu et par le backend pour `get_review_feedback` et le prompt global de l'écran Résumé). Format proche de la maquette 3 : en-tête avec branche / mode, liste numérotée `[Gravité] chemin:ligne — titre`, corps, correctif proposé, remarques du relecteur.
- `shared/diagram-layout.ts` : calcul des positions, sans dépendance externe, testable sous Node :
  - `flow` : graphe orienté gauche → droite, rangs par plus long chemin, ordre dans un rang par barycentre, décisions en losange ;
  - `layers` : une colonne par entrée de `layers`, nœuds empilés dans leur colonne, ordre par barycentre des voisins ;
  - `mindmap` : arbre radial autour du premier nœud (ou du nœud sans parent), branches réparties par angle.
  - Retour : `{ nodes: {id, x, y, width, height}[], links: {from, to, points}[], width, height }`.
- `shared/severity.ts`, `shared/labels.ts` : libellés français et couleurs des gravités et statuts, uniques pour la GUI et les textes.

## 5. Accès git (`src/core/git.ts`)

- Exécution via `execFile("git", [...], { cwd: repoPath })`, sans shell. Erreur explicite si `repoPath` n'est pas absolu, n'existe pas ou n'est pas un dépôt git.
- `branch` : `git rev-parse` de `base` et `head` (défaut `HEAD` pour `head`, valeur documentée dans l'outil), diff `git diff --find-renames <base>...<head>`, contenu d'un fichier via `git show <headCommit>:<path>`.
- `working_tree` : diff de HEAD vers le working tree, index compris (`git diff --find-renames HEAD`), fichiers non suivis inclus (`git ls-files --others --exclude-standard`, présentés comme ajoutés), contenu lu sur disque.
- Analyse du diff unifié en `FileDiff[]` (`src/core/diff-parser.ts`), fichiers binaires marqués `binary`.
- Tests avec de vrais dépôts temporaires (`mkdtemp` + `git init`), `user.name` / `user.email` configurés localement dans le dépôt de test.

## 6. Outils MCP

| Outil | Rôle |
|---|---|
| `create_analysis` | `repo_path`, `title`, `mode`, `base` (requis en `branch`), `head` (optionnel, `HEAD` par défaut), `request_text`, `request_source`. Calcule et fige le diff, renvoie l'id, la liste des fichiers et le lien GUI. |
| `list_analyses` | Liste id, titre, mode, refs, nombre de fichiers / constats, état de la revue. Point d'entrée. |
| `get_analysis` | Vue complète lisible : résumé, fichiers (revu ou non), constats (statut), remarques, schémas (titres), état de la revue. |
| `get_diff` | Diff figé d'un fichier (ou de tous) avec numéros de ligne ancien / nouveau, pour ancrer les constats sur les bonnes lignes. |
| `refresh_analysis` | Recalcule le snapshot ; recalcule `files` en conservant `reviewed` pour les fichiers dont le diff est inchangé ; passe en `outdated` les constats dont `anchorText` ne correspond plus. |
| `update_analysis` | Titre, `summary` (liste de puces), demande initiale. |
| `add_findings` | Ajout en lot ; validation des emplacements ; `anchorText` copié du snapshot. |
| `update_finding` | Modifie un constat (champs de l'agent ; `status` ne repasse à `open` que si l'agent le demande explicitement). |
| `delete_findings` | Suppression par ids. |
| `set_diagram` | Crée ou remplace entièrement un schéma (`diagram_id` optionnel), validation des liens et couches. |
| `delete_diagram` | Suppression. |
| `get_review_feedback` | Si la revue est soumise : décision, points retenus avec détails, prompt généré. Sinon indique que la revue n'est pas encore soumise et l'état d'avancement (fichiers revus). |
| `delete_analysis` | Supprime l'analyse et son snapshot. |
| `reconnect_gui` | Helpers de `@imenam/mcp-gui-interface`. |

Chaque mutation notifie la GUI (IPC → SSE).

## 7. GUI (fidèle aux maquettes, thème sombre)

- **Barre supérieure** : marque, sélecteur d'analyse (liste déroulante), bouton contextuel (« Commencer la revue » / « Terminer la revue »).
- **Accueil sans analyse** : état vide expliquant que l'agent crée les analyses avec `create_analysis`.
- **Écran Feature** (`#/<id>`) : titre, méta (mode, refs, nombre de fichiers, +/−), onglets :
  - *Résumé* : carte « Ce que l'agent a fait », demande initiale si présente, compteurs par gravité, liste des constats principaux, bouton « Copier le prompt pour l'agent » (tous les constats ouverts).
  - *Fichiers* : liste avec statut, +/−, revu.
  - *Constats* : liste complète filtrable par gravité et statut.
  - *Schémas* : sélecteur de schéma, rendu SVG à partir de `diagram-layout`, légende, zoom (−, +, ajuster), clic sur un nœud avec `location` → écran de revue au bon fichier et à la bonne ligne.
- **Écran Revue** (`#/<id>/review/<path>`) : panneau fichiers (progression, statut revu, pastilles de constats), en-tête du fichier (+/−, précédent / suivant, « Marquer comme revu »), diff avec numéros de ligne, constats insérés sous leurs lignes (gravité, titre, texte, correctif proposé, actions « Copier le prompt pour l'agent », « Ignorer » / « Rouvrir »), ajout de remarque sur une ligne ou sur le fichier.
- **Écran Fin de revue** (`#/<id>/finish`) : décision (Approuver / Demander des corrections / Rejeter), sélection des points à transmettre (constats ouverts + remarques), aperçu du prompt, « Copier le prompt », « Enregistrer le retour » (soumet la revue, lisible ensuite par `get_review_feedback`), « Retour à la revue ».
- **API du worker** : `GET /api/config`, `GET /api/analyses`, `GET /api/analyses/:id`, `GET /api/analyses/:id/diff`, `POST /api/analyses/:id/files/reviewed` (path, reviewed), `POST /api/analyses/:id/findings/:findingId/status`, `POST /api/analyses/:id/notes`, `DELETE /api/analyses/:id/notes/:noteId`, `POST /api/analyses/:id/review` (décision + sélection ; le prompt est calculé côté serveur), `GET /api/events` (SSE). Toutes les modifications passent par `store.mutate(id, "user", …, { baseRevision })`.

## 8. Tests

- `test/helpers.ts` : store dans un répertoire temporaire, création de dépôts git temporaires avec une branche de feature.
- Unitaires : parseur de diff, git (deux modes, renommage, binaire, fichier non suivi), store (atomicité, révision, concurrence entre deux instances, migration), invariants, `buildAgentPrompt`, `diagram-layout` (pas de chevauchement de nœuds, colonnes respectées, rangs croissants le long des liens).
- Outils : chaque outil, cas nominal et erreurs (textes vérifiés).
- e2e : lancement de `dist/src/index.js` avec un proxy (`E2E_PROXY_URL`, défaut `http://localhost:3000`, test ignoré si le proxy est absent) ; boucle complète agent → GUI (API HTTP : marquer revu, ignorer, remarque, soumettre) → agent (`get_review_feedback`).
- `npm run build && npm test` sans échec à chaque fin de phase.

## 9. Phases de réalisation

| Phase | Contenu | Critère de validation |
|---|---|---|
| 1. Socle | `package.json` via npm, tsconfig, scripts, `.gitignore`, `src/index.ts` (logging, config, GuiLauncher, `reconnect_gui`, dispatch vide), `gui-worker.ts` minimal (health, SSE, statique, `<base>`), squelette GUI Vite/React, `setup-mcp`, génération de version | build complet OK ; test : le serveur répond à `tools/list` ; test de `setup-mcp` |
| 2. Cœur | schémas zod, store, migrations, ids, git + parseur de diff, validation des emplacements, `buildAgentPrompt` | tests unitaires verts, dépôts git temporaires |
| 3. Outils MCP | tous les outils du §6 (sauf rendu), `instructions`, notifications IPC | tests d'outils verts ; `tools/list` expose tout |
| 4. GUI de revue | API worker complète, écrans Résumé / Fichiers / Constats / Revue / Fin de revue, SSE | e2e vert ; vérification visuelle par rapport aux maquettes 1 à 3 |
| 5. Schémas | `diagram-layout`, onglet Schémas, rendu SVG, navigation vers la revue | tests de layout verts ; vérification visuelle par rapport aux maquettes 4 et 5, plus une carte mentale |
| 6. Finalisation | README complet (structure mcp-design), relecture globale (commentaires, replis), essai de bout en bout réel sur un dépôt | `npm run build && npm test` vert, README à jour |

L'orchestrateur valide chaque phase (build, tests, relecture du code, règle des commentaires, absence de repli) puis commite avant de lancer la suivante.
