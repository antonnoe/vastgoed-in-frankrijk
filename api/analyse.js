// api/analyse.js
export const config = { runtime: 'nodejs' };

const DISCLAIMER = `
---
Immodiagnostique — consumentenhulpmiddel (bèta).
Dit is géén vervanging van het verplichte ERP (< 6 mnd), geen notariële akte
en geen garantie op verzekerbaarheid. Laat de uitkomst altijd toetsen door
de Franse notaris / mairie / verzekeraar. Bronlinks: Géorisques, DVF, Géoportail.
`;

export default async function handler(req, res) {
  // 1. alleen POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Alleen POST' });
  }

  // 2. prompt/dossier uit body
  const { dossier } = req.body || {};
  if (!dossier) {
    return res.status(400).json({ error: 'Geen dossier ontvangen.' });
  }

  // 3. api key uit env
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY ontbreekt in de Vercel environment.'
    });
  }

  // 4. prompt opbouwen (we sturen door wat jij al had)
  const prompt = dossier;

  // 5. naar Gemini sturen
  try {
    const resp = await fetch(
      'https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=' +
        encodeURIComponent(apiKey),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );

    const raw = await resp.json();

    if (!resp.ok) {
      // fout van Gemini teruggeven zodat jij het in de UI ziet
      return res.status(resp.status).json({ error: raw });
    }

    // 6. tekst eruit peuteren
    const candidate = raw?.candidates?.[0];
    const parts = candidate?.content?.parts;
    let text = '';

    if (Array.isArray(parts) && parts.length > 0) {
      text = parts.map((p) => p.text || '').join('\n').trim();
    }

    if (!text) {
      text =
        '?? AI gaf geen tekst terug. Ruwe respons:\n' +
        JSON.stringify(raw, null, 2);
    }

    // 7. disclaimer en merknaam er ALTIJD achter
    const finalText = text + '\n' + DISCLAIMER.trim() + '\n';

    return res.status(200).json({ analysis: finalText });
  } catch (e) {
    // 8. echte serverfout
    return res.status(500).json({ error: e.message });
  }
}
