// /api/dvf-insights.js
// Compacte DVF-samenvatting per INSEE met veilige fallbacks.
// Voor nu geen zware Parquet-parse (serverless-vriendelijk); we leveren:
//   - geldige links (Etalab app, CSV/Parquet per departement, commune JSON)
//   - nette melding als per-commune JSON ontbreekt
//   - (optioneel) eenvoudige headline indien commune JSON bestaat (count/median) — best-effort.
//
// Input (GET): ?insee=XXXXX
// Output: { ok, insee, links:{...}, summary: { available:boolean, note:string } }

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ ok: false, error: "Method Not Allowed. Use GET." });
      return;
    }
    const { insee } = req.query || {};
    if (!insee || String(insee).length < 5) {
      res.status(400).json({ ok: false, error: "Bad Request: geef ?insee=XXXXX." });
      return;
    }

    const dep = String(insee).slice(0, 2);
    const links = {
      etalab_app: "https://app.dvf.etalab.gouv.fr/",
      data_gouv_dep_csv: `https://files.data.gouv.fr/geo-dvf/latest/csv/${dep}.csv.gz`,
      data_gouv_dep_parquet: `https://files.data.gouv.fr/geo-dvf/latest/parquet/${dep}.parquet`,
      data_gouv_commune_json: `https://files.data.gouv.fr/geo-dvf/latest/communes/${insee}.json`
    };

    // Best-effort: check of commune JSON bestaat
    let available = false;
    let headCount = null;
    try {
      const resp = await fetch(links.data_gouv_commune_json, { method: "HEAD", signal: AbortSignal.timeout(6000) });
      available = resp.ok;
      if (available) {
        // optioneel: kleine fetch om aantal features te tellen zonder grote payload (we beperken bytes)
        const r2 = await fetch(links.data_gouv_commune_json, { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(8000) });
        if (r2.ok) {
          const j = await r2.json();
          headCount = Array.isArray(j?.features) ? j.features.length : null;
        }
      }
    } catch {
      available = false;
    }

    const summary = {
      available,
      transactions_count: headCount,
      note: available
        ? "Commune-JSON beschikbaar; verdere aggregatie client- of back-end kant."
        : "Geen per-commune DVF-GeoJSON gevonden. Gebruik de departementsbestanden of Etalab app."
    };

    res.status(200).json({
      ok: true,
      insee: String(insee),
      links,
      summary,
      meta: { timestamp: new Date().toISOString() }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Server error", details: String(e?.message || e).slice(0, 400) });
  }
}
