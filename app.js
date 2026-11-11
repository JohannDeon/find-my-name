(() => {
  "use strict";

  const API = "https://api.themoviedb.org/3";
  const IMG = "https://image.tmdb.org/t/p/";
  const LANG = "fr-FR";
  const PAGE_SIZE = 60;
  const CONCURRENCY = 6;
  const KEY_STORAGE = "fmn_tmdb_key";
  // Relais optionnel qui garde la clé secrète côté serveur (voir worker/README.md).
  const PROXY = String(window.TMDB_PROXY_URL || "").replace(/\/+$/, "");

  const $ = (id) => document.getElementById(id);
  const els = {
    form: $("search-form"), q: $("q"), go: $("go"), match: $("match"), maxPeople: $("max-people"),
    settingsBtn: $("settings-btn"), settings: $("settings"), apiKey: $("api-key"),
    settingsCancel: $("settings-cancel"), settingsSave: $("settings-save"),
    status: $("status"), bar: $("bar"), statusText: $("status-text"),
    people: $("people"), peopleTitle: $("people-title"), peopleList: $("people-list"),
    results: $("results"), resultsTitle: $("results-title"), list: $("list"), more: $("more"),
    sort: $("sort"), type: $("type"), role: $("role"), filter: $("filter"), intro: $("intro"),
  };

  // ---------- Clé API ----------
  function storage(fn, fallback) { try { return fn(); } catch { return fallback; } }
  function getKey() {
    return (storage(() => localStorage.getItem(KEY_STORAGE), "") || window.TMDB_API_KEY || "").trim();
  }
  function setKey(k) { storage(() => k ? localStorage.setItem(KEY_STORAGE, k) : localStorage.removeItem(KEY_STORAGE)); }
  function openSettings() {
    els.apiKey.value = storage(() => localStorage.getItem(KEY_STORAGE), "") || "";
    els.settings.showModal();
    els.apiKey.focus();
  }
  if (PROXY) els.settingsBtn.hidden = true;
  els.settingsBtn.addEventListener("click", openSettings);
  els.settingsCancel.addEventListener("click", () => els.settings.close());
  els.settingsSave.addEventListener("click", () => {
    setKey(els.apiKey.value.trim());
    if (els.q.value.trim()) setTimeout(() => els.form.requestSubmit(), 0);
  });

  // ---------- Appels TMDB ----------
  class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

  async function tmdb(path, params = {}, signal) {
    const url = new URL((PROXY || API) + path);
    const headers = { accept: "application/json" };
    if (!PROXY) {
      const key = getKey();
      if (!key) throw new ApiError(401, "missing key");
      if (key.startsWith("eyJ")) headers.Authorization = "Bearer " + key; // jeton v4
      else url.searchParams.set("api_key", key);                         // clé v3
    }
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers, signal, credentials: "omit", referrerPolicy: "no-referrer" });
      if (res.status === 429 && attempt < 4) { await sleep(800 * (attempt + 1)); continue; }
      if (!res.ok) throw new ApiError(res.status, res.statusText);
      return res.json();
    }
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function pool(items, worker, limit, onDone) {
    let i = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        await worker(item);
        onDone();
      }
    });
    await Promise.all(runners);
  }

  // ---------- Correspondance des noms ----------
  const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const tokens = (s) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

  function nameMatches(name, qTokens, mode) {
    const t = tokens(name);
    const n = qTokens.length;
    if (!t.length || t.length < n) return false;
    const eq = (offset) => qTokens.every((q, j) => t[offset + j] === q);
    switch (mode) {
      case "first": return eq(0);
      case "last": return eq(t.length - n);
      case "full": return t.length === n && eq(0);
      default:
        for (let o = 0; o + n <= t.length; o++) if (eq(o)) return true;
        return false;
    }
  }

  // ---------- Recherche ----------
  let current = null; // { controller }
  let state = { titles: [], people: [], personFilter: null, shown: PAGE_SIZE };

  els.form.addEventListener("submit", (e) => { e.preventDefault(); run(); });

  async function run() {
    const query = els.q.value.trim().slice(0, 80);
    if (!query) return;
    if (!PROXY && !getKey()) { openSettings(); return; }

    const mode = els.match.value;
    const maxPeople = +els.maxPeople.value;
    const qTokens = tokens(query);
    if (!qTokens.length) return;

    if (current) current.controller.abort();
    const controller = new AbortController();
    current = { controller };
    const signal = controller.signal;

    els.intro.hidden = true;
    els.results.hidden = true;
    els.people.hidden = true;
    els.go.disabled = true;
    setStatus(0, `Recherche des personnes nommées « ${query} »…`);

    try {
      // 1) Personnes portant ce nom
      const people = [];
      let page = 1, totalPages = 1, scanned = 0;
      while (page <= totalPages && page <= 500 && people.length < maxPeople) {
        const data = await tmdb("/search/person", { query, page, include_adult: "false", language: LANG }, signal);
        totalPages = data.total_pages || 1;
        for (const p of data.results || []) {
          scanned++;
          if (people.length < maxPeople && nameMatches(p.name, qTokens, mode)) people.push(p);
        }
        setStatus(Math.min(0.25, (page / Math.min(totalPages, 25)) * 0.25),
          `Recherche des personnes… ${people.length} trouvée(s) sur ${scanned} profils examinés`);
        page++;
        // Les résultats TMDB sont triés par pertinence : si plusieurs pages d'affilée ne donnent rien, on arrête.
        if (page > 5 && people.length === 0) break;
      }

      if (!people.length) {
        setStatus(1, `Aucune personne trouvée pour « ${query} » avec ce mode de recherche. Essayez « Prénom ou nom ».`);
        return;
      }

      // 2) Filmographie de chaque personne
      const titles = new Map();
      let done = 0;
      setStatus(0.25, `Lecture des génériques de ${people.length} personne(s)…`);
      await pool(people, async (p) => {
        let credits;
        try { credits = await tmdb(`/person/${p.id}/combined_credits`, { language: LANG }, signal); }
        catch (err) { if (err.name === "AbortError" || err.status === 401) throw err; return; }
        for (const c of credits.cast || []) addCredit(titles, p, c, "cast", c.character || "");
        for (const c of credits.crew || []) addCredit(titles, p, c, "crew", c.job || c.department || "");
      }, CONCURRENCY, () => {
        done++;
        setStatus(0.25 + 0.75 * (done / people.length), `Lecture des génériques… ${done}/${people.length} personnes, ${titles.size} titres`);
      });

      state = {
        titles: [...titles.values()],
        people: people.map((p) => ({ id: p.id, name: p.name, popularity: p.popularity || 0, profile: p.profile_path, dept: p.known_for_department })),
        personFilter: null,
        shown: PAGE_SIZE,
        query,
      };
      els.status.hidden = true;
      renderPeople();
      render();
    } catch (err) {
      if (err.name === "AbortError") return;
      if (err.status === 401) {
        if (PROXY) setStatus(1, "Le relais n'a pas de clé TMDB valide (vérifiez le secret TMDB_API_KEY dans Cloudflare).");
        else { setStatus(1, "Clé API TMDB invalide ou manquante. Cliquez sur « ⚙ Clé API » pour la saisir."); openSettings(); }
      } else {
        setStatus(1, `Erreur pendant la recherche (${err.message || err}). Réessayez dans un instant.`);
      }
    } finally {
      if (current && current.controller === controller) els.go.disabled = false;
    }
  }

  function addCredit(map, person, c, kind, role) {
    const type = c.media_type === "tv" ? "tv" : "movie";
    const key = type + ":" + c.id;
    let t = map.get(key);
    if (!t) {
      const date = (type === "tv" ? c.first_air_date : c.release_date) || "";
      t = {
        key, id: c.id, type,
        title: c.title || c.name || c.original_title || c.original_name || "Sans titre",
        original: c.original_title || c.original_name || "",
        date, year: date.slice(0, 4),
        popularity: c.popularity || 0,
        rating: c.vote_count ? c.vote_average || 0 : 0,
        votes: c.vote_count || 0,
        poster: c.poster_path,
        genres: c.genre_ids || [],
        credits: [],
        kinds: new Set(),
        personIds: new Set(),
        personPop: 0,
      };
      map.set(key, t);
    }
    t.kinds.add(kind);
    t.personIds.add(person.id);
    t.personPop = Math.max(t.personPop, person.popularity || 0);
    const existing = t.credits.find((x) => x.personId === person.id && x.kind === kind);
    if (existing) {
      if (role && !existing.roles.includes(role)) existing.roles.push(role);
    } else {
      t.credits.push({ personId: person.id, name: person.name, kind, roles: role ? [role] : [] });
    }
  }

  // ---------- Affichage ----------
  function setStatus(progress, text) {
    els.status.hidden = false;
    els.bar.style.width = Math.round(progress * 100) + "%";
    els.statusText.textContent = text;
  }

  function filtered() {
    const type = els.type.value, role = els.role.value, f = norm(els.filter.value.trim());
    const pf = state.personFilter;
    return state.titles.filter((t) => {
      if (type !== "all" && t.type !== type) return false;
      if (pf && !t.personIds.has(pf)) return false;
      if (role !== "all") {
        const ok = t.credits.some((c) => c.kind === role && (!pf || c.personId === pf));
        if (!ok) return false;
      }
      if (f) {
        const hay = norm(t.title + " " + t.original + " " + t.credits.map((c) => c.name + " " + c.roles.join(" ")).join(" "));
        if (!hay.includes(f)) return false;
      }
      return true;
    });
  }

  const sorters = {
    popularity: (a, b) => b.popularity - a.popularity,
    date_desc: (a, b) => (b.date || "0").localeCompare(a.date || "0"),
    date_asc: (a, b) => (a.date || "9999").localeCompare(b.date || "9999"),
    rating: (a, b) => (b.rating - a.rating) || (b.votes - a.votes),
    votes: (a, b) => b.votes - a.votes,
    title: (a, b) => a.title.localeCompare(b.title, "fr", { sensitivity: "base" }),
    person: (a, b) => (b.personPop - a.personPop) || (b.popularity - a.popularity),
  };

  function render() {
    const items = filtered().sort(sorters[els.sort.value] || sorters.popularity);
    const movies = items.filter((t) => t.type === "movie").length;
    els.results.hidden = false;
    els.resultsTitle.textContent =
      `${items.length} titre${items.length > 1 ? "s" : ""} · ${movies} film${movies > 1 ? "s" : ""}, ${items.length - movies} série${items.length - movies > 1 ? "s" : ""}`;

    const frag = document.createDocumentFragment();
    for (const t of items.slice(0, state.shown)) frag.appendChild(card(t));
    els.list.replaceChildren(frag);
    els.more.hidden = items.length <= state.shown;
    els.more.textContent = `Afficher plus (${items.length - state.shown} restants)`;
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "Aucun titre ne correspond à ces filtres.";
      els.list.appendChild(li);
    }
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function card(t) {
    const li = el("li", "item");
    const url = `https://www.themoviedb.org/${t.type}/${t.id}?language=fr-FR`;

    const a = el("a", "poster");
    a.href = url; a.target = "_blank"; a.rel = "noopener";
    if (t.poster) {
      const img = el("img");
      img.src = IMG + "w154" + t.poster; img.alt = ""; img.loading = "lazy";
      a.appendChild(img);
    } else a.appendChild(el("span", "noposter", t.type === "tv" ? "📺" : "🎞"));
    li.appendChild(a);

    const body = el("div", "body");
    const h = el("h3");
    const link = el("a", null, t.title);
    link.href = url; link.target = "_blank"; link.rel = "noopener";
    h.appendChild(link);
    if (t.year) h.appendChild(el("span", "year", ` (${t.year})`));
    body.appendChild(h);

    const meta = el("div", "meta");
    meta.appendChild(el("span", "badge " + t.type, t.type === "tv" ? "Série" : "Film"));
    if (t.votes) meta.appendChild(el("span", null, `★ ${t.rating.toFixed(1)} (${t.votes.toLocaleString("fr-FR")} votes)`));
    meta.appendChild(el("span", null, `Popularité ${Math.round(t.popularity * 10) / 10}`));
    body.appendChild(meta);

    const who = el("ul", "who");
    const credits = state.personFilter ? t.credits.filter((c) => c.personId === state.personFilter) : t.credits;
    for (const c of credits.slice(0, 6)) {
      const row = el("li");
      row.appendChild(el("strong", null, c.name));
      const roleText = c.roles.length ? c.roles.slice(0, 3).join(", ") : (c.kind === "cast" ? "Interprétation" : "Équipe");
      row.appendChild(el("span", c.kind, ` · ${c.kind === "cast" ? "joue " : ""}${roleText}`));
      who.appendChild(row);
    }
    if (credits.length > 6) who.appendChild(el("li", "more-people", `+ ${credits.length - 6} autre(s)`));
    body.appendChild(who);

    li.appendChild(body);
    return li;
  }

  function renderPeople() {
    const ppl = [...state.people].sort((a, b) => b.popularity - a.popularity);
    els.people.hidden = false;
    els.peopleTitle.textContent = `${ppl.length} personne${ppl.length > 1 ? "s" : ""} trouvée${ppl.length > 1 ? "s" : ""} · cliquez pour filtrer`;
    const frag = document.createDocumentFragment();
    for (const p of ppl) {
      const b = el("button", "chip");
      b.type = "button";
      b.dataset.id = p.id;
      if (p.profile) {
        const img = el("img"); img.src = IMG + "w45" + p.profile; img.alt = ""; img.loading = "lazy";
        b.appendChild(img);
      }
      b.appendChild(el("span", null, p.name));
      b.title = p.dept ? `Connu·e pour : ${p.dept}` : "";
      b.addEventListener("click", () => {
        state.personFilter = state.personFilter === p.id ? null : p.id;
        for (const c of els.peopleList.children) c.classList.toggle("active", +c.dataset.id === state.personFilter);
        state.shown = PAGE_SIZE;
        render();
      });
      frag.appendChild(b);
    }
    els.peopleList.replaceChildren(frag);
  }

  for (const c of [els.sort, els.type, els.role]) c.addEventListener("change", () => { state.shown = PAGE_SIZE; render(); });
  let filterTimer;
  els.filter.addEventListener("input", () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { state.shown = PAGE_SIZE; render(); }, 150);
  });
  els.more.addEventListener("click", () => { state.shown += PAGE_SIZE; render(); });

  // Lien partageable (?q=…&m=…) : la recherche est lancée puis retirée de l'adresse,
  // pour qu'aucun nom ne reste dans la barre d'adresse ni ne soit prérempli au rechargement.
  const params = new URLSearchParams(location.search);
  if (params.has("q") || params.has("m")) history.replaceState(null, "", location.pathname);
  if (params.get("m") && [...els.match.options].some((o) => o.value === params.get("m"))) els.match.value = params.get("m");
  if (params.get("q")) { els.q.value = params.get("q").slice(0, 80); run(); }
  else els.q.value = "";
})();
