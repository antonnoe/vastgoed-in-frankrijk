// /api/summary.js (ESM)
// Doel: één server-side endpoint dat de interne routes ketst:
//   /api/commune   → INSEE/geo
//   /api/georisques→ risico’s per INSEE
//   /api/gpu       → PLU zoneringen (zone-urba)
//   /api/gpu-doc   → PLU/SUP documenten (best-effort)
//   /api/dvf       → DVF-samenvatting (of nette links)
// Zó hoeft de front-end slechts één call te doen.
//
// Endpoints:
// - GET  ?ping=1
// - GET  ?city=...&postcode=...
// - POST { city, postcode }
//
// Policies:
// - Geen externe sites in de browser; hier praten we ALLEEN met /api/* van deze Vercel-app.
// - Rate limit: 1 req/sec, max 8/min. Timeout 8s per interne call. Cache 10 min per (city|postcode) sleutel.

const calls = [];
const now = () => Date.now();

// In-memory cache (per instance, best-effort)
const CACHE = new Map(); // key -> { ts, data }
const TTL_MS = 10 * 60 * 1000; // 10 min
const MAX_KEYS = 200;

function cacheKey({ city, postcode }) {
  return `${(city || "").trim().toLowerCase()}|${(postcode || "").trim().toLowerCase()}`;
}
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

// Throttling: 1 r/s, 8/min (per instance)
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

// HTTP utils
function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
const sanitize = (v) => (typeof v === "string" ? v.trim() : "");

// Origin bepalen voor interne /api-calls
function getOrigin(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").toString();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString();
  return `${proto}://${host}`;
}

// Interne fetch helper (naar eigen /api/*), met 8s timeout + rate-limit
async function fetchInternalJson(req, pathWithQuery, options = {}) {
  const origin = getOrigin(req);
  const url = origin + pathWithQuery;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  await enforceRateLimit();

  let resp, data;
  try {
    resp = await fetch(url, {
      method: options.method || "GET",
      headers: { "Accept": "application/json", ...(options.headers || {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: ac.signal
    });
    const ct = resp.headers.get("content-type") || "";
    data = ct.includes("application/json") ? await resp.json() : await resp.text();
  } finally {
    clearTimeout(t);
  }
  if (!resp.ok) {
    const e = new Error(`Internal API ${pathWithQuery} → HTTP ${resp.status}`);
    e.status = resp.status;
    e.details = data;
    throw e;
  }
  return data;
}

// Kernlogica: keten draaien
async function buildSummary(req, { city, postcode }) {
  // 1) Commune → INSEE
  const q = new URLSearchParams();
  if (city) q.set("city", city);
  if (postcode) q.set("postcode", postcode);
  const communeResp = await fetchInternalJson(req, `/api/commune?${q.toString()}`);
  const commune = communeResp?.commune || null;
  if (!commune?.insee) {
    return {
      commune: communeResp,
      georisques: null,
      gpu: null,
      gpudoc: null,
      dvf: null,
      note: "Geen unieke gemeente gevonden; verfijn plaats en/of postcode.",
      links: {
        georisques: "https://www.georisques.gouv.fr/",
        dvf: "https://app.dvf.etalab.gouv.fr/",
        gpu: "https://www.geoportail-urbanisme.gouv.fr/map/"
      }
    };
  }

  const insee = commune.insee;

  // 2) Géorisques
  const geoRisks = await fetchInternalJson(req, `/api/georisques`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: { insee }
  });

  // 3) GPU zones
  const gpu = await fetchInternalJson(req, `/api/gpu`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: { insee }
  });

  // 4) GPU documenten (best-effort)
  const gpuDoc = await fetchInternalJson(req, `/api/gpu-doc`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: { insee }
  });

  // 5) DVF
  const dvf = await fetchInternalJson(req, `/api/dvf`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: { insee }
  });

  return {
    commune,
    georisques: {
      summary: geoRisks?.summary || null,
      links: geoRisks?.links || null
    },
    gpu: {
      zones: gpu?.zones || [],
      links: gpu?.links || null
    },
    gpudoc: {
      documents: gpuDoc?.documents || [],
      links: gpuDoc?.links || null,
      note: gpuDoc?.note || null,
      usedEndpoint: gpuDoc?.usedEndpoint || null
    },
    dvf: {
      summary: dvf?.summary || null,
      counts: dvf?.counts || null,
      links: dvf?.links || null,
      note: dvf?.note || null
    },
    meta: {
      insee,
      timestamp: new Date().toISOString()
    }
  };
}

// -------------- HTTP handler --------------
export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      if (url.searchParams.get("ping")) {
        return sendJson(res, 200, { ok: true, pong: true, timestamp: new Date().toISOString() });
      }
      const city = sanitize(url.searchParams.get("city"));
      const postcode = sanitize(url.searchParams.get("postcode"));
      if (!city && !postcode) {
        return sendJson(res, 400, { ok: false, error: "Gebruik GET ?city=Naam&postcode=12345 of POST { city, postcode }." });
      }

      const key = cacheKey({ city, postcode });
      const cached = cacheGet(key);
      if (cached) return sendJson(res, 200, { ok: true, cached: true, input: { city, postcode }, ...cached });

      const summary = await buildSummary(req, { city, postcode });
      cacheSet(key, summary);
      return sendJson(res, 200, { ok: true, cached: false, input: { city, postcode }, ...summary });
    }

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch {} }
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

      const key = cacheKey({ city, postcode });
      const cached = cacheGet(key);
      if (cached) return sendJson(res, 200, { ok: true, cached: true, input: { city, postcode }, ...cached });

      const summary = await buildSummary(req, { city, postcode });
      cacheSet(key, summary);
      return sendJson(res, 200, { ok: true, cached: false, input: { city, postcode }, ...summary });
    }

    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { ok: false, error: "Method Not Allowed. Use GET or POST." });

  } catch (err) {
    const status = err.status || 500;
    const payload = { ok: false, error: err.message || "Internal Error", details: err.details || undefined };
    return sendJson(res, status, payload);
  }
}
