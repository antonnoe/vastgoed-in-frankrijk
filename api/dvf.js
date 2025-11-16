// api/dvf.js — DVF per commune met fallback naar departement (rural/urban links)
export const config = { runtime: 'edge' };

const DVF_BASE = 'https://files.data.gouv.fr/geo-dvf/latest';
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });

// FR overseas (97/98) hebben 3-cijferig dep, anders 2
const depFromInsee = (insee) => (/^(97|98)/.test(insee) ? insee.slice(0, 3) : insee.slice(0, 2));

export default async function handler(req) {
  const sp = new URL(req.url).searchParams;

  // ping
  if (sp.get('ping')) {
    return json({ ok: true, pong: true, timestamp: new Date().toISOString() });
  }

  const insee = (sp.get('insee') || '').trim();
  if (!insee) return json({ ok: false, error: "Bad Request: 'insee' is verplicht." }, 400);

  const dep = depFromInsee(insee);

  const links = {
    etalab_app: 'https://app.dvf.etalab.gouv.fr/',
    commune_json: `${DVF_BASE}/communes/${insee}.json`,
    dep_csv_gz: `${DVF_BASE}/csv/${dep}.csv.gz`,
    dep_parquet: `${DVF_BASE}/parquet/${dep}.parquet`,
    // handige splitsing voor analyse buiten de tool
    dep_context: {
      rural_tip: 'Gebruik INSEE typologie + DVF departement voor rurale vergelijking',
      urban_tip: 'Gebruik DVF binnen zelfde EPCI/aire urbaine voor stedelijke context'
    }
  };

  // 1) Probeer per-commune JSON (klein & direct bruikbaar)
  try {
    const r = await fetch(links.commune_json, { headers: { accept: 'application/json' } });
    if (r.ok) {
      const data = await r.json();
      const feats = Array.isArray(data?.features) ? data.features : [];

      // eenvoudige mediaan €/m² uit ruwe punten (valeur_fonciere / surface)
      let median = null;
      try {
        const values = feats
          .map((f) => {
            const p = f?.properties || {};
            const v = +p.valeur_fonciere;
            const s = +(p.surface_reelle_bati || p.surface_terrain);
            return v > 0 && s > 0 ? v / s : null;
          })
          .filter(Number.isFinite)
          .sort((a, b) => a - b);

        if (values.length) {
          const m = Math.floor(values.length / 2);
          median =
            values.length % 2 ? Math.round(values[m]) : Math.round((values[m - 1] + values[m]) / 2);
        }
      } catch {
        // median blijft null
      }

      return json({
        ok: true,
        source: 'commune',
        insee,
        summary: {
          transactions: feats.length,
          median_eur_m2: median
        },
        links,
        meta: { timestamp: new Date().toISOString() }
      });
    }
  } catch {
    // ga door naar fallback
  }

  // 2) Fallback naar departement (grote bestanden → alleen links + hint)
  return json({
    ok: true,
    source: 'departement-fallback',
    insee,
    summary: null,
    note: 'Geen per-gemeente DVF-JSON gevonden. Gebruik departementsbestanden of de Etalab-app.',
    links,
    meta: { timestamp: new Date().toISOString() }
  });
}
