// api/dvf.js
export const config = { runtime: 'edge' };

const DVF_BASE = 'https://files.data.gouv.fr/geo-dvf/latest';
const GEO_COMMUNE = 'https://geo.api.gouv.fr/communes';

const json = (obj, status=200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('ping')) return json({ ok: true, pong: true, timestamp: new Date().toISOString() });

  const insee = (searchParams.get('insee') || '').trim();
  if (!insee) return json({ ok:false, error: "Bad Request: 'insee' is verplicht." }, 400);

  // 1) Bestaat per-commune DVF JSON?
  const communeUrl = `${DVF_BASE}/communes/${insee}.json`;
  const head = await fetch(communeUrl, { method: 'HEAD' });
  // 2) Basis commune-meta
  const metaRes = await fetch(`${GEO_COMMUNE}/${insee}?fields=nom,code,codeDepartement,departement,region,population`);
  const metaOk = metaRes.ok ? await metaRes.json() : null;
  const dept = metaOk?.codeDepartement ?? metaOk?.departement?.code ?? null;

  const body = {
    ok: true,
    insee,
    commune: {
      name: metaOk?.nom ?? null,
      dept,
      region: metaOk?.region?.nom ?? null,
      population: typeof metaOk?.population === 'number' ? metaOk.population : null,
      rural_urban: (typeof metaOk?.population === 'number' && metaOk.population < 2000) ? 'meer landelijk' : 'meer stedelijk'
    },
    links: { etalab_app: 'https://app.dvf.etalab.gouv.fr/' },
    usedEndpoint: null,
    note: null,
    meta: { timestamp: new Date().toISOString() }
  };

  if (head.ok) {
    body.links.data_gouv_commune_json = communeUrl;
    body.usedEndpoint = communeUrl;
    body.note = 'Per-gemeente DVF gevonden.';
    return json(body);
  }

  if (dept) {
    body.links.data_gouv_dep_csv = `${DVF_BASE}/csv/${dept}.csv.gz`;
    body.links.data_gouv_dep_parquet = `${DVF_BASE}/parquet/${dept}.parquet`;
    body.note = 'Geen DVF per gemeente; gebruik departementsbestanden.';
  } else {
    body.note = 'Departement onbekend; gebruik DVF viewer en filter op INSEE.';
  }

  return json(body);
}
