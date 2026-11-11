# Find My Name

Site statique : entrez un prénom ou un nom, et découvrez dans quels films et séries il apparaît au générique (acteurs et équipe technique). Les résultats se trient par popularité, date, note, nombre de votes, titre ou popularité de la personne, et se filtrent par type, rôle ou personne.

Les données viennent de [The Movie Database (TMDB)](https://www.themoviedb.org/).

## Clé API TMDB (gratuite)

1. Créez un compte sur https://www.themoviedb.org/signup
2. Allez dans **Paramètres → API** (https://www.themoviedb.org/settings/api) et demandez une clé « Developer ».
3. Deux options :
   - **Clé partagée** : collez-la dans `config.js` (`window.TMDB_API_KEY = "..."`). Tous les visiteurs pourront chercher sans rien faire. La clé sera visible publiquement, ce qui est sans danger pour une clé TMDB en lecture seule.
   - **Clé par visiteur** : laissez `config.js` vide ; chaque visiteur saisit sa clé via le bouton « ⚙ Clé API » (stockée dans son navigateur).

La clé v3 (courte) et le jeton d'accès v4 (commence par `eyJ`) sont acceptés.

## Mise en ligne sur GitHub Pages

Dépôt GitHub → **Settings → Pages** → Source : *Deploy from a branch*, branche `main`, dossier `/ (root)`. Le site sera disponible à `https://<utilisateur>.github.io/<dépôt>/`.

## Lien partageable

`https://<utilisateur>.github.io/<dépôt>/?q=Deon&m=last` lance directement la recherche (`m` = `first`, `last`, `any` ou `full`).

## Limites

- TMDB est la plus grande base ouverte de films et séries, mais elle ne contient pas absolument tous les génériques (surtout pour les petits techniciens ou les très vieux titres).
- Pour un prénom très courant (ex. « Jean »), il existe des milliers de personnes : le site en analyse au maximum 40 à 500, choisies par ordre de pertinence et de popularité TMDB.
