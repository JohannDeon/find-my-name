# Relais TMDB (Cloudflare Worker)

Ce relais garde la clé TMDB secrète : elle n'apparaît plus dans le code du site ni dans le navigateur des visiteurs.

1. Créez un compte gratuit sur https://dash.cloudflare.com/sign-up
2. **Workers & Pages → Create → Create Worker**, nommez-le `find-my-name`, puis **Deploy**.
3. **Edit code** : remplacez tout le contenu par celui de `tmdb-proxy.js`, puis **Deploy**.
4. **Settings → Variables and Secrets** :
   - `TMDB_API_KEY` en type **Secret** = votre clé API v3 ;
   - `ALLOWED_ORIGIN` en type **Text** = `https://johanndeon.github.io`.
5. Copiez l'adresse du worker (ex. `https://find-my-name.<vous>.workers.dev`) dans `config.js` :
   `window.TMDB_PROXY_URL = "https://find-my-name.<vous>.workers.dev";`
   et videz `window.TMDB_API_KEY`.

Le relais n'accepte que deux types de requêtes (recherche de personnes et filmographie), uniquement en lecture et uniquement depuis votre site.
