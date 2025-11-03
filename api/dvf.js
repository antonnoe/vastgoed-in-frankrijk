// /api/dvf.js (ESM)
// Doel: Samenvatting van DVF-transacties per INSEE (gemeente).
// Strategie:
// 1) Probeer per-gemeente GeoJSON van data.gouv.fr (lichtgewicht): 
//    https://files.data.gouv.fr/geo-dvf/latest/communes/<INSEE>.json (fallback .json.gz)
// 2) Indien niet beschikbaar: geef nette links en departementcode terug (zonder "fake" cijfers).
//
// Endpoints:
// - GET  ?ping=1
// - GET  ?insee=XXXXX
// - POST { insee }
//
// Policies:
// - Alleen server-side fetch; geen client keys.
// - Rate limit: 1 req/sec, max 8/min. Timeout 8s. Cache 10 min per INSEE.
//
// Opmerking: DVF-bestanden zijn groot. We kiezen hier bewust voor de per-gemeente GeoJSON route. 
// Valt die weg/anders, dan leveren we links terug i.p.v. onbetrouwbare schattingen.

const calls = [];
const now = () => Date.now();

// In-memory cache per instance
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

function median(nums) {
  const arr = nums.filter(n => Number.isFinite(n)).slice().sort((a,b)=>a-b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length/2);
  return arr.length % 2 ? arr[mid] : (arr[mid-1] + arr[mid]) / 2;
}
function safeNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

// Departementcode uit INSEE (fallback) + officiële lookup
function deptFromInseeHeuristic(insee) {
  // 5-karakter INSEE-commune code. Departement:
  // - Corsica: 2A/2B prefix
  // - DOM/TOM: 971..976 (3-cijferige dep)
  // - Anders: eerste 2 cijfers
  if (/^2A/i.test(insee)) return "2A";
  if (/^2B/i.test(insee)) return "2B";
  const m97 = insee.match(/^(97\d)/);
  if (m97) return m97[1];
  return insee.slice(0,2);
}

async function fetchDeptFromGeo(insee) {
  const url = `https://geo.api.gouv.fr/communes/${encodeURIComponent(insee)}?fields=departement`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  await enforceRateLimit();
  try {
    const resp = await fetch(url, { signal: ac.signal, headers: { "Accept":"application/json" }});
    const ct = resp.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await resp.json() : await resp.text();
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const dep = data?.departement?.code || null;
    const depName = data?.departement?.nom || null;
    return { dep, depName };
  } catch {
    return { dep: deptFromInseeHeuristic(insee), depName: null };
  } finally {
    clearTimeout(t);
  }
}

// Fetch helpers (per-gemeente DVF)
async function fetchJson(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  await enforceRateLimit();
  let resp, data;
  try {
    resp = await fetch(url, { signal: ac.signal, headers: { "Accept":"application/json" }});
    const ct = resp.headers.get("content-type") || "";
    data = ct.includes("application/json") ? await resp.json() : await resp.text();
  } finally {
    clearTimeout(t);
  }
  if (!resp.ok) {
    const e = new Error(`HTTP ${resp.status}`);
    e.status = resp.status;
    e.payload = data;
    throw e;
  }
  return data;
}

async function fetchDvfCommune(insee) {
  // Probeer on-gz eerst (snel) en val terug op .json.gz (sommige mirrors)
  const base = `https://files.data.gouv.fr/geo-dvf/latest/communes/${encodeURIComponent(insee)}`;
  const candidates = [`${base}.json`, `${base}.json.gz`];
  let lastErr = null;
  for (const url of candidates) {
    try {
      const data = await fetchJson(url);
      return { data, used: url };
    } catch (err) {
      lastErr = err;
    }
  }
  return { data: null, used: null, error: lastErr };
}

// Samenvatten uit DVF GeoJSON features
function summarizeFromGeoJSON(geo) {
  const features = Array.isArray(geo?.features) ? geo.features : [];
  const rows = [];

  for (const f of features) {
    const p = f?.properties || {};
    const valeur = safeNumber(p.valeur_fonciere ?? p.valeurFonciere ?? p.valeur ?? null);
    const surf = safeNumber(p.surface_relle_bati ?? p.surface_reelle_bati ?? p.surface_relle ?? p.surface ?? p.surface_bati ?? null);
    // DVF noemt het 'surface_reelle_bati' (met 2 e's). Neem beide varianten op.
    const surface = safeNumber(p.surface_reelle_bati ?? p.surface_relle_bati ?? surf);
    const prixm2 = (surface && valeur) ? (valeur / surface) : null;
    const year = String(p.annee_mutation ?? p.annee ?? (p.date_mutation || "")).slice(0,4);
    const type = String(p.type_local ?? p.typeLocal ?? p.nature_mutation ?? "").trim();

    rows.push({ valeur, surface, prixm2, year, type });
  }

  const validRows = rows.filter(r => Number.isFinite(r.valeur));

  // per type_local (Maison/Appartement/Autre)
  const types = ["Maison", "Appartement"];
  const buckets = {};
  for (const t of types) buckets[t] = [];
  buckets["Overig"] = [];

  for (const r of validRows) {
    const key = types.includes(r.type) ? r.type : "Overig";
    buckets[key].push(r);
  }

  function stats(list) {
    const n = list.length;
    const v = median(list.map(x => x.valeur));
    const m2 = median(list.map(x => x.prixm2).filter(Number.isFinite));
    return { count: n, median_price: v, median_eur_m2: m2 };
    // NB: medians zijn op basis van per-transactie waarden met available data.
  }

  const summary = {
    total: stats(validRows),
    per_type: {
      Maison: stats(buckets["Maison"]),
      Appartement: stats(buckets["Appartement"]),
      Overig: stats(buckets["Overig"])
    },
    years: (() => {
      // eenvoudige verdeling per jaar (aantal)
      const map = new Map();
      for (const r of validRows) {
        const y = /^\d{4}$/.test(r.year) ? r.year : "onbekend";
        map.set(y, (map.get(y) || 0) + 1);
      }
      return [...map.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([year,count])=>({ year, count }));
    })()
  };

  return { summary, featureCount: features.length, rowCount: validRows.length };
}

function buildLinks(insee, dep) {
  return {
    etalab_app: "https://app.dvf.etalab.gouv.fr/",
    data_gouv_dep_csv: dep ? `https://files.data.gouv.fr/geo-dvf/latest/csv/${encodeURIComponent(dep)}.csv.gz` : null,
    data_gouv_dep_parquet: dep ? `https://files.data.gouv.fr/geo-dvf/latest/parquet/${encodeURIComponent(dep)}.parquet` : null,
    data_gouv_commune_json: `https://files.data.gouv.fr/geo-dvf/latest/communes/${encodeURIComponent(insee)}.json`
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

      const out = await processDvf(insee);
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

      const out = await processDvf(insee);
      cacheSet(insee, out);
      return sendJson(res, 200, { ok: true, cached: false, input: { insee }, ...out });
    }

    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { ok: false, error: "Method Not Allowed. Use GET or POST." });

  } catch (err) {
    const status = err.status || 500;
    const payload = { ok: false, error: err.message || "Internal Error", details: err.payload || undefined };
    return sendJson(res, status, payload);
  }
}

async function processDvf(insee) {
  const { dep } = await fetchDeptFromGeo(insee);

  const attempt = await fetchDvfCommune(insee);
  const links = buildLinks(insee, dep);

  if (attempt.data && Array.isArray(attempt.data.features)) {
    const sum = summarizeFromGeoJSON(attempt.data);
    return {
      source: "files.data.gouv.fr/geo-dvf (commune GeoJSON)",
      insee,
      usedEndpoint: attempt.used,
      summary: sum.summary,          // { total, per_type, years }
      counts: {
        features: sum.featureCount,
        valid_rows: sum.rowCount
      },
      links,
      raw: attempt.data,             // (debug; kan later uitgezet worden)
      meta: { timestamp: new Date().toISOString() }
    };
  }

  // Geen per-commune data → geef links en departement terug (geen fake stats)
  return {
    source: "files.data.gouv.fr/geo-dvf",
    insee,
    summary: null,
    counts: null,
    links,
    note: "Geen per-gemeente DVF-GeoJSON gevonden. Gebruik de links om handmatig te raadplegen (departementsbestand is groot).",
    usedEndpoint: attempt.used,
    errorHint: attempt.error ? `Laatste fout: ${attempt.error.status || ''}`.trim() : undefined,
    meta: { timestamp: new Date().toISOString() }
  };
}
