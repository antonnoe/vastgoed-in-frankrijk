// api/summary.js — resolveert alleen gemeente/INSEE + nuttige links (GEEN DVF CALLS)
export const config = { runtime: 'edge' };

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

async function fetchCommune({ city, postcode }) {
  const params = new URLSearchParams();
  if (city) params.set('nom', city);
  if (postcode) params.set('codePostal', postcode);
  params.set('boost', 'population');
  params.set('limit', '1');

  const url = `https://geo.api.gouv.fr/communes?${params.toString()}`;
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) return null;
  const arr = await r.json();
  if (!Array.isArray(arr) || !arr.length) return null;

  const c = arr[0];
  return {
    insee: c.code,
    name: c.nom,
    postcodes: c.codesPostaux || [],
    department: c.departement
      ? { code: c.departement.code, name: c.departement.nom }
      : null,
    lat: c.centre?.coordinates?.[1] ?? null,
    lon: c.centre?.coordinates?.[0] ?? null,
  };
}

export default async function handler(req) {
  try {
    // ping
    const url = new URL(req.url);
    if (url.searchParams.get('ping')) {
      return json({ ok: true, pong: true, timestamp: new Date().toISOString() });
    }

    // input: GET of POST
    let city = '';
    let postcode = '';
    if (req.method === 'GET') {
      city = (url.searchParams.get('city') || '').trim();
      postcode = (url.searchParams.get('postcode') || '').trim();
    } else if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      city = (body.city || '').trim();
      postcode = (body.postcode || '').trim();
    } else {
      return json({ ok: false, error: 'Gebruik GET of POST.' }, 405);
    }

    if (!city && !postcode) {
      return json(
        { ok: false, error: "Bad Request: geef minimaal 'city' of 'postcode'." },
        400
      );
    }

    // resolve commune
    const commune = await fetchCommune({ city, postcode });
    // Links (alleen op basis van INSEE; geen externe API-calls hier)
    const insee = commune?.insee || null;
    const links = insee
      ? {
          georisques_commune: `https://www.georisques.gouv.fr/commune/${insee}`,
          gpu_commune: `https://www.geoportail-urbanisme.gouv.fr/recherche?insee=${insee}`,
          geoportail_map: commune?.lon && commune?.lat
            ? `https://www.geoportail.gouv.fr/carte?c=${commune.lon},${commune.lat}&z=12`
            : null,
        }
      : null;

    return json({
      ok: true,
      input: { city, postcode },
      commune: commune || null,
      georisques: links
        ? { summary: null, links: { commune: links.georisques_commune } }
        : null,
      gpu: links
        ? { zones: [], links: { gpu_site_commune: links.gpu_commune } }
        : null,
      links: links || null,
      meta: { insee, timestamp: new Date().toISOString() },
    });
  } catch (e) {
    return json({ ok: false, error: e.message || 'Internal Error' }, 500);
  }
}
