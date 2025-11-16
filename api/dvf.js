// api/dvf.js — DVF per commune met fallback naar departement
export const config = { runtime: 'edge' };

const BASE = 'https://files.data.gouv.fr/geo-dvf/latest';

// FR oversea depts (97/98) hebben 3-cijferige dep-codes, anders 2.
const depFromInsee = (insee) => (/^(97|98)/.test(insee) ? insee.slice(0, 3) : insee.slice(0, 2));

// Kleine helper voor nette JSON responses
const j = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

export default async function handler(req) {
  const sp = new URL(req.url).searchParams;

  // Health check
  if (sp.get('ping')) {
    return j({ ok: true, pong: true, timestamp: new Date().toISOString() });
  }

  const insee = (sp.get('insee') || '').trim();
  if (!insee) {
    return j({ ok: false, error: "Bad Request: 'insee' is verplicht." }, 400);
  }

  const dep = depFromInsee(insee);

  // Handige linkset voor UI
  const links = {
    etalab_app: 'https://app.dvf.etalab.gouv.fr/',
    commune_json: `${BASE}/communes/${insee}.json`,
    dep_csv_gz: `${BASE}/csv/${dep}.csv.gz`,
    dep_parquet: `${BASE}/parquet/${dep}.parquet`,
    dep_context: {
      rural_tip:
        'Gebruik INSEE-typologie + DVF van het departement voor rurale vergelijking',
      urban_tip:
        'Gebruik DVF binnen hetzelfde EPCI/aire urbaine voor stedelijke context',
    },
  };

  // 1) Probeer per-commune JSON
  try {
    const r = await fetch(links.commune_json, { headers: { accept: 'application/json' } });
    if (r.ok) {
      const data = await r.json();
      const feats = Array.isArray(data?.features) ? data.features : [];

      // Median € / m² (valeur_fonciere gedeeld door gebouwde of terrein-oppervlakte)
      let median = null;
      try {
        const values = feats
          .map((f) => {
            const p = f?.properties || {};
            const price = +p.valeur_fonciere;
            const surf =
              +(p.surface_reelle_bati ?? 0) > 0
                ? +p.surface_reelle_bati
                : +(p.surface_terrain ?? 0);
            return price > 0 && surf > 0 ? price / surf : null;
          })
          .filter(Number.isFinite)
          .sort((a, b) => a - b);

        if (values.length) {
          const m = Math.floor(values.length / 2);
          median =
            values.length % 2 ? Math.round(values[m]) : Math.round((values[m - 1] + values[m]) / 2);
        }
      } catch {
        // laat median op null staan
      }

      return j({
        ok: true,
        source: 'commune',
        insee,
        dep,
        available: { commune_json: true },
        summary: {
          transactions: feats.length,
          median_eur_m2: median,
        },
        links,
        meta: { timestamp: new Date().toISOString() },
      });
    }
  } catch {
    // stil vallen; we doen fallback
  }

  // 2) Fallback naar departement
  return j({
    ok: true,
    source: 'departement-fallback',
    insee,
    dep,
    available: { commune_json: false },
    summary: null,
    note: 'Geen per-gemeente DVF-JSON gevonden. Gebruik departementsbestanden of de Etalab-app.',
    links,
    meta: { timestamp: new Date().toISOString() },
  });
}
