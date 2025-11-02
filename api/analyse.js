// api/analyse.js
export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Alleen POST toegestaan' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY ontbreekt op de server' });
  }

  const { dossier } = req.body || {};
  if (!dossier) {
    return res.status(400).json({ error: 'dossier ontbreekt' });
  }

  const prompt = `
Je bent een Franse vastgoed-assistent voor NL/BE kopers en eigenaars.

Geef je antwoord ALLEEN in deze 3 blokken:

1. Rode vlaggen (max. 5 bullets)
2. Wat nu regelen (ERP < 6 mnd / PLU / servitudes / assainissement)
3. Vragen aan verkoper, notaris en makelaar (3×3 bullets)

--- DOSSIER ---
${dossier}
  `.trim();

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );

    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({ error: text });
    }

    const data = await r.json();
    const answer =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n') ||
      'Geen antwoord van Gemini.';
    return res.status(200).json({ analysis: answer });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
