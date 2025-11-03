// /api/georisques.js (ESM, graceful fallback)
// Haalt kern-risico's op via Géorisques per INSEE. Bij misser: geef 200 terug met lege summary + links.
//
// Endpoints:
// - GET  ?ping=1
// - GET  ?insee=XXXXX
// - POST { insee }
//
// Policies:
// - Server-side fetch only. 1 r/s (8/min), 8s timeout, 10 min cache.
// - Bij ontbrekende/afwijkende API-responses: GEEN 5xx, maar { summary:[], links, note } met 200.

const calls = [];
const now = () => Date.now();

// In-memory cache
const CACHE = new Map(); // key=insee -> { ts, data }
const TTL_MS = 10 * 60 * 1000;
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

function buildLinks(insee) {
  return {
    commune: `https://www.georisques.gouv.fr/commune/${encodeURIComponent(insee)}`,
    search: `https://www.georisques.gouv.fr/rechercher?insee=${encodeURIComponent(insee)}`
  };
}

// --- Fetch helpers (primaire + alternatieve paden) ---
async function fetchJson(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  await enforceRateLimit();
  try {
    const resp = await fetch(url, { signal: ac.signal, headers: { "Accept": "application/json" } });
    const ct = resp.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await resp.json() : await resp.text();
    if (!resp.ok) throw Object.assign(new Error(`HTTP ${resp.status}`), { status: resp.status, payload: data });
    return data;
  } finally {
    clearTimeout(t);
  }
}

// Bekende varianten die we proberen (best-effort)
function candidateUrls(insee) {
  return [
    `https://www.georisques.gouv.fr/api/risques/commune/${encodeURIComponent(insee)}`,
    `https://www.georisques.gouv.fr/api/v1/risques/commune/${encodeURIComponent(insee)}`,
    `https://www.georisques.gouv.fr/api/v1/communes/${encodeURIComponent(insee)}/risques`
  ];
}

async function tryAll(insee) {
  const urls = candidateUrls(insee);
  let lastErr = null;
  for (const url of urls) {
    try {
      const data = await fetchJson(url);
      return { data, used: url };
    } catch (e) {
      lastErr = e;
    }
  }
  return { data: null, used: null, error: lastErr };
}

// --- Samenvatten naar compacte categorieën ---
function summarizeGeorisques(insee, raw) {
  const categories = {
    flood:       { key: "flood",       label: "Overstroming (inondation)",                 present: false },
    clay:        { key: "clay",        label: "Kleirijkdom / grondkrimp (argiles)",        present: false },
    seismic:     { key: "seismic",     label: "Seismisch risico (séisme)",                 present: false },
    radon:       { key: "radon",       label: "Radon",                                     present: false },
    industrial:  { key: "industrial",  label: "Industriële risico’s (ICPE/technologiques)",present: false },
    coastal:     { key: "coastal",     label: "Kustrisico’s (submersion/recul du trait)",  present: false },
    forestfire:  { key: "forestfire",  label: "Bosbrand",                                   present: false },
  };

  if (!raw) {
    return {
      insee,
      summary: Object.values(categories).map(c => ({ key: c.key, label: c.label, present: false })),
    };
  }

  const text = JSON.stringify(raw).toLowerCase();
  const marks = [
    { cat: "flood",      terms: ["inondation", "crue", "submersion", "pluvial"] },
    { cat: "clay",       terms: ["argile", "retrait-gonflement", "mouvement de terrain"] },
    { cat: "seismic",    terms: ["seisme", "séisme", "sismique"] },
    { cat: "radon",      terms: ["radon"] },
    { cat: "industrial", terms: ["icpe", "technologique", "industriel"] },
    { cat: "coastal",    terms: ["cote", "côte", "trait de cote", "submersion marine", "littoral"] },
    { cat: "forestfire", terms: ["feu de foret", "feu de forêt", "incendie de foret"] }
  ];

  for (const { cat, terms } of marks) {
    for (const t of terms) {
      if (text.includes(t)) { categories[cat].present = true; break; }
    }
  }

  return {
    insee,
    summary: Object.values(categories).map(c => ({ key: c.key, label: c.label, present: !!c.present })),
  };
}

// --- HTTP handler ---
export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      if (url.searchParams.get("ping")) {
        return sendJson(res, 200, { ok: true, pong: true, timestamp: new Date().toISOString() });
      }
      const insee = sanitize(url.searchParams.get("insee"));
      if (!insee) return sendJson(res, 400, { ok: false, error: "Gebruik GET ?insee=XXXXX of POST { insee }." });

      const cached = cacheGet(insee);
      if (cached) return sendJson(res, 200, { ok: true, cached: true, input: { insee }, ...cached });

      const { data, used, error } = await tryAll(insee);
      const s = summarizeGeorisques(insee, data);
      const out = {
        source: "georisques.gouv.fr",
        insee,
        summary: s.summary,
        links: buildLinks(insee),
        usedEndpoint: used,
        note: !data ? "Geen directe API-data; gebruik de links voor handmatige controle." : undefined,
        errorHint: !data && error ? `Laatste fout: ${error.status || ''}`.trim() : undefined,
        meta: { timestamp: new Date().toISOString() }
      };
      cacheSet(insee, out);
      return sendJson(res, 200, { ok: true, cached: false, input: { insee }, ...out });
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
      if (!insee) return sendJson(res, 400, { ok: false, error: "Bad Request: veld 'insee' is verplicht." });

      const cached = cacheGet(insee);
      if (cached) return sendJson(res, 200, { ok: true, cached: true, input: { insee }, ...cached });

      const { data, used, error } = await tryAll(insee);
      const s = summarizeGeorisques(insee, data);
      const out = {
        source: "georisques.gouv.fr",
        insee,
        summary: s.summary,
        links: buildLinks(insee),
        usedEndpoint: used,
        note: !data ? "Geen directe API-data; gebruik de links voor handmatige controle." : undefined,
        errorHint: !data && error ? `Laatste fout: ${error.status || ''}`.trim() : undefined,
        meta: { timestamp: new Date().toISOString() }
      };
      cacheSet(insee, out);
      return sendJson(res, 200, { ok: true, cached: false, input: { insee }, ...out });
    }

    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { ok: false, error: "Method Not Allowed. Use GET or POST." });

  } catch (err) {
    const status = err.status || 500;
    const payload = { ok: false, error: err.message || "Internal Error", details: err.details || undefined };
    return sendJson(res, status, payload);
  }
}
