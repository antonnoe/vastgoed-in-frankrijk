// api/compose.js
export const config = { runtime: 'nodejs' };

const MODEL = 'models/gemini-2.0-flash-exp:generateContent';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/${MODEL}`;

function letterSystemPrompt(kind, lang) {
  const base =
`Je schrijft een KORTE, beleefde en concrete brief op basis van het meegegeven AI-overzicht (context).
GEEN nieuwe feiten verzinnen. Geen telefoonnummers of openingstijden. Maximaal ~220 woorden.
Structuur: aanhef, kern met 3–5 puntsgewijze vragen/verzoeken, slotzin, ondertekening "Cordialement" (FR) of passend in taal.`;

  const map = {
    notaris: {
      FR: `${base}
Taal: FR. Geadresseerde: Notaire. Focus op: ERP (<6 mois), références cadastrales, servitudes/SUP, PLU, état hypothécaire.`,
      NL: `${base}
Taal: NL. Geadresseerde: notaris. Focus: ERP (<6 maanden), kadastrale refs, servitudes/SUP, PLU, hypotheken.`,
      EN: `${base}
Language: EN. Addressee: Notary. Focus: ERP (<6 months), cadastral refs, servitudes/SUP, PLU, encumbrances.`
    },
    makelaar: {
      FR: `${base}
Taal: FR. Geadresseerde: Agent immobilier. Focus: adresse exact, références cadastrales, DPE, conformité PLU, prix (comparables DVF), documents.`,
      NL: `${base}
Taal: NL. Geadresseerde: makelaar. Focus: exact adres, kadastrale refs, DPE/diagnostics, PLU-conformiteit, DVF-vergelijking.`,
      EN: `${base}
Language: EN. Addressee: Listing agent. Focus: exact address, cadastral refs, DPE/diagnostics, PLU compliance, DVF comparison.`
    },
    verkoper: {
      FR: `${base}
Taal: FR. Geadresseerde: Vendeur. Respectvol. Focus: adresse exact, références cadastrales, ERP récent, informations essentielles sur le bien.`,
      NL: `${base}
Taal: NL. Geadresseerde: verkoper. Respectvol. Focus: exact adres, kadastrale refs, recent ERP, kerninformatie over het object.`,
      EN: `${base}
Language: EN. Addressee: Seller. Polite. Focus: exact address, cadastral refs, fresh ERP, key property details.`
    }
  };

  return (map[kind]?.[lang] || map.verkoper.NL);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Alleen POST' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server misconfigured: GEMINI_API_KEY ontbreekt' });

  try {
    const { kind, lang, context } = req.body || {};
    if (!context || !kind) {
      return res.status(400).json({ error: 'Vereist: kind en context' });
    }

    const language = (lang || 'NL').toUpperCase();
    const sys = letterSystemPrompt(kind, language);

    const prompt =
`${sys}

--- CONTEXT (NIET HERHALEN, ALLEEN GEBRUIKEN) ---
${context}

--- INSTRUCTIES ---
- Schrijf 1 compacte brief.
- Gebruik een neutrale, professionele toon.
- Plaats puntsgewijze vragen/verzoeken middenin.
- Geen persoonlijke gegevens invullen.`;

    const resp = await fetch(ENDPOINT + `?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const raw = await resp.json();
    if (!resp.ok) {
      return res.status(resp.status).json({ error: raw });
    }

    const candidate = raw?.candidates?.[0];
    const parts = candidate?.content?.parts;
    let text = '';
    if (Array.isArray(parts) && parts.length > 0) {
      text = parts.map(p => p.text || '').join('\n').trim();
    }
    if (!text) {
      text = '⚠️ AI gaf geen tekst terug.\n' + JSON.stringify(raw, null, 2);
    }

    return res.status(200).json({ letter: text });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
