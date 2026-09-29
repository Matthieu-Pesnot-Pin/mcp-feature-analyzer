# Task 2 — Projets, vue d'ensemble, schémas lisibles et plein écran

**Date :** 2026-09-30
**Projet :** mcp-feature-analyzer
**Objectif :** quatre évolutions issues de l'utilisation réelle : une analyse globale de la feature, le rangement des analyses par projet avec leur état de revue, des schémas sans croisements, un vrai mode plein écran.

---

## 1. Vue d'ensemble de la feature

Le résumé en puces décrit les changements ; il manque une analyse globale de l'objectif.

- Nouveau champ `overview` de l'analyse :
  `{ objective: string, approach: string, attentionPoints: string[] } | null`
  - `objective` : ce que la feature doit permettre, du point de vue fonctionnel ;
  - `approach` : comment elle y parvient (choix d'architecture, flux principal) ;
  - `attentionPoints` : risques et points à vérifier en priorité par le relecteur.
- `update_analysis` accepte `objective`, `approach`, `attention_points`. Les descriptions et les `instructions` du serveur précisent que `summary` liste les changements fonctionnels de la feature (pas un résumé par fichier) et que `overview` donne l'analyse globale.
- GUI, onglet Résumé : une carte « Vue d'ensemble » en tête (Objectif, Approche, Points d'attention), avant « Ce que l'agent a fait ». Carte absente si `overview` est null.
- `get_analysis` et `get_review_feedback` affichent la vue d'ensemble.

## 2. Projets et état de revue

- Nouveau champ `project: string` de l'analyse (nom du projet ou de la feature, sert de dossier de rangement). Requis par `create_analysis` ; modifiable par `update_analysis`.
- Migration des analyses existantes : `project` = nom du dossier du dépôt (`basename(repoPath)`).
- `list_analyses` regroupe par projet et accepte un filtre `project`. Sa description invite l'agent à reprendre une analyse existante du projet (update, refresh) ou à en créer une nouvelle.
- État de revue dérivé, calculé dans `shared/` (fonction unique pour les outils et la GUI) :
  - `not_started` : aucun fichier revu, revue non soumise ;
  - `in_progress` : au moins un fichier revu, revue non soumise ;
  - `files_reviewed` : tous les fichiers revus, revue non soumise ;
  - `submitted` : revue soumise (avec sa décision).
  Libellés français et couleurs dans `shared/labels.ts`.
- GUI :
  - écran d'accueil `#/` : analyses regroupées par projet (projets repliables), pour chacune titre, refs, date, progression des fichiers, compteurs de constats ouverts, badge d'état de revue ; compteurs par état en tête de projet ; filtre « À relire / Toutes » ;
  - sélecteur de la barre supérieure groupé par projet, avec le badge d'état ; lien vers l'accueil depuis la marque ;
  - l'accueil n'ouvre plus automatiquement la dernière analyse.

## 3. Schémas clairs, sans croisement

- Contrôle géométrique partagé `shared/diagram-quality.ts` : à partir de `layoutDiagram`, liste des paires de liens qui se croisent et des liens qui traversent un nœud qu'ils ne relient pas.
- Disposition : réduction des croisements renforcée (balayages barycentre + transpositions locales, conservation de l'ordre avec le moins de croisements) pour `flow` et `layers`.
- `mindmap` : le schéma doit être un arbre (chaque nœud hors racine a exactement un parent, pas de cycle) ; refus explicite sinon.
- `set_diagram` : le résultat indique le nombre de croisements et les liens concernés, et demande de corriger (réordonner les nœuds, découper en plusieurs schémas, changer de type). Les descriptions et les `instructions` posent les règles : 5 à 12 nœuds, un sujet par schéma, nœuds déclarés dans l'ordre de lecture, aucun croisement attendu.
- `get_analysis` signale les schémas qui contiennent des croisements.
- GUI : aucun changement de rendu nécessaire au-delà de la nouvelle disposition.

## 4. Plein écran du canevas

- Contrôles : « − », « + », « Ajuster » (recentre et adapte le zoom), « Plein écran » (bascule).
- Plein écran via l'API Fullscreen sur le conteneur du canevas : le schéma occupe l'écran, le zoom est réajusté à l'entrée et à la sortie, Échap quitte, l'icône et le libellé passent à « Quitter le plein écran ». Erreur explicite affichée si le navigateur refuse.

## 5. Tests

- Migration `project`, état de revue dérivé (les quatre cas), `update_analysis` avec `overview`, `list_analyses` groupé et filtré.
- `diagram-quality` : détection de croisements et de traversées sur des cas construits ; les fixtures des maquettes 4 et 5 et une carte mentale ne présentent aucun croisement ; `set_diagram` rapporte les croisements ; `mindmap` non arborescente refusée.
- API GUI : liste des analyses avec projet et état.
- Vérification visuelle : accueil par projets, carte Vue d'ensemble, plein écran.

## Phases

| Phase | Contenu |
|---|---|
| A. Modèle et outils | §1 à §3 côté schémas, migration, store, outils, instructions, qualité des schémas et disposition, tests |
| B. GUI | accueil par projets, sélecteur groupé, carte Vue d'ensemble, plein écran, vérification visuelle, README |
