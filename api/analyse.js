// api/analyse.js
// Franse vastgoedtool – AI-voorbereiding met DVF + context
export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Alleen POST' });
  }

  const { dossier } = req.body || {};
  if (!dossier) {
    return res.status(400).json({ error: 'Geen dossier ontvangen' });
  }

  // heel simpele plek-zoeker uit het dossier
  function pickCommune(raw) {
    // zoek naar "Controleer risico's voor: X"
    const m =
      raw.match(/Controleer risico's voor:\s*([^\n]+)/i) ||
      raw.match(/Controleer DVF voor:\s*([^\n]+)/i);
    if (m) {
      return m[1].trim();
    }
    return '';
  }

  const commune = pickCommune(dossier);
  const encodedCommune = commune ? encodeURIComponent(commune) : '';

  // vaste Franse bronnen die jij noemde
  const extraSources = [
    'https://www.georisques.gouv.fr/',
    commune
      ? `https://app.dvf.etalab.gouv.fr/?q=${encodedCommune}`
      : 'https://app.dvf.etalab.gouv.fr/',
    commune
      ? `https://www.geoportail-urbanisme.gouv.fr/map/?q=${encodedCommune}`
      : 'https://www.geoportail-urbanisme.gouv.fr/map/',
    // jouw extra’s:
    commune
      ? `https://en.wikipedia.org/wiki/${encodeURIComponent(commune)}`
      : 'https://en.wikipedia.org/wiki/France',
    commune
      ? `https://www.banatic.interieur.gouv.fr/commune/${commune
          .replace(/\s+/g, '-')
          .toLowerCase()}`
      : 'https://www.banatic.interieur.gouv.fr/',
    commune
      ? `https://demarchesadministratives.fr/prefecture/${commune
          .replace(/\s+/g, '-')
          .toLowerCase()}`
      : 'https://demarchesadministratives.fr/'
  ];

  // we bouwen hier de prompt zoals de frontend ‘m wil hebben
  const needToKnow = `
JE BENT EEN FRANSE VASTGOED-ANALIST.
JE MAG ALLEEN WERKEN MET HET DOSSIER.
GEEN EXTRA TELEFOONNUMMERS, OPENINGSTIJDEN OF NAMEN VERZINNEN.

Geef ALLEEN dit terug:

[VASTGOED-DOSSIER – NEED TO KNOW]
- 5 rode vlaggen (max)
- Wat nu regelen (ERP / PLU / servitudes / verzekering)
- 3 vragen voor verkoper
- 3 vragen voor notaris
- 3 vragen voor makelaar

LET OP: Als exact adres ontbreekt → zeg dat ERP < 6 mnd + références cadastrales MOET.
Als DVF alleen op gemeente-niveau is → zeg dat en noem de DVF-link.
  `.trim();

  const niceToKnow = `
[OMGEVINGSDOSSIER – NICE TO KNOW]
Geef een kort beeld van de gemeente / intercommunalité / ligging, MAAR:
- alleen wat logisch uit het dossier volgt (bv. kust, Loire, Dordogne-vallei)
- verwijs naar de 3 bronnen hieronder voor detail
- niet langer dan 10 zinnen

[BRONNEN]
${extraSources.map((u) => `- ${u}`).join('\n')}
  `.trim();

  // dit gaat mee naar Gemini
  const finalPrompt = `${needToKnow}

--- DOSSIER ---
${dossier}

${niceToKnow}
`;

  // roep Gemini aan
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // we geven ALTIJD iets terug
    return res.status(200).json({
      analysis:
        '⚠️ Geen GEMINI_API_KEY in Vercel.\n\n' +
        '[VASTGOED-DOSSIER – NEED TO KNOW]\n' +
        '- ERP < 6 mnd opvragen\n- PLU via Géoportail-Urbanisme\n- DVF checken op gemeente\n\n' +
        '[OMGEVINGSDOSSIER – NICE TO KNOW]\n' +
        extraSources.join('\n'),
      needToKnow,
      niceToKnow,
      sources: extraSources
    });
  }

  try {
    const resp = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' +
        apiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: finalPrompt }] }]
        })
      }
    );

    const raw = await resp.json();

    if (!resp.ok) {
      return res.status(resp.status).json({ error: raw });
    }

    const candidate = raw?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const text = parts.map((p) => p.text || '').join('\n').trim();

    return res.status(200).json({
      analysis: text || '(leeg antwoord van AI)',
      needToKnow,
      niceToKnow,
      sources: extraSources
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
