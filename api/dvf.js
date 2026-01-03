// /api/dvf.js
// V10: Cloud Function bridge + valuation (Response B: summary/valuation/comparables)
// Input: lat, lon, radius (km), optional: surface (m²), year, limit, type
// Output: { ok, source, summary, valuation, comparables }

const CLOUD_FUNCTION_BASE =
  process.env.DVF_API_BASE_URL || "https://dvf-api-1012901367480.europe-west1.run.app";

// Kleine in-memory cache (Vercel runtimes zijn ephemeral; dit is best-effort)
const cache = new Map();
function cacheKey(q) {
  // Rond af om cache hit-kans te vergroten zonder te veel te vervuilen
  const lat = Number(q.lat);
  const lon = Number(q.lon);
  const radius = Number(q.radius ?? 2);
  const year = q.year ?? "";
  const type = q.type ?? "";
  const limit = q.limit ?? "";
  return [
    lat.toFixed(4),
    lon.toFixed(4),
    String(radius),
    String(year),
    String(type),
    String(limit),
  ].join("|");
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.transactions)) return data.transactions;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function pickFirst(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

function parseDateMaybe(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function median(sortedNums) {
  const n = sortedNums.length;
  if (!n) return null;
  const mid = Math.floor(n / 2);
  return n % 2 ? sortedNums[mid] : (sortedNums[mid - 1] + sortedNums[mid]) / 2;
}

export default async function handler(req, res) {
  // 1) Methode check
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  // 2) Validatie input (lat/lon/radius)
  const lat = num(req.query.lat);
  const lon = num(req.query.lon);
  const radius = num(req.query.radius ?? 2);

  if (lat === null || lon === null) {
    return res.status(400).json({ ok: false, error: "lat/lon ontbreekt of ongeldig" });
  }
  if (radius === null || radius <= 0 || radius > 50) {
    return res.status(400).json({ ok: false, error: "radius ongeldig (0-50 km)" });
  }

  const targetSurface = num(req.query.surface) || 0;

  // 3) Cloud Function call (met best-effort caching)
  const key = cacheKey(req.query);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json(cached.payload);
  }

  try {
    const url = new URL(CLOUD_FUNCTION_BASE);
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("radius", String(radius));

    // Optioneel forwarden (alleen als jij dit in Cloud Function ondersteunt)
    ["year", "min_price", "max_price", "type", "limit"].forEach((k) => {
      if (req.query[k] !== undefined) url.searchParams.set(k, String(req.query[k]));
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const upstream = await fetch(url.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!upstream.ok) {
      // We geven “ok:true” met source=error terug (zoals jouw oude engine deed)
      const msg = await upstream.text().catch(() => "");
      return res.status(200).json({
        ok: true,
        source: "error",
        summary: {},
        valuation: null,
        comparables: [],
        error: `Cloud Function HTTP ${upstream.status}: ${msg}`,
      });
    }

    const data = await upstream.json();
    const rows = asArray(data);

    // 4) Normaliseren naar fields die we nodig hebben (robust mapper)
    // Verwacht: price, surface, date, type (Maison/Appartement/etc.)
    const normalized = rows
      .map((r) => {
        const price = num(
          pickFirst(r, ["valeur_fonciere", "price", "prix", "valeur", "amount", "montant"])
        );
        const surface = num(
          pickFirst(r, ["surface_reelle_bati", "surface", "bati_surface", "surface_bati", "area"])
        );
        const dateStr = pickFirst(r, ["date_mutation", "date", "mutation_date", "sold_at"]);
        const dateObj = parseDateMaybe(dateStr);
        const type = pickFirst(r, ["type_local", "type", "nature_mutation", "nature"]);

        // Optioneel: voor transparantie
        const address = pickFirst(r, ["adresse", "address", "full_address", "libelle_adresse"]);
        return { price, surface, dateStr: dateStr || null, dateObj, type: type || null, address };
      })
      // Basale sanity filters
      .filter((t) => t.price !== null && t.surface !== null && t.surface > 10 && t.price > 15000);

    // 5) (Optioneel) Type filter: als Cloud Function al filtert, blijft dit neutraal.
    // Als type_local aanwezig is, beperken we standaard tot Maison (zoals jouw oude logica),
    // maar alleen als we anders nog genoeg data houden.
    let transactions = normalized;
    const hasType = normalized.some((t) => typeof t.type === "string" && t.type.length);
    if (hasType) {
      const maisons = normalized.filter((t) => (t.type || "").toLowerCase() === "maison");
      if (maisons.length >= 5) transactions = maisons;
    }

    if (transactions.length === 0) {
      const payload = { ok: true, source: "cloudfunction", summary: {}, valuation: null, comparables: [] };
      cache.set(key, { expiresAt: Date.now() + 60_000, payload });
      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
      return res.status(200).json(payload);
    }

    // 6) Slimme selectie vergelijkingen op basis van surface (60%–140%), alleen als ≥5 records
    let comps = transactions;
    if (targetSurface > 0) {
      const tight = transactions.filter((t) => t.surface >= targetSurface * 0.6 && t.surface <= targetSurface * 1.4);
      if (tight.length >= 5) comps = tight;
    }

    // 7) Berekeningen €/m² (P10, median, P90)
    const pricesM2 = comps
      .map((t) => t.price / t.surface)
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);

    const count = pricesM2.length;
    const med = median(pricesM2);

    // Guard: als iets misloopt met data
    if (med === null) {
      const payload = { ok: true, source: "cloudfunction", summary: {}, valuation: null, comparables: [] };
      cache.set(key, { expiresAt: Date.now() + 60_000, payload });
      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
      return res.status(200).json(payload);
    }

    const p10 = pricesM2[Math.floor(count * 0.10)] ?? med;
    const p90 = pricesM2[Math.floor(count * 0.90)] ?? med;

    // 8) Top 5 meest recente comparables (voor prompt/UI)
    const recentComps = [...comps]
      .sort((a, b) => {
        const da = a.dateObj?.getTime() ?? 0;
        const db = b.dateObj?.getTime() ?? 0;
        return db - da;
      })
      .slice(0, 5)
      .map((t) => ({
        date: t.dateStr,
        price: t.price,
        surface: t.surface,
        m2_price: Math.round(t.price / t.surface),
      }));

    const summary = {
      median_eur_m2: Math.round(med),
      count_total: transactions.length,
      count_comps: comps.length,
      price_range: {
        low: Math.round(p10),
        high: Math.round(p90),
      },
    };

    let valuation = null;
    if (targetSurface > 0) {
      valuation = {
        fair_value: Math.round(med * targetSurface),
        range_low: Math.round(p10 * targetSurface),
        range_high: Math.round(p90 * targetSurface),
      };
    }

    const payload = {
      ok: true,
      source: "cloudfunction",
      summary,
      valuation,
      comparables: recentComps,
    };

    // Best-effort cache 60s (serverless)
    cache.set(key, { expiresAt: Date.now() + 60_000, payload });

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json(payload);
  } catch (error) {
    console.error("DVF Cloud Engine Error:", error);
    return res.status(200).json({
      ok: true,
      source: "error",
      summary: {},
      valuation: null,
      comparables: [],
      error: String(error?.message || error),
    });
  }
}
