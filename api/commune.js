// /api/commune.js (ESM)
// Doel: Vind Franse gemeente(s) en INSEE-code via geo.api.gouv.fr
// - POST { city, postcode? }  (JSON)  → { ok, matches: [...], commune? }
// - GET  ?city=...&postcode=...       → idem (voor snelle tests)
// - GET  ?ping=1                      → { ok:true, pong:true }
//
// Opzet:
// - Strikte server-side fetch (geen client keys of externe calls in de browser)
// - Best-effort rate limiting: 1 req/sec, max 8/min (per instance)
// - Kleine in-memory cache (TTL 10 min) per query

const GEO_BASE = "https://geo.api.gouv.fr/communes";
const calls = [];
const now = () => Date.now();

// --- simple in-memory cache (serverless, best-effort) ---
const CACHE = new Map(); // key -> { ts, data }
const TTL_MS = 10 * 60 * 1000; // 10 min
const MAX_KEYS = 100;
function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (now() - hit.ts > TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  return hit.data;
}
function cacheSet(key, data) {
  if (CACHE.size >= MAX_KEYS) {
    // delete oldest
    const oldestKey = [...CACHE.entries()].sort((a,b)=>a[1].ts-b[1].ts)[0]?.[0];
    if (oldestKey) CACHE.delete(oldestKey);
  }
  CACHE.set(key, { ts: now(), data });
}

// --- rate limit: 1 r/s, 8 r/min (per instance) ---
function pruneCalls() {
  const cutoff = now() - 60_000;
  while (calls.length && calls[0] < cutoff) calls.shift();
}
async function enforceRateLimit() {
  pruneCalls();
  if (calls.length >= 8) {
    const waitMs = (calls[0] + 60_000) - now();
    if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
    pruneCalls();
  }
  const last = calls[calls.length - 1];
  if (last && now() - last < 1_000) {
    await new Promise(r => setTimeout(r, 1_000 - (now() - last)));
  }
  calls.push(now());
}

// --- utils ---
function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
function sanitize(v) {
  return (typeof v === "string" ? v.trim() : "");
}
function toKey({ city, postcode }) {
  return `${(city||"").toLowerCase()}|${(postcode||"").toLowerCase()}`;
}
function mapCommune(c) {
  // geo.api.gouv.fr standaardvelden bij fields=...
  // c.code (INSEE), c.nom, c.codesPostaux[], c.centre.coordinates [lon,lat], c.departement{code,nom}
  const lon = Array.isArray(c?.centre?.coordinates) ? c.centre.coordinates[0] : null;
  const lat = Array.isArray(c?.centre?.coordinates) ? c.centre.coordinates[1] : null;
  return {
    insee: c?.code || null,
    name: c?.nom || null,
    postcodes: c?.codesPostaux || [],
    department: {
      code: c?.departement?.code || null,
      name: c?.departement?.nom || null
    },
    lat,
    lon
  };
}

// --- remote fetch ---
async function fetchCommunes({ city, postcode }) {
  const params = new URLSearchParams();
  if (city) params.set("nom", city);
  if (postcode) params.set("codePostal", postcode);
  params.set("fields", "nom,code,codesPostaux,centre,departement");
  params.set("boost", "population");
  params.set("limit", "10");
  params.set("format", "json");
  params.set("geometry", "centre");

  const url = `${GEO_BASE}?${params.toString()}`;

  // 8s timeout
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);

  await enforceRateLimit();
  let resp, data;
  try {
    resp = await fetch(url, { signal: ac.signal, headers: { "Accept": "application/json" } });
    const ct = resp.headers.get("content-type") || "";
    data = ct.includes("application/json") ? await resp.json() : await resp.text();
  } catch (err) {
    clearTimeout(t);
    const out = { ok: false, error: "Fetch naar geo.api.gouv.fr mislukt.", details: String(err) };
    const e = new Error(out.error);
    e.status = 502;
    e.out = out;
    throw e;
  } finally {
    clearTimeout(t);
  }

  if (!resp.ok) {
    const out = { ok: false, error: `geo.api.gouv.fr gaf HTTP ${resp.status}`, details: data };
    const e = new Error(out.error);
    e.status = resp.status || 502;
    e.out = out;
    throw e;
  }

  const arr = Array.isArray(data) ? data : [];
  return arr.map(mapCommune);
}

// --- handler ---
export default async function handler(req, res) {
  try {
    // GET ?ping=1 → healthcheck
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      if (url.searchParams.get("ping")) {
        return sendJson(res, 200, { ok: true, pong: true, timestamp: new Date().toISOString() });
      }
      // GET ?city=&postcode=  (snelle test)
      const city = sanitize(url.searchParams.get("city"));
      const postcode = sanitize(url.searchParams.get("postcode"));
      if (!city && !postcode) {
        return sendJson(res, 400, { ok: false, error: "Gebruik GET ?city=Naam&postcode=12345 of POST { city, postcode }." });
      }
      const key = toKey({ city, postcode });
      const cached = cacheGet(key);
      if (cached) {
        return sendJson(res, 200, { ok: true, cached: true, input: { city, postcode }, ...cached });
      }
      const matches = await fetchCommunes({ city, postcode });
      const out = shapeResponse({ city, postcode }, matches);
      cacheSet(key, out);
      return sendJson(res, 200, { ok: true, cached: false, input: { city, postcode }, ...out });
    }

    // POST JSON
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") {
        try { body = JSON.parse(body); } catch {}
      }
      if (!body || typeof body !== "object") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const raw = Buffer.concat(chunks).toString("utf8");
        try { body = JSON.parse(raw || "{}"); } catch { body = {}; }
      }
      const city = sanitize(body.city);
      const postcode = sanitize(body.postcode);

      if (!city && !postcode) {
        return sendJson(res, 400, { ok: false, error: "Bad Request: minimaal één van 'city' of 'postcode' is verplicht." });
      }

      const key = toKey({ city, postcode });
      const cached = cacheGet(key);
      if (cached) {
        return sendJson(res, 200, { ok: true, cached: true, input: { city, postcode }, ...cached });
      }

      const matches = await fetchCommunes({ city, postcode });
      const out = shapeResponse({ city, postcode }, matches);
      cacheSet(key, out);
      return sendJson(res, 200, { ok: true, cached: false, input: { city, postcode }, ...out });
    }

    // Andere methoden
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { ok: false, error: "Method Not Allowed. Use GET or POST." });

  } catch (err) {
    const status = err.status || 500;
    const payload = err.out || { ok: false, error: err.message || "Internal Error" };
    return sendJson(res, status, payload);
  }
}

// Vorm de uiteindelijke payload (matches + optionele 'commune' shortcut)
function shapeResponse(input, matches) {
  const count = Array.isArray(matches) ? matches.length : 0;
  const primary = count === 1 ? matches[0] : null;
  return {
    source: "geo.api.gouv.fr",
    count,
    matches,
    commune: primary,
    meta: { timestamp: new Date().toISOString() }
  };
}
