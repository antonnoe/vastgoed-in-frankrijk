// /api/gpu.js (ESM)
// Doel: Basis-koppeling met API Carto (module Urbanisme/GPU) om PLU-zoneringen (zone-urba) per INSEE op te halen.
// Bron: API Carto - module GPU (IGN) en praktijkvoorbeelden met partition DU_<INSEE>.
// Voorbeeld-API: https://apicarto.ign.fr/api/gpu/zone-urba?partition=DU_<INSEE>
//
// Endpoints:
// - GET  ?ping=1            → { ok:true, pong:true }
// - GET  ?insee=XXXXX       → { ok:true, input, zones, links, raw? }
// - POST { insee }          → idem
//
// Opmerking: Dit is een eerste nuttige subset (zone-urba). Later kunnen we uitbreiden met SUP/SCoT of documentlisting.
// Geen API-key vereist. Alle calls gebeuren server-side. Best-effort caching + throttling.
//
// Policies die we in dit project hanteren:
// - 1 req/sec, max 8/min (per instance), 8s timeout
// - 10 min server-side cache per INSEE

const calls = [];
const now = () => Date.now();

// In-memory cache (serverless instance-lokaal)
const CACHE = new Map(); // key=insee -> { ts, data }
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

// Throttling
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

// Utils
function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
const sanitize = (v) => (typeof v === "string" ? v.trim() : "");

// ------------------------
// API Carto (GPU) fetch
// ------------------------
// Primair: PLU-zoneringen via zone-urba voor partition DU_<INSEE>
async function fetchZoneUrba(insee) {
  const partition = `DU_${insee}`;
  const url = `https://apicarto.ign.fr/api/gpu/zone-urba?partition=${encodeURIComponent(partition)}`;

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
    const e = new Error(`Fetch-fout naar API Carto (GPU zone-urba): ${String(err)}`);
    e.status = 502;
    e.details = String(err);
    throw e;
  } finally {
    clearTimeout(t);
  }

  if (!resp.ok) {
    const e = new Error(`API Carto (zone-urba) gaf HTTP ${resp.status}`);
    e.status = resp.status || 502;
    e.details = data;
    throw e;
  }

  // Verwachte vorm: GeoJSON FeatureCollection
  return data;
}

// Samenvatten van GeoJSON naar unieke zonecodes/labels + aantallen
function summarizeZones(geojson) {
  try {
    const feats = Array.isArray(geojson?.features) ? geojson.features : [];
    const tally = new Map(); // key -> { code, label, count }

    for (const f of feats) {
      const p = f?.properties || {};
      // CNIG-attribuutnamen variëren; probeer robuust te lezen:
      const code = String(
        p.code ?? p.CODE ?? p.idZone ?? p.IDZONE ?? p.id ?? p.nom ?? p.NOM ?? ""
      ).trim();

      const labelRaw =
        p.libelle ?? p.LIBELLE ?? p.nom ?? p.NOM ?? p.lib_zone ?? p.LIB_ZONE ?? p.lib ?? p.LIB ?? "";
      const label = String(labelRaw || code || "Onbekende zone").trim();

      const key = (code || label).toUpperCase();
      const row = tally.get(key) || { code: code || null, label, count: 0 };
      row.count += 1;
      tally.set(key, row);
    }

    const zones = [...tally.values()].sort((a,b) => {
      // sorteer op code/label, dan aflopend count
      const ka = (a.code || a.label || "").toString();
      const kb = (b.code || b.label || "").toString();
      return ka.localeCompare(kb, 'nl');
    });

    return { zones, featureCount: feats.length };
  } catch {
    return { zones: [], featureCount: 0 };
  }
}

function buildLinks(insee) {
  return {
    gpu_site_commune: `https://www.geoportail-urbanisme.gouv.fr/recherche?insee=${encodeURIComponent(insee)}`,
    apicarto_zone_urba: `https://apicarto.ign.fr/api/gpu/zone-urba?partition=DU_${encodeURIComponent(insee)}`
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
      const raw = await fetchZoneUrba(insee);
      const sum = summarizeZones(raw);
      const out = {
        source: "apicarto.ign.fr (GPU zone-urba)",
        insee,
        zones: sum.zones,            // [{code,label,count}]
        featureCount: sum.featureCount,
        links: buildLinks(insee),
        raw,                         // voor debug; eventueel weglaten in productie
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
      if (!insee) {
        return sendJson(res, 400, { ok: false, error: "Bad Request: veld 'insee' is verplicht." });
      }

      const cached = cacheGet(insee);
      if (cached) {
        return sendJson(res, 200, { ok: true, cached: true, input: { insee }, ...cached });
      }
      const raw = await fetchZoneUrba(insee);
      const sum = summarizeZones(raw);
      const out = {
        source: "apicarto.ign.fr (GPU zone-urba)",
        insee,
        zones: sum.zones,
        featureCount: sum.featureCount,
        links: buildLinks(insee),
        raw,
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
