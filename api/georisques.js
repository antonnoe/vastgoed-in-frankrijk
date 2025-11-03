// /api/georisques.js (ESM)
// Doel: Haal kern-risico's op voor een gemeente via Géorisques o.b.v. INSEE-code.
//
// Endpoints:
// - GET  ?ping=1                  → { ok:true, pong:true }
// - GET  ?insee=XXXXX             → { ok:true, input, summary, raw? }
// - POST { insee }                → idem
//
// Opmerkingen:
// - Dit is een best-effort koppeling. Géorisques kan varianten hebben per endpoint; we proberen een primaire route
//   en vallen terug op een alternatieve als nodig.
// - Geen externe calls in de browser; dit draait server-side.
// - Rate limiting (1 r/s, 8/min), 8s timeout, en 10 min in-memory cache per INSEE.
//
// Vereist: geen API-key.

const calls = [];
const now = () => Date.now();

// In-memory cache (serverless, best-effort)
const CACHE = new Map(); // key -> { ts, data }
const TTL_MS = 10 * 60 * 1000; // 10 min
const MAX_KEYS = 200;

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
    const oldestKey = [...CACHE.entries()].sort((a,b)=>a[1].ts-b[1].ts)[0]?.[0];
    if (oldestKey) CACHE.delete(oldestKey);
  }
  CACHE.set(key, { ts: now(), data });
}

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

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
function sanitize(v) {
  return (typeof v === "string" ? v.trim() : "");
}

// ------------------------
// Géorisques fetch helpers
// ------------------------

// Primaire route (veelvoorkomend): risico-overzicht per commune.
// NB: De officiële API kent varianten; deze route wordt eerst geprobeerd.
async function fetchPrimary(insee) {
  const url = `https://www.georisques.gouv.fr/api/risques/commune/${encodeURIComponent(insee)}`;
  return await fetchJson(url);
}

// Fallback route: alternatieve paden die soms worden gebruikt (b.v. v1/risques).
async function fetchFallback(insee) {
  const candidates = [
    `https://www.georisques.gouv.fr/api/v1/risques/commune/${encodeURIComponent(insee)}`,
    `https://www.georisques.gouv.fr/api/v1/communes/${encodeURIComponent(insee)}/risques`
  ];
  for (const url of candidates) {
    try {
      const data = await fetchJson(url);
      if (data) return data;
    } catch {
      // probeer de volgende
    }
  }
  // Laatste redmiddel: niets gevonden
  const err = new Error("Geen geldig risico-overzicht gevonden voor deze INSEE in Géorisques.");
  err.status = 502;
  throw err;
}

async function fetchJson(url) {
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
    const e = new Error(`Fetch-fout naar Géorisques: ${String(err)}`);
    e.status = 502;
    e.details = String(err);
    throw e;
  } finally {
    clearTimeout(t);
  }
  if (!resp.ok) {
    const e = new Error(`Géorisques gaf HTTP ${resp.status}`);
    e.status = resp.status || 502;
    e.details = data;
    throw e;
  }
  return data;
}

// Map een generieke API-respons naar compacte categorieën/links.
// Omdat de exacte API-structuur kan verschillen, proberen we robuust te lezen.
function summarizeGeorisques(insee, raw) {
  // Verwachte categorieën (we mappen er zo veel mogelijk op):
  const categories = {
    flood: { key: "flood", label: "Overstroming (inondation)", present: false },
    clay: { key: "clay", label: "Kleirijkdom / grondkrimp (argiles)", present: false },
    seismic: { key: "seismic", label: "Seismisch risico (séisme)", present: false },
    radon: { key: "radon", label: "Radon", present: false },
    industrial: { key: "industrial", label: "Industriële risico’s (ICPE, technologiques)", present: false },
    coastal: { key: "coastal", label: "Kustrisico’s (submersion, recul du trait de côte)", present: false },
    forestfire: { key: "forestfire", label: "Bosbrand", present: false },
  };

  // Heuristische lezing van raw:
  const text = JSON.stringify(raw).toLowerCase();

  // Zoektermen
  const marks = [
    { cat: "flood", terms: ["inondation", "crue", "submersion", "pluvial"] },
    { cat: "clay", terms: ["argile", "retrait-gonflement", "mouvement de terrain"] },
    { cat: "seismic", terms: ["seisme", "séisme", "sismique"] },
    { cat: "radon", terms: ["radon"] },
    { cat: "industrial", terms: ["icpe", "technologique", "industriel"] },
    { cat: "coastal", terms: ["cote", "côte", "trait de cote", "submersion marine", "littoral"] },
    { cat: "forestfire", terms: ["feu de foret", "feu de forêt", "incendie de foret"] }
  ];

  for (const { cat, terms } of marks) {
    for (const t of terms) {
      if (text.includes(t)) {
        categories[cat].present = true;
        break;
      }
    }
  }

  // Handige deep-links voor handmatig nazoeken (geen fetch in client):
  const links = {
    commune: `https://www.georisques.gouv.fr/commune/${encodeURIComponent(insee)}`,
    search: `https://www.georisques.gouv.fr/rechercher?insee=${encodeURIComponent(insee)}`
  };

  // Bouw samenvatting
  const summary = Object.values(categories).map(c => ({
    key: c.key,
    label: c.label,
    present: !!c.present
  }));

  return {
    insee,
    summary,
    links
  };
}

// ------------------------
// HTTP handler
// ------------------------
export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      if (url.searchParams.get("ping")) {
        return sendJson(res, 200, { ok: true, pong: true, timestamp: new Date().toISOString() });
      }
      const insee = sanitize(url.searchParams.get("insee"));
      if (!insee) {
        return sendJson(res, 400, { ok: false, error: "Gebruik GET ?insee=XXXXX of POST { insee }." });
      }
      const cached = cacheGet(insee);
      if (cached) {
        return sendJson(res, 200, { ok: true, cached: true, input: { insee }, ...cached });
      }
      const raw = await tryFetchRisks(insee);
      const shaped = shapeResponse(insee, raw);
      cacheSet(insee, shaped);
      return sendJson(res, 200, { ok: true, cached: false, input: { insee }, ...shaped });
    }

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch {} }
      if (!body || typeof body !== "object") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const rawBody = Buffer.concat(chunks).toString("utf8");
        try { body = JSON.parse(rawBody || "{}"); } catch { body = {}; }
      }

      const insee = sanitize(body.insee);
      if (!insee) {
        return sendJson(res, 400, { ok: false, error: "Bad Request: veld 'insee' is verplicht." });
      }

      const cached = cacheGet(insee);
      if (cached) {
        return sendJson(res, 200, { ok: true, cached: true, input: { insee }, ...cached });
      }
      const raw = await tryFetchRisks(insee);
      const shaped = shapeResponse(insee, raw);
      cacheSet(insee, shaped);
      return sendJson(res, 200, { ok: true, cached: false, input: { insee }, ...shaped });
    }

    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { ok: false, error: "Method Not Allowed. Use GET or POST." });

  } catch (err) {
    const status = err.status || 500;
    const payload = { ok: false, error: err.message || "Internal Error", details: err.details || undefined };
    return sendJson(res, status, payload);
  }
}

async function tryFetchRisks(insee) {
  try {
    return await fetchPrimary(insee);
  } catch {
    // fallbackpaden
    return await fetchFallback(insee);
  }
}

function shapeResponse(insee, raw) {
  const s = summarizeGeorisques(insee, raw);
  return {
    source: "georisques.gouv.fr",
    summary: s.summary,
    links: s.links,
    raw: raw, // eventueel verbergen in productie; nu handig voor debug
    meta: { timestamp: new Date().toISOString() }
  };
}
