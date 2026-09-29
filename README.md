# @imenam/mcp-feature-analyzer

Une table de relecture pour le code écrit par un agent IA, avec une interface graphique où un humain relit, trie et tranche.

L'agent qui vient de développer une feature ouvre une **analyse** : le serveur fige le diff git, l'agent y ajoute un résumé, des constats classés par gravité et des schémas. L'utilisateur relit le tout dans la GUI, fichier par fichier, ignore ce qui ne compte pas, annote, puis enregistre une décision. L'agent relit ensuite **exactement ce qui a été retenu**, sous la forme d'un prompt de correction prêt à suivre.

```
Agent ──create_analysis / add_findings / set_diagram──▶  Analyse  ◀──relecture, remarques──  Utilisateur (GUI)
  ▲                                                                                              │
  └──────────── get_review_feedback ──── décision, points retenus, prompt ◀── « Enregistrer le retour »
```

Le serveur n'appelle aucun LLM et n'écrit jamais dans le dépôt : il lit git, conserve l'analyse, et affiche.

---

## Installation

```bash
npm install -g @imenam/mcp-feature-analyzer
```

Ou directement via `npx`, sans installation. Le serveur communique en JSON-RPC sur stdio : il est lancé par le client MCP (Claude Code, par exemple), pas à la main. Il doit tourner sur la machine qui héberge le dépôt, puisqu'il y exécute `git` lui-même.

### Déclaration dans un projet

Depuis la racine du projet :

```bash
npx -y @imenam/mcp-feature-analyzer --claude-setup-mcp
```

La commande crée (ou complète) le `.mcp.json` du répertoire courant avec une entrée `mcp-feature-analyzer` dont les variables sont pré-remplies. Ajoutez `--force` pour remplacer une entrée existante ; les autres serveurs sont préservés. Un `.mcp.json` illisible fait échouer la commande, sans rien écrire.

Deux flags choisissent directement comment la GUI sera exposée :

```bash
# GUI derrière le proxy central
npx -y @imenam/mcp-feature-analyzer --claude-setup-mcp --proxy_url=http://localhost:3000

# GUI en accès direct, sans proxy : http://localhost:4600
npx -y @imenam/mcp-feature-analyzer --claude-setup-mcp --app_port=4600
```

Les deux flags sont exclusifs : la commande échoue si les deux sont passés. Sans l'un ni l'autre, `PROXY_URL` reçoit le modèle `http://localhost:` dont il reste à compléter le port.

Exemple d'entrée générée dans `C:/dev/mon-projet` avec `--proxy_url=http://localhost:3000` :

```json
{
  "mcpServers": {
    "mcp-feature-analyzer": {
      "command": "npx",
      "args": ["-y", "@imenam/mcp-feature-analyzer"],
      "env": {
        "PROXY_URL": "http://localhost:3000",
        "APP_PORT": "",
        "APP_GROUP": "Mon-projet",
        "APP_NAME": "Feature Analyzer Mon Projet",
        "APP_PATH": "/feature-analyzer-mon-projet",
        "MCP_FEATURE_ANALYZER_DATA_DIR": "C:/dev/mon-projet/.feature-analyzer-data",
        "MCP_LOG_DIR": ""
      }
    }
  }
}
```

Une variable laissée vide est inactive.

### Variables d'environnement

Elles se renseignent dans le champ `env` de `.mcp.json`, ou dans un fichier `.env` à la racine du package, qui prime et est relu à chaque relance de la GUI.

| Variable | Rôle |
|---|---|
| `PROXY_URL` | URL du [proxy central](https://github.com/imenam/proxy-setup) : le proxy attribue le port et monte la GUI sous `APP_PATH`. Prime sur `APP_PORT`. |
| `APP_PORT` | Port local utilisé **quand `PROXY_URL` est absent** : la GUI est servie directement sur `http://localhost:<port>`, à la racine. |
| `APP_PATH` | Chemin de montage de la GUI derrière le proxy (défaut `/feature-analyzer`). Ignoré en mode `APP_PORT`. |
| `APP_PATH_PREFIX` | Préfixe de namespace appliqué au chemin par le client proxy partagé ; le `<base href>` de la GUI suit le chemin réellement enregistré. |
| `APP_NAME` | Nom affiché dans le dashboard du proxy (défaut `Feature Analyzer`). |
| `APP_GROUP` | Section repliable du dashboard du proxy (facultatif). |
| `MCP_FEATURE_ANALYZER_DATA_DIR` | Répertoire de stockage des analyses. À défaut : `MCP_DATA_DIR`, puis `<package>/.feature-analyzer-data`. |
| `MCP_LOG_DIR` | Répertoire des logs. Défaut : `<données>/logs`. Lu au démarrage, depuis la déclaration du serveur. |

`PROXY_URL` et `APP_PORT` s'excluent : `PROXY_URL` prime si les deux sont renseignés. **Si aucune des deux n'est définie, la GUI est désactivée** ; les outils MCP continuent de fonctionner. Un `APP_PORT` qui n'est pas un entier entre 1 et 65535 désactive aussi la GUI : le worker s'arrête en écrivant la raison sur sa sortie d'erreur.

---

## Les outils

Quatorze outils. Les noms, descriptions et textes de résultat sont en anglais ; chaque résultat de modification se termine par le lien vers l'analyse dans la GUI (`Open the review: <url>#/<id>`) quand la GUI est active.

### Analyses

| Outil | Effet |
|---|---|
| `list_analyses` | Point d'entrée : chaque analyse avec ses refs, ses constats ouverts par gravité, ses fichiers revus, son nombre de schémas et l'état de la revue. Signale aussi les fichiers d'analyse illisibles. |
| `create_analysis` | Calcule et fige le diff : `repo_path` (racine absolue du dépôt), `title`, `mode` (`branch` ou `working_tree`), `base` (requis en `branch`), `head` (en `branch`, défaut `HEAD`), `request_text` et `request_source` (la demande initiale : ticket, prompt). Renvoie l'identifiant et la liste des fichiers. |
| `get_analysis` | Vue complète : demande, résumé, fichiers (revus ou non), constats avec statut et emplacement, remarques du relecteur, schémas, état de la revue. |
| `update_analysis` | Change `title`, `summary` (une puce par chaîne, remplace toute la liste) ou la demande initiale (`request_text`, `request_source` ; `null` efface). |
| `refresh_analysis` | Recalcule le diff avec le même dépôt, le même mode et les mêmes refs, après correction. Voir [Les deux modes de diff](#les-deux-modes-de-diff). |
| `delete_analysis` | Supprime l'analyse et son diff figé. Le dépôt n'est pas touché. Supprime aussi une analyse listée comme illisible. |

### Diff

| Outil | Effet |
|---|---|
| `get_diff` | Diff figé d'un fichier (`path`) ou de tous, avec pour chaque ligne son numéro ancien et son numéro nouveau. **Les constats, remarques et nœuds s'ancrent toujours sur les numéros du côté nouveau** (deuxième colonne). |

### Constats

| Outil | Effet |
|---|---|
| `add_findings` | Ajoute un lot de constats. Chacun a une gravité (`critical`, `major`, `minor`, `trivial`), une nature (`issue` par défaut, ou `requirement_gap` pour un comportement demandé mais absent), un titre, un corps, et selon le cas `path` + `start_line` (+ `end_line`), une `suggestion` (texte de remplacement des lignes visées, conservé tel quel) et un `prompt` propre. Les lignes visées sont copiées du diff figé. Un seul constat invalide et **rien n'est ajouté** ; toutes les erreurs sont listées. |
| `update_finding` | Modifie les champs d'un constat. Un nouvel emplacement est vérifié contre le diff et rouvre un constat obsolète ; `path: null` retire l'emplacement (`requirement_gap` seulement). Le statut « ignoré » appartient au relecteur et ne se change pas ici. |
| `delete_findings` | Supprime des constats par identifiant et les retire de la sélection de la revue. Un identifiant inconnu fait échouer l'appel sans rien supprimer. |

Un `issue` a toujours un emplacement ; un `requirement_gap` peut ne pas en avoir. Une `suggestion` n'est jamais appliquée : la GUI l'affiche (lignes actuelles barrées, lignes proposées) et le prompt la transmet.

### Schémas

| Outil | Effet |
|---|---|
| `set_diagram` | Crée un schéma, ou remplace entièrement celui de `diagram_id`. L'agent ne donne que des nœuds et des liens, sans coordonnées ni couleurs : la GUI place et colore. |
| `delete_diagram` | Supprime un schéma. |

Trois sortes de schéma (`kind`) :

- `flow` — un process, placé de gauche à droite le long des liens. Une branche secondaire sans jonction et le nœud terminal d'une chaîne descendent sous le nœud qui les précède, ce qui garde le flux compact ; les liens qui remontent le flux passent sous le schéma.
- `layers` — une colonne par entrée de `layers` (GUI, API, cœur, stockage…), chaque nœud dans sa couche : le périmètre d'impact.
- `mindmap` — un arbre radial autour du premier nœud sans parent : la carte des concepts.

Chaque nœud a un `id`, un `label`, une forme `shape` (`box` par défaut, `pill`, `decision` en losange) et un statut `status` qui fixe sa couleur : `new`, `modified`, `impacted`, `existing` (défaut), `finding`, `missing` (dessiné en contour). `detail` s'affiche au survol ; `path` (fichier modifié de l'analyse) et `line` rendent le nœud cliquable vers la revue. Un lien a `from`, `to` et un `label` facultatif.

### Retour de revue

| Outil | Effet |
|---|---|
| `get_review_feedback` | Une fois la revue soumise : décision (`approve`, `request_changes`, `reject`), constats et remarques retenus avec leur détail, et le prompt généré, recopié tel quel. Avant la soumission : l'avancement (fichiers revus, constats ignorés, remarques). Lecture seule. |

Le retour se lit **avant** `refresh_analysis`, qui le remplace par une revue vierge.

### GUI

| Outil | Effet |
|---|---|
| `reconnect_gui` | Relance le worker GUI et le réenregistre auprès du proxy, par exemple quand le proxy a démarré après le serveur. `force: true` redémarre même un worker qui semble vivant. En mode `APP_PORT`, il indique l'état de la GUI et la marche à suivre si elle ne tourne pas. |

---

## Boucle de travail type

```
create_analysis { repo_path: "C:/dev/mon-projet", title: "Rafraîchissement OAuth",
                  mode: "branch", base: "master", request_text: "…", request_source: "TM-142" }
get_diff        { analysis_id }                     ← numéros de ligne du côté nouveau
update_analysis { analysis_id, summary: ["…", "…"] }
add_findings    { analysis_id, findings: [...] }    ← y compris les requirement_gap
set_diagram     { analysis_id, kind: "flow", nodes: [...], links: [...] }

  … l'agent donne le lien à l'utilisateur, qui relit dans la GUI et enregistre son retour …

get_review_feedback { analysis_id }                 ← décision, points retenus, prompt
  … l'agent corrige le code …
refresh_analysis    { analysis_id }                 ← nouveau diff, nouveau tour de revue
```

---

## L'interface

Thème sombre. La barre supérieure porte la marque, le sélecteur d'analyse (la plus récente s'ouvre par défaut), l'état de la connexion et, pendant la revue, le bouton « Terminer la revue ». Sans analyse, l'accueil explique que l'agent les crée avec `create_analysis`.

### Écran Feature (`#/<id>`)

Titre, mode et refs (un sha complet est abrégé à 7 caractères), nombre de fichiers, lignes ajoutées et supprimées, bouton « Commencer la revue » qui ouvre le premier fichier non revu. Quatre onglets :

- **Résumé** — « Ce que l'agent a fait », la demande initiale et sa source, les compteurs par gravité, les constats ouverts du plus grave au moins grave, et « Copier le prompt pour l'agent » (tous les constats ouverts).
- **Fichiers** — chaque fichier avec son statut, ses `+`/`−` et son état de revue.
- **Constats** — la liste complète, filtrable par gravité et par statut (ouvert, ignoré, obsolète) ; un clic ouvre le constat dans la revue.
- **Schémas** — sélecteur de schéma, rendu SVG, légende des statuts présents, zoom (−, +, ajuster à la fenêtre, molette). Un clic sur un nœud rattaché à un fichier ouvre la revue à ce fichier et à cette ligne.

L'ajustement à la fenêtre ne descend jamais sous l'échelle **0,85** : en dessous, les libellés deviennent illisibles. Un schéma plus grand s'ouvre sur son début, à cette échelle, et se parcourt en le faisant glisser (curseur main, indication « Glisser pour parcourir le schéma ») ; la vue reste bornée au schéma.

### Écran Revue (`#/<id>/review/<chemin>`)

- **Panneau des fichiers** — progression, fichiers groupés par dossier, état revu, pastilles des constats ouverts par gravité.
- **En-tête du fichier** — chemin, `+`/`−`, statut, fichier précédent et suivant, « Remarque sur le fichier », « Marquer comme revu ».
- **Diff** — numéros du côté nouveau, lignes visées surlignées à la couleur de leur gravité, constats insérés sous leur dernière ligne : gravité, titre, corps, correctif proposé, « Copier le prompt pour l'agent », « Ignorer » / « Rouvrir », « Ajouter une remarque ». Un clic sur un numéro de ligne ouvre la saisie d'une remarque sur cette ligne. Les exigences manquantes s'affichent en bandeau sur le premier fichier ; ce qui vise des lignes hors du diff affiché apparaît en tête du fichier.

Un fichier binaire, supprimé ou de plus de 1 Mo n'a pas de contenu conservé : on ne peut pas y ancrer de constat ni de remarque de ligne, seulement une remarque sur le fichier entier.

### Écran Fin de revue (`#/<id>/finish`)

Décision (Approuver, Demander des corrections, Rejeter ; « Demander des corrections » est proposée d'emblée dès qu'il y a des points), points à transmettre (constats ouverts et remarques, tous cochés pour une revue en attente, la sélection enregistrée pour une revue déjà soumise), aperçu du prompt qui se met à jour, « Copier le prompt », « Retour à la revue » et « Enregistrer le retour », qui soumet la revue lue ensuite par `get_review_feedback`.

Toute modification faite par l'agent pendant que la GUI est ouverte y apparaît en direct, via SSE. Chaque action de la GUI porte la révision affichée : si l'analyse a changé entre-temps, l'action est refusée, l'analyse rechargée, et un message invite à refaire l'action.

---

## Architecture

Deux processus, conformément au standard de l'écosystème (`@imenam/mcp-gui-interface`) :

- **Maître MCP** (`src/index.ts`) — JSON-RPC sur stdio, outils (`src/tools/`, une fonction pure par outil), logique métier (`src/core/`), stockage, cycle de vie du worker via `GuiLauncher`.
- **Worker GUI** (`src/gui-worker.ts`) — serveur Hono, enregistrement auprès du proxy via `ProxyClient` ou écoute sur `APP_PORT`, API REST et SSE (`/api/events`), fichiers de la SPA avec la balise `<base>` du chemin de montage.

Le worker ne lit ni n'écrit aucune donnée : chaque requête REST est transmise au maître par IPC (messages `{type, correlationId, data, error, timestamp}` validés par zod) et le maître pousse les changements, que le worker relaie en SSE. Le worker s'arrête quand le maître disparaît (canal IPC fermé, PID parent absent) ou quand une autre instance est déjà enregistrée, ce qui évite les GUI orphelines.

`shared/` est importé à la fois par le serveur et par la GUI : schémas zod (`shared/schemas/`), prompt de retour (`prompt.ts`, utilisé par l'aperçu de la GUI et par `get_review_feedback`), placement des schémas (`diagram-layout.ts`, fonctions pures testées sous Node), libellés et couleurs des gravités et statuts (`labels.ts`, `severity.ts`). Ce que l'utilisateur voit en aperçu est donc exactement ce que l'agent reçoit.

### Persistance

Un fichier JSON par analyse dans `<données>/analyses/<id>.json`, et son diff figé dans `<données>/diffs/<id>.json`. Les écritures sont atomiques (fichier temporaire puis `rename`), sérialisées entre processus par un verrou `.lock`, et le cache mémoire est invalidé dès que la date ou la taille du fichier change. Tout document est validé par zod à la lecture et à l'écriture ; `src/core/migrate.ts` met à niveau les anciens formats à la lecture.

### Invariants

Toute modification, qu'elle vienne d'un outil ou de la GUI, passe par `AnalysisStore.mutate(id, editor, fn, { baseRevision })`, qui vérifie le schéma et les invariants avant d'écrire et incrémente la révision :

- refs cohérentes avec le mode (`branch` : ref et commit de tête ; `working_tree` : base `HEAD`, sans tête) ;
- identifiants uniques (fichiers, constats, remarques, schémas, nœuds d'un schéma) ;
- un constat ouvert vise un fichier de l'analyse dont le contenu est conservé, avec `1 ≤ startLine ≤ endLine ≤` nombre de lignes ; un `issue` a un emplacement ;
- les liens d'un schéma relient des nœuds existants ; en `layers`, chaque nœud est dans une couche déclarée ;
- la revue ne sélectionne que des constats et des remarques existants ;
- les champs issus du diff (dépôt, refs, commits, liste des fichiers hors « revu ») ne changent que par `refresh_analysis`.

### Les deux modes de diff

- **`branch`** — `git diff --find-renames <base>...<head>` : ce que la branche apporte depuis son point de départ. `head` vaut `HEAD` par défaut. Le contenu des fichiers est lu dans le commit de tête, en deux commandes git quel que soit le nombre de fichiers (`ls-tree`, puis `cat-file --batch`).
- **`working_tree`** — `git diff --find-renames HEAD` : les modifications non commitées, index compris, plus les fichiers non suivis (hors `.gitignore`), présentés comme ajoutés. Le contenu est lu sur disque.

Le diff est **figé** à la création. `refresh_analysis` le recalcule : un fichier revu dont le diff n'a pas changé reste revu, les autres repassent à revoir ; un constat ouvert dont les lignes ne correspondent plus au texte copié passe à « obsolète », un constat obsolète dont les lignes correspondent de nouveau redevient ouvert ; la revue repart vierge.

### Rien n'est écrit dans le dépôt

Le serveur lance `git` sans shell, uniquement en lecture (`rev-parse`, `diff`, `ls-tree`, `cat-file`, `ls-files`), et lit les fichiers de la copie de travail. Les correctifs proposés ne sont qu'affichés et transmis dans le prompt. `repo_path` doit être la racine absolue d'un dépôt git ; tout autre chemin est refusé avec un message explicite.

---

## Développement

```bash
npm install
npm run build   # version, backend (tsc -> dist/), puis GUI (gui/dist)
npm test        # node --test sur dist/test
cd gui && npm run lint   # oxlint
```

| Dossier | Contenu |
|---|---|
| `src/index.ts` | Maître MCP : déclaration des outils, `instructions`, IPC, lancement de la GUI. |
| `src/gui-worker.ts` | Worker GUI : Hono, REST, SSE, fichiers statiques, proxy. |
| `src/tools/` | Un fichier par outil, `(store, args) => résultat`. |
| `src/core/` | Stockage, git, parseur de diff, emplacements, invariants, recalcul, actions du relecteur. |
| `src/cli/setup-mcp.ts` | Commande `--claude-setup-mcp`. |
| `shared/` | Code commun au serveur et à la GUI. |
| `gui/` | Application Vite + React 19 + zustand, CSS écrit à la main. |
| `test/` | Tests `node --test`. |

La suite comprend des tests unitaires (parseur de diff, git sur de vrais dépôts temporaires, store, invariants, emplacements, recalcul, prompt, placement des schémas), des tests de chaque outil, et deux suites qui lancent un vrai serveur sur stdio :

- `test/gui-api.test.ts` — la GUI en mode standalone sur un port libre : API REST et boucle agent → GUI → agent. Elle ne dépend de rien d'extérieur.
- `test/e2e.test.ts` — l'enregistrement auprès du proxy (`E2E_PROXY_URL`, défaut `http://localhost:3000`), la balise `<base>`, le SSE et `reconnect_gui`. Sans proxy joignable, elle est ignorée plutôt qu'en échec.

Pour inspecter le worker sans traverser le proxy, ajoutez `?__direct=1` à l'URL de son port local : les assets ne sont alors pas préfixés par le chemin de montage.
