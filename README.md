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

Ou directement via `npx`, sans installation. Le serveur communique en JSON-RPC sur stdio : il est lancé par le client MCP (Claude Code, par exemple), pas à la main. Par défaut, il tourne sur la machine qui héberge le dépôt et y exécute `git` lui-même ; derrière un gateway, sur une autre machine, voir [Derrière mcp-http-gateway](#derrière-mcp-http-gateway).

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
| `MCP_FEATURE_ANALYZER_ROLE` | `standalone` (défaut) : `git` s'exécute sur la machine du serveur. `remote` : le serveur est derrière mcp-http-gateway et fait exécuter `git` sur la machine de l'agent. Une autre valeur fait refuser le démarrage. Lu au démarrage. |

`PROXY_URL` et `APP_PORT` s'excluent : `PROXY_URL` prime si les deux sont renseignés. **Si aucune des deux n'est définie, la GUI est désactivée** ; les outils MCP continuent de fonctionner. Un `APP_PORT` qui n'est pas un entier entre 1 et 65535 désactive aussi la GUI : le worker s'arrête en écrivant la raison sur sa sortie d'erreur.

### Derrière mcp-http-gateway

Placé dans un gateway ([mcp-http-gateway](https://www.npmjs.com/package/@imenam/mcp-http-gateway), éventuellement piloté par le gateway manager), le serveur tourne sur la machine du gateway et n'y trouve pas les dépôts de l'agent. En rôle `remote`, `create_analysis` et `refresh_analysis` font exécuter `git` et la lecture des fichiers **sur la machine de l'agent**, par son relais `mcp-http-gateway --mcp` (convention `_gateway_exec`). Le snapshot figé est ensuite conservé côté gateway, et les autres outils comme la GUI n'ont plus besoin du dépôt.

Côté gateway, dans le bloc `env` du serveur :

```json
{
  "MCP_SERVER_ROUTE": "/feature-analyzer",
  "MCP_FEATURE_ANALYZER_ROLE": "remote"
}
```

Côté agent, la route doit figurer dans la liste blanche d'exécution du relais :

```json
{
  "mcpServers": {
    "gateway": {
      "command": "npx",
      "args": ["-y", "@imenam/mcp-http-gateway", "--mcp"],
      "env": {
        "GATEWAY_URL": "https://gateway.example.com",
        "GATEWAY_TOKEN": "…",
        "GATEWAY_EXEC_ROUTES": "/feature-analyzer"
      }
    }
  }
}
```

- `repo_path` est le chemin absolu de la racine du dépôt **sur la machine de l'agent**. `git` et `node` doivent y être dans le `PATH` : `node` lit les fichiers de la copie de travail.
- Sans `GATEWAY_EXEC_ROUTES`, `create_analysis` et `refresh_analysis` échouent en indiquant la route à ajouter ; aucun `git` n'est lancé côté gateway.
- Le relais limite la sortie de chaque commande à 1 Mio. Le diff est donc demandé fichier par fichier :
  - le diff d'un seul fichier qui dépasse 1 Mio fait échouer l'analyse, avec le nom du fichier ;
  - un fichier modifié de plus de 1 Mio est conservé sans contenu, comme en local ;
  - un fichier non suivi de plus de 1 Mio fait échouer l'analyse en mode `working_tree`.
- Les commandes sont envoyées au relais par paquets de 25. Le relais accepte 50 allers-retours par appel d'outil, soit environ 550 fichiers modifiés par analyse.
- L'endpoint natif `/mcp` du gateway n'a pas de relais agent : `create_analysis` et `refresh_analysis` n'y fonctionnent pas en rôle `remote`.

---

## Les outils

Quatorze outils. Les noms, descriptions et textes de résultat sont en anglais ; chaque résultat de modification se termine par le lien vers l'analyse dans la GUI (`Open the review: <url>#/<id>`) quand la GUI est active.

### Analyses

| Outil | Effet |
|---|---|
| `list_analyses` | Point d'entrée : les analyses regroupées par projet, chacune avec ses refs, ses constats ouverts par gravité, ses fichiers revus, son nombre de schémas et l'état de sa revue ; `project` limite la liste à un projet (un nom inconnu liste les projets existants). Invite l'agent à reprendre l'analyse existante d'une feature plutôt qu'à en créer une autre. Signale aussi les fichiers d'analyse illisibles. |
| `create_analysis` | Calcule et fige le diff : `repo_path` (racine absolue du dépôt), `project` (projet ou feature, dossier de rangement, requis), `title`, `mode` (`branch` ou `working_tree`), `base` (requis en `branch`), `head` (en `branch`, défaut `HEAD`), `request_text` et `request_source` (la demande initiale : ticket, prompt). Renvoie l'identifiant et la liste des fichiers. |
| `get_analysis` | Vue complète : projet, demande, vue d'ensemble, résumé, fichiers (revus ou non), constats avec statut et emplacement, remarques du relecteur, schémas (signalés quand leur tracé a des croisements), état de la revue. |
| `update_analysis` | Change `title`, `project`, la vue d'ensemble (`objective`, `approach`, `attention_points`), `summary` (les changements fonctionnels de la feature, une puce par changement, remplace toute la liste) ou la demande initiale (`request_text`, `request_source` ; `null` efface). Les champs absents sont conservés. |
| `refresh_analysis` | Recalcule le diff avec le même dépôt, le même mode et les mêmes refs, après correction. Voir [Les deux modes de diff](#les-deux-modes-de-diff). |
| `delete_analysis` | Supprime l'analyse et son diff figé. Le dépôt n'est pas touché. Supprime aussi une analyse listée comme illisible. |

La **vue d'ensemble** est l'analyse globale de l'agent : l'objectif fonctionnel de la feature, l'approche retenue (architecture, flux principal) et les points d'attention à vérifier en priorité. Sans vue d'ensemble, `objective` et `approach` sont requis ensemble pour la créer (`attention_points` vaut alors une liste vide s'il est omis) ; ensuite, chaque champ donné remplace le précédent. `objective: null` retire toute la vue d'ensemble. L'objectif figure aussi en tête du prompt de retour.

L'**état de revue** est dérivé des fichiers revus et de la soumission (`shared/review-state.ts`) : `not_started` (aucun fichier revu), `in_progress` (au moins un), `files_reviewed` (tous, revue non soumise), `submitted` (avec sa décision).

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
| `set_diagram` | Crée un schéma, ou remplace entièrement celui de `diagram_id`. L'agent ne donne que des nœuds et des liens, sans coordonnées ni couleurs : la GUI place et colore. Le résultat contrôle le tracé : `No crossing.`, ou le nombre de croisements avec chaque paire de liens et chaque lien qui traverse un nœud, suivis de conseils (réordonner les nœuds, découper le schéma, changer de sorte). Le schéma est enregistré dans les deux cas. |
| `delete_diagram` | Supprime un schéma. |

Trois sortes de schéma (`kind`) :

- `flow` — un process, placé de gauche à droite le long des liens. Une branche secondaire sans jonction et le nœud terminal d'une chaîne descendent sous le nœud qui les précède, ce qui garde le flux compact ; les liens qui remontent le flux passent sous le schéma.
- `layers` — une colonne par entrée de `layers` (GUI, API, cœur, stockage…), chaque nœud dans sa couche : le périmètre d'impact.
- `mindmap` — un arbre radial autour de sa racine : la carte des concepts. Le schéma doit être un arbre (une seule racine, un seul parent pour chaque autre nœud, aucun cycle) ; sinon `set_diagram` le refuse en listant les problèmes.

Règles de lisibilité : un sujet par schéma, 5 à 12 nœuds, nœuds déclarés dans l'ordre de lecture (l'ordre de déclaration est l'ordre de départ de chaque rang ou colonne), aucun croisement attendu. Pour `flow` et `layers`, le placement part de l'ordre de déclaration et des ordres obtenus par balayages barycentriques, garde celui dont le tracé final a le moins de croisements et de traversées de nœuds, puis échange deux voisins d'un même rang tant que cela en retire. `shared/diagram-quality.ts` mesure ces croisements sur le tracé de `layoutDiagram`.

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
list_analyses   { project: "mon-projet" }           ← reprendre une analyse existante de la feature ?
create_analysis { repo_path: "C:/dev/mon-projet", project: "mon-projet", title: "Rafraîchissement OAuth",
                  mode: "branch", base: "master", request_text: "…", request_source: "TM-142" }
get_diff        { analysis_id }                     ← numéros de ligne du côté nouveau
update_analysis { analysis_id, objective: "…", approach: "…", attention_points: ["…"],
                  summary: ["…", "…"] }             ← vue d'ensemble et changements fonctionnels
add_findings    { analysis_id, findings: [...] }    ← y compris les requirement_gap
set_diagram     { analysis_id, kind: "flow", nodes: [...], links: [...] }

  … l'agent donne le lien à l'utilisateur, qui relit dans la GUI et enregistre son retour …

get_review_feedback { analysis_id }                 ← décision, points retenus, prompt
  … l'agent corrige le code …
refresh_analysis    { analysis_id }                 ← nouveau diff, nouveau tour de revue
```

---

## L'interface

Thème sombre. La barre supérieure porte la marque (un clic ramène à l'accueil), le sélecteur d'analyse groupé par projet avec l'état de revue de chaque analyse (sa valeur est la ref de tête, ou « Copie de travail »), l'état de la connexion et, pendant la revue, le bouton « Terminer la revue ».

### Accueil (`#/`)

Les analyses sont rangées par projet, dans des sections repliables. L'en-tête d'un projet compte ses analyses par état de revue. Chaque analyse affiche son titre, ses refs, la date de sa dernière modification, la progression des fichiers revus, ses constats ouverts par gravité (exigences manquantes comprises, ce que dit l'infobulle) et son état de revue : « Non commencée », « En cours », « Fichiers revus » ou « Soumise », suivi de la décision. Le filtre « À relire » (par défaut) masque les revues soumises, « Toutes » les montre. L'accueil n'ouvre aucune analyse d'office ; sans analyse, il explique que l'agent les crée avec `create_analysis`.

### Écran Feature (`#/<id>`)

Titre, mode et refs (un sha complet est abrégé à 7 caractères), nombre de fichiers, lignes ajoutées et supprimées, bouton « Commencer la revue » qui ouvre le premier fichier non revu. Quatre onglets, avec leur compteur : fichiers modifiés, constats **ouverts** (exigences manquantes comprises ; l'infobulle donne aussi le total), schémas :

- **Résumé** — la carte « Vue d'ensemble » (objectif, approche, points d'attention) quand l'agent l'a rédigée, « Ce que l'agent a fait », la demande initiale et sa source, la section « Constats ouverts » (compteurs par gravité, constats ouverts du plus grave au moins grave, lien « Voir les N constats, tous statuts confondus ») et « Copier le prompt pour l'agent » (tous les constats ouverts).
- **Fichiers** — chaque fichier avec son statut, ses `+`/`−`, ses constats ouverts par gravité et son état de revue.
- **Constats** — la liste complète, tous statuts, filtrable par gravité et par statut (ouvert, ignoré, obsolète) ; les puces comptent tous les statuts ; un clic ouvre le constat dans la revue.
- **Schémas** — sélecteur de schéma, qui passe à la ligne quand les schémas sont nombreux (un schéma dont le tracé présente des croisements porte l'étiquette « croisements »), rendu SVG, légende des statuts présents et des gravités des points de constat dessinés (« Constat ouvert (couleur de la gravité la plus haute) »), contrôles « − », « + », « Ajuster » (recentre et adapte le zoom), « Plein écran », et zoom à la molette. Un clic sur un nœud rattaché à un fichier ouvre la revue à ce fichier et à cette ligne. Un schéma qui ne peut pas être placé (carte mentale qui n'est pas un arbre, par exemple) affiche l'erreur à la place du dessin.

Le plein écran passe par l'API Fullscreen du navigateur : le schéma occupe l'écran, légende et contrôles restent visibles, le zoom est réajusté à l'entrée et à la sortie, Échap ou « Quitter le plein écran » en sortent. Si le navigateur refuse, un message l'indique sous le schéma.

L'ajustement à la fenêtre ne descend jamais sous l'échelle **0,85** : en dessous, les libellés deviennent illisibles. Un schéma plus grand s'ouvre sur son début, à cette échelle, et se parcourt en le faisant glisser (curseur main, indication « Glisser pour parcourir le schéma ») ; la vue reste bornée au schéma.

### Écran Revue (`#/<id>/review/<chemin>`)

- **Panneau des fichiers** — progression, fichiers groupés par dossier, état revu, pastilles des constats ouverts par gravité. Un nom trop long est tronqué au milieu (`reminder-sch…uler.ts`), l'extension reste visible et le chemin complet est en infobulle. Chaque pastille est un lien : elle ouvre le fichier sur son premier constat ouvert de cette gravité (`?line=N`) ; son infobulle le dit (« 3 constats mineurs ouverts — aller au premier »).
- **En-tête du fichier** — chemin, `+`/`−`, statut, fichier précédent et suivant, « Remarque sur le fichier », « Marquer comme revu ».
- **Diff** — numéros du côté nouveau et repère vertical à la couleur de la gravité le long des lignes visées par un constat. Le correctif proposé s'affiche à l'endroit où il s'applique : bandeau « Correctif proposé par l'agent — remplace les lignes X à Y » avec le numéro du constat et « Masquer le correctif », lignes visées barrées sur fond ambre, lignes proposées juste en dessous sur fond violet (marque « › », sans numéro). Le correctif est affiché d'office pour un constat ouvert ; masqué, ou pour un constat sans correctif, une pastille numérotée marque la première ligne visée. Deux correctifs dont les lignes se recouvrent ne s'affichent pas ensemble. Le fond ambre des lignes visées se distingue du rouge des lignes `−` supprimées par la feature. Une légende suit le diff, limitée aux fonds que le mode affiche : « Ajouté par la feature », « Supprimé par la feature », « Lignes remplacées par le correctif » (Avant / après), « Correctif proposé » ou « Correctif appliqué ». Un clic sur un numéro de ligne ouvre la saisie d'une remarque sur cette ligne. Les exigences manquantes sans emplacement s'affichent en bandeau au-dessus du diff de chaque fichier ; le bandeau « N exigences manquantes » se replie, et reste replié pour la session.
- **Affichage des correctifs** — le sélecteur « Correctifs », au-dessus du diff, propose trois modes, conservés d'un fichier à l'autre pendant la session :
  - « Sans correctif » : le diff seul, sans aucun correctif ; les interrupteurs des cartes sont inactifs.
  - « Avant / après » (par défaut) : le rendu décrit ci-dessus, lignes visées barrées puis lignes proposées.
  - « Code corrigé » : le code tel qu'il se lirait avec les correctifs appliqués. Les lignes visées disparaissent ; les lignes proposées prennent leur place, sur fond violet avec la marque « › » et sans numéro, sous un bandeau « Correctif N appliqué — remplace les lignes X à Y ». Un lien `?line=N` vers une ligne retirée met ce bandeau en évidence ; les remarques ne se posent que sur les lignes du diff, pas sur les lignes proposées.

  Dans les deux derniers modes, l'interrupteur de chaque carte (« Afficher le correctif dans le code » ou « Appliquer le correctif dans le code ») choisit les correctifs dessinés.
- **Colonne « Constats de ce fichier »** — l'en-tête compte les constats ouverts, et le total quand il diffère (« 4 ouverts · 5 au total »). Dessous, un index compact des constats (numéro à la couleur de la gravité et première ligne, ignorés et obsolètes atténués) : un clic fait défiler jusqu'aux lignes et à la carte, mises en évidence comme avec `?line`. Tant que des cartes de constat sont sous la partie visible, une indication collée en bas de la colonne les compte (« 3 constats plus bas ↓ ») ; un clic amène la suivante. Les constats, numérotés dans l'ordre de leur première ligne, sont des cartes alignées sur leur ligne et reliées au diff ; des cartes voisines s'empilent sans se chevaucher et défilent avec le diff. Chaque carte montre numéro, gravité, lignes, titre, explication, l'interrupteur « Afficher le correctif dans le code » (constat avec correctif) et les boutons « Copier le prompt », « Ignorer » / « Rouvrir », « Remarque ». Les constats ignorés ou obsolètes restent visibles, atténués. Les remarques de ligne sont des cartes alignées de la même façon, datées au format court (date complète en infobulle), avec « Modifier », qui rouvre le texte sur place dans la même saisie que la création, et « Supprimer » ; modifier une remarque retenue dans une revue déjà soumise recalcule le prompt enregistré ; les remarques sur le fichier entier et ce qui vise des lignes hors du diff affiché sont en tête de colonne. Sous 1200 px de large, la colonne passe sous le diff et ses cartes s'empilent.

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

`shared/` est importé à la fois par le serveur et par la GUI : schémas zod (`shared/schemas/`), prompt de retour (`prompt.ts`, utilisé par l'aperçu de la GUI et par `get_review_feedback`), placement des schémas (`diagram-layout.ts`, fonctions pures testées sous Node) et contrôle de leurs croisements (`diagram-quality.ts`), état de revue dérivé (`review-state.ts`), libellés et couleurs des gravités et statuts (`labels.ts`, `severity.ts`). Ce que l'utilisateur voit en aperçu est donc exactement ce que l'agent reçoit.

### Persistance

Un fichier JSON par analyse dans `<données>/analyses/<id>.json`, et son diff figé dans `<données>/diffs/<id>.json`. Les écritures sont atomiques (fichier temporaire puis `rename`), sérialisées entre processus par un verrou `.lock`, et le cache mémoire est invalidé dès que la date ou la taille du fichier change. Tout document est validé par zod à la lecture et à l'écriture ; `src/core/migrate.ts` met à niveau les anciens formats à la lecture : une analyse sans projet reçoit le nom du dossier du dépôt (`basename(repoPath)`), une analyse sans vue d'ensemble reçoit `overview: null`.

### Invariants

Toute modification, qu'elle vienne d'un outil ou de la GUI, passe par `AnalysisStore.mutate(id, editor, fn, { baseRevision })`, qui vérifie le schéma et les invariants avant d'écrire et incrémente la révision :

- refs cohérentes avec le mode (`branch` : ref et commit de tête ; `working_tree` : base `HEAD`, sans tête) ;
- identifiants uniques (fichiers, constats, remarques, schémas, nœuds d'un schéma) ;
- un constat ouvert vise un fichier de l'analyse dont le contenu est conservé, avec `1 ≤ startLine ≤ endLine ≤` nombre de lignes ; un `issue` a un emplacement ;
- les liens d'un schéma relient des nœuds existants ; en `layers`, chaque nœud est dans une couche déclarée ;
- la revue ne sélectionne que des constats et des remarques existants ;
- les champs issus du diff (dépôt, refs, commits, liste des fichiers hors « revu ») ne changent que par `refresh_analysis`.

### Les deux modes de diff

- **`branch`** — `git diff --find-renames <base>...<head>` : ce que la branche apporte depuis son point de départ. `head` vaut `HEAD` par défaut. Le contenu des fichiers est lu dans le commit de tête : en local, en deux commandes git quel que soit le nombre de fichiers (`ls-tree`, puis `cat-file --batch`) ; en rôle `remote`, par un `cat-file blob <commit>:<chemin>` par fichier.
- **`working_tree`** — `git diff --find-renames HEAD` : les modifications non commitées, index compris, plus les fichiers non suivis (hors `.gitignore`), présentés comme ajoutés. Le contenu est lu sur disque.

Le diff est **figé** à la création. `refresh_analysis` le recalcule : un fichier revu dont le diff n'a pas changé reste revu, les autres repassent à revoir ; un constat ouvert dont les lignes ne correspondent plus au texte copié passe à « obsolète », un constat obsolète dont les lignes correspondent de nouveau redevient ouvert ; la revue repart vierge.

### Rien n'est écrit dans le dépôt

Le serveur lance `git` sans shell, uniquement en lecture (`rev-parse`, `diff`, `ls-tree`, `cat-file`, `ls-files`), et lit les fichiers de la copie de travail. En rôle `remote`, ce sont les mêmes commandes `git`, plus un `node` qui écrit un fichier sur sa sortie standard, exécutées par le relais agent dans `repo_path`, avec `GIT_LITERAL_PATHSPECS=1` pour qu'un nom de fichier ne soit jamais lu comme un motif. Les correctifs proposés ne sont qu'affichés et transmis dans le prompt. `repo_path` doit être la racine absolue d'un dépôt git ; tout autre chemin est refusé avec un message explicite.

### Exposition réseau de la GUI

La GUI montre le code des dépôts analysés et ses retours sont lus par l'agent : elle n'est joignable que depuis la machine elle-même, avec la garde de requêtes de `@imenam/mcp-gui-interface` (`honoGuiGuard`).

- Le worker écoute sur `127.0.0.1` uniquement (`GUI_LISTEN_HOST`). L'accès depuis un autre poste passe par le proxy ou le gateway manager et leur authentification ; tous deux relaient vers `localhost:<port>`.
- L'en-tête `Host` doit désigner la boucle locale : une page tierce qui fait pointer son propre domaine vers `127.0.0.1` est refusée (`403`).
- Une requête de modification venant d'un autre site est refusée (`403`) : `Sec-Fetch-Site` doit valoir `same-origin` ou `none` et, en son absence, l'hôte de l'`Origin` doit être la machine ou le proxy. Une page web ouverte dans le navigateur ne peut pas soumettre de revue à la place du relecteur.

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
| `src/core/` | Stockage, git (local : `git.ts` ; machine de l'agent : `agent-repo.ts`, `gateway-exec.ts`), rôle, parseur de diff, emplacements, invariants, recalcul, actions du relecteur. |
| `src/cli/setup-mcp.ts` | Commande `--claude-setup-mcp`. |
| `shared/` | Code commun au serveur et à la GUI. |
| `gui/` | Application Vite + React 19 + zustand, CSS écrit à la main. |
| `test/` | Tests `node --test`. |

La suite comprend des tests unitaires (parseur de diff, git sur de vrais dépôts temporaires, en local et à travers un relais agent simulé, store, invariants, emplacements, recalcul, prompt, placement des schémas), des tests de chaque outil, et deux suites qui lancent un vrai serveur sur stdio :

- `test/gui-api.test.ts` — la GUI en mode standalone sur un port libre : API REST et boucle agent → GUI → agent. Elle ne dépend de rien d'extérieur.
- `test/e2e.test.ts` — l'enregistrement auprès du proxy (`E2E_PROXY_URL`, défaut `http://localhost:3000`), la balise `<base>`, le SSE et `reconnect_gui`. Sans proxy joignable, elle est ignorée plutôt qu'en échec.

Pour inspecter le worker sans traverser le proxy, ajoutez `?__direct=1` à l'URL de son port local : les assets ne sont alors pas préfixés par le chemin de montage.
