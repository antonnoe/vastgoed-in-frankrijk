// /api/gpu-doc.js (ESM)
// Doel: Documenten/PLU-pack ophalen per INSEE (best-effort) via API Carto / GPU.
// Endpoints:
// - GET  ?ping=1
// - GET  ?insee=XXXXX
// - POST { insee }
//
// Opzet:
// - Probeert meerdere kandidaat-URL's bij apicarto.ign.fr (document(en) per partition DU_<INSEE>).
// - Als alle pogingen mislukken, leveren we een lege lijst + nuttige links i.p.v. 500.
// - 1 req/sec, max 8/min; 8s timeout; 10 min cache (per instance).

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

// -------------- Fetch helpers --------------
async function fetchJson(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);

  await enforceRateLimit();
  let resp, data;
  try {
    resp = await fetch(url, { signal: ac.signal, headers: { "Accept": "application/json" } });
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

// Kandidaat-URL's (best-effort; API Carto/GPU varieert per instantie/millésime)
function candidateUrls(insee) {
  const part = `DU_${insee}`;
  return [
    // meest gebruikelijke varianten die in omloop zijn
    `https://apicarto.ign.fr/api/gpu/document?partition=${encodeURIComponent(part)}`,
    `https://apicarto.ign.fr/api/gpu/documents?partition=${encodeURIComponent(part)}`,
    `https://apicarto.ign.fr/api/gpu/doc?partition=${encodeURIComponent(part)}`
  ];
}

async function fetchDocuments(insee) {
  const urls = candidateUrls(insee);
  let lastErr = null;
  for (const url of urls) {
    try {
      const data = await fetchJson(url);
      return { data, used: url };
    } catch (err) {
      lastErr = err;
      // probeer volgende kandidaat
    }
  }
  // Alle paden faalden → geef lege set terug met laatste fout als detail
  return { data: null, used: null, error: lastErr };
}

// Normaliseer mogelijke structuren naar [{type,title,url,date}]
function summarizeDocs(raw) {
  const out = [];

  // Helper om één item te pushen
  const pushDoc = (d) => {
    if (!d) return;
    const type = String(
      d.type || d.typeDocument || d.typologie || d.categorie || ""
    ).trim() || null;
    const title = String(
      d.title || d.titre || d.nom || d.intitule || d.label || ""
    ).trim() || null;
    const url = String(
      d.url || d.href || d.lien || d.link || d.downloadUrl || d.download || ""
    ).trim() || null;
    const date = String(
      d.date || d.datePublication || d.millesime || d.millésime || d.updated || ""
    ).trim() || null;

    if (type || title || url) out.push({ type, title, url, date });
  };

  if (!raw) return out;

  // Variant A: reeds array
  if (Array.isArray(raw)) {
    raw.forEach(pushDoc);
    return out;
  }
  // Variant B: object met 'documents' array
  if (Array.isArray(raw.documents)) {
    raw.documents.forEach(pushDoc);
  }
  // Variant C: object met 'results' of 'resultats'
  if (Array.isArray(raw.results)) raw.results.forEach(pushDoc);
  if (Array.isArray(raw.resultats)) raw.resultats.forEach(pushDoc);

  // Variant D: diepe geneste arrays
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (Array.isArray(v)) v.forEach(pushDoc);
  }

  return out;
}

function buildLinks(insee) {
  return {
    gpu_recherche: `https://www.geoportail-urbanisme.gouv.fr/recherche?insee=${encodeURIComponent(insee)}`,
    apicarto_partition: `https://apicarto.ign.fr/api/gpu/document?partition=DU_${encodeURIComponent(insee)}`
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
      const insee = sanitize(url.searchParams.get("insee"));
      if (!insee) {
        return sendJson(res, 400, { ok: false, error: "Gebruik GET ?insee=XXXXX of POST { insee }." });
      }

      const cached = cacheGet(insee);
      if (cached) {
        return sendJson(res, 200, { ok: true, cached: true, input: { insee }, ...cached });
      }

      const { data, used, error } = await fetchDocuments(insee);
      const docs = summarizeDocs(data);
      const out = {
        source: "apicarto.ign.fr (GPU documents)",
        insee,
        usedEndpoint: used,
        documents: docs, // [{type,title,url,date}]
        links: buildLinks(insee),
        raw: data,       // debug; kan later uitgezet worden
        note: !data ? "Geen document-API respons ontvangen; toon links voor handmatige nav." : undefined,
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
      if (!insee) {
        return sendJson(res, 400, { ok: false, error: "Bad Request: veld 'insee' is verplicht." });
      }

      const cached = cacheGet(insee);
      if (cached) {
        return sendJson(res, 200, { ok: true, cached: true, input: { insee }, ...cached });
      }

      const { data, used, error } = await fetchDocuments(insee);
      const docs = summarizeDocs(data);
      const out = {
        source: "apicarto.ign.fr (GPU documents)",
        insee,
        usedEndpoint: used,
        documents: docs,
        links: buildLinks(insee),
        raw: data,
        note: !data ? "Geen document-API respons ontvangen; toon links voor handmatige nav." : undefined,
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
    const payload = { ok: false, error: err.message || "Internal Error", details: err.payload || undefined };
    return sendJson(res, status, payload);
  }
}
