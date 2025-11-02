// /api/analyse.js
export const config = { runtime: 'nodejs' };

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

async function fetchJson(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    console.error('fetchJson error for', url, e.message);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Alleen POST' });
  }

  const { dossier } = req.body || {};
  if (!dossier) {
    return res.status(400).json({ error: 'dossier is verplicht' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY ontbreekt in environment' });
  }

  // 1) heel simpele adres-extractie uit jouw prompt
  // we zoeken naar een regel die begint met [ADRES / ADVERTENTIE] en pakken de volgende regel
  let adresRegel = '';
  const lines = dossier.split('\n');
  const idx = lines.findIndex((l) => l.trim().toLowerCase().startsWith('[adres / advertentie]'));
  if (idx !== -1 && lines[idx + 1]) {
    adresRegel = lines[idx + 1].trim();
  }

  // 2) BASIS: probeer INSEE te halen uit BAN
  let insee = '';
  let banInfo = null;
  if (adresRegel) {
    const banUrl =
      'https://api-adresse.data.gouv.fr/search/?q=' +
      encodeURIComponent(adresRegel) +
      '&limit=1';
    banInfo = await fetchJson(banUrl);
    const feat = banInfo?.features?.[0];
    if (feat?.properties?.citycode) {
      insee = feat.properties.citycode; // bv. 62170 → citycode
    }
  }

  // 3) GÉORISQUES op basis van INSEE
  let georisquesText = 'Geen automatische Géorisques-data (geen INSEE gevonden).';
  if (insee) {
    const geoUrl =
      'https://api.georisques.gouv.fr/v1/catnat?code_insee=' +
      encodeURIComponent(insee) +
      '&page=1&page_size=20';
    const geo = await fetchJson(geoUrl);
    if (geo?.data) {
      if (geo.data.length === 0) {
        georisquesText = `Géorisques: geen erkende CatNat voor INSEE ${insee}.`;
      } else {
        georisquesText =
          `Géorisques: ${geo.data.length} CatNat voor INSEE ${insee} (meest recente eerst).\n` +
          JSON.stringify(geo.data, null, 2);
      }
    }
  }

  // 4) DVF commune stats
  let dvfText = 'Geen automatische DVF-data.';
  if (insee) {
    const dvfUrl =
      'https://api.dvf.etalab.gouv.fr/api/latest/stats/commune?code_insee=' +
      encodeURIComponent(insee);
    const dvf = await fetchJson(dvfUrl);
    if (dvf) {
      dvfText = 'DVF (commune):\n' + JSON.stringify(dvf, null, 2);
    }
  }

  // 5) AUTOMATISCHE DATA-HEADER opbouwen
  const autoBlock = [
    '--- AUTOMATISCHE DATA (door Immodiagnostique) ---',
    adresRegel ? `Genormaliseerd adres (BAN poging): ${adresRegel}` : 'Adres kon niet worden gelezen.',
    insee ? `Gevonden INSEE: ${insee}` : 'INSEE niet gevonden.',
    '',
    georisquesText,
    '',
    dvfText,
    '--- EINDE AUTOMATISCHE DATA ---',
    ''
  ].join('\n');

  const finalPrompt = autoBlock + dossier;

  // 6) naar Gemini sturen
  try {
    const resp = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: finalPrompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 900
        }
      })
    });

    const raw = await resp.json();
    if (!resp.ok) {
      return res.status(resp.status).json({ error: raw });
    }

    const cand = raw?.candidates?.[0];
    const parts = cand?.content?.parts || [];
    const text = parts.map((p) => p.text || '').join('\n').trim();

    return res.status(200).json({
      analysis: text || '(AI gaf geen tekst terug)',
      auto: {
        adres: adresRegel || null,
        insee: insee || null,
        georisques: georisquesText,
        dvf: dvfText
      }
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
