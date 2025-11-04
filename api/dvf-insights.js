// /api/dvf-insights.js
// Compacte DVF-samenvatting per INSEE met veilige fallbacks.
// Doel: geldige links + eenvoudige availability-check op commune JSON.
// Geen zware parsing (serverless-vriendelijk).
//
// Input (GET):  ?insee=XXXXX
// Output: {
//   ok, insee,
//   links: { etalab_app, data_gouv_dep_csv, data_gouv_dep_parquet, data_gouv_commune_json },
//   summary: { available, transactions_count, note },
//   meta: { timestamp }
// }

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ ok: false, error: "Method Not Allowed. Use GET." });
      return;
    }

    const { insee } = req.query || {};
    if (!insee || String(insee).trim().length < 5) {
      res.status(400).json({ ok: false, error: "Bad Request: geef ?insee=XXXXX." });
      return;
    }

    const inseeStr = String(insee).trim();
    const dep = inseeStr.slice(0, 2);

    const links = {
      etalab_app: "https://app.dvf.etalab.gouv.fr/",
      data_gouv_dep_csv: `https://files.data.gouv.fr/geo-dvf/latest/csv/${dep}.csv.gz`,
      data_gouv_dep_parquet: `https://files.data.gouv.fr/geo-dvf/latest/parquet/${dep}.parquet`,
      data_gouv_commune_json: `https://files.data.gouv.fr/geo-dvf/latest/communes/${inseeStr}.json`
    };

    // --- Availability check ---
    let available = false;
    let transactions_count = null;

    // 1) HEAD met backoff bij 429
    const headOk = await headWithBackoff(links.data_gouv_commune_json, 8000);
    if (headOk) {
      available = true;
      // 2) Kleine GET om aantal features te lezen (best-effort)
      try {
        const r = await fetch(links.data_gouv_commune_json, {
          headers: { "Accept": "application/json" },
          signal: AbortSignal.timeout(10000)
        });
        if (r.ok) {
          const j = await r.json();
          transactions_count = Array.isArray(j?.features) ? j.features.length : null;
        }
      } catch {
        // negeren: we hebben in elk geval availability = true
      }
    }

    const summary = {
      available,
      transactions_count,
      note: available
        ? "Commune-JSON beschikbaar; verdere aggregatie kan client- of server-side."
        : "Geen per-commune DVF-GeoJSON gevonden. Gebruik de departementsbestanden of Etalab-app."
    };

    res.status(200).json({
      ok: true,
      insee: inseeStr,
      links,
      summary,
      meta: { timestamp: new Date().toISOString() }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Server error", details: String(e?.message || e).slice(0, 400) });
  }
}

async function headWithBackoff(url, timeoutMs = 8000) {
  try {
    let r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) });
    if (r.status === 429) {
      await sleep(1200);
      r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) });
    }
    return r.ok;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
