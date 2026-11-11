// Relais Cloudflare Worker : garde la clé TMDB secrète.
// Le site appelle ce relais, qui ajoute la clé côté serveur avant d'interroger TMDB.
// Variables à définir dans Cloudflare (Settings → Variables and Secrets) :
//   TMDB_API_KEY   (type « Secret ») : votre clé API v3 TMDB
//   ALLOWED_ORIGIN (type « Text »)   : https://johanndeon.github.io

const ALLOWED_PATHS = [/^\/search\/person$/, /^\/person\/\d{1,10}\/combined_credits$/];
const ALLOWED_PARAMS = ["query", "page", "language", "include_adult"];

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGIN || "";
    const cors = {
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "accept",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: cors });
    // Bloque les appels qui ne viennent pas du site (les navigateurs envoient toujours Origin en CORS).
    if (!allowed || origin !== allowed) return new Response("Forbidden", { status: 403 });

    const url = new URL(request.url);
    if (!ALLOWED_PATHS.some((re) => re.test(url.pathname))) return new Response("Not found", { status: 404, headers: cors });

    const target = new URL("https://api.themoviedb.org/3" + url.pathname);
    for (const k of ALLOWED_PARAMS) {
      const v = url.searchParams.get(k);
      if (v !== null) target.searchParams.set(k, v.slice(0, 100));
    }
    target.searchParams.set("api_key", env.TMDB_API_KEY);

    const cache = caches.default;
    const cacheKey = new Request(target.toString().replace(/api_key=[^&]+/, ""), { method: "GET" });
    let res = await cache.match(cacheKey);
    if (!res) {
      const upstream = await fetch(target, { headers: { accept: "application/json" } });
      res = new Response(upstream.body, {
        status: upstream.status,
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
      });
      if (upstream.ok) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
