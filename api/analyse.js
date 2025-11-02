// api/analyse.js
export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Alleen POST' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY ontbreekt in Vercel.' });
  }

  const { dossier } = req.body || {};
  if (!dossier) {
    return res.status(400).json({ error: 'dossier ontbreekt' });
  }

  // dit is jouw strenge prompt
  const prompt = dossier;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
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
      return res.status(resp.status).json({ error: raw });
    }

    const candidate = raw?.candidates?.[0];
    const parts = candidate?.content?.parts;
    let text = '';

    if (Array.isArray(parts) && parts.length > 0) {
      text = parts.map((p) => p.text || '').join('\n').trim();
    }

    if (!text) {
      text =
        '⚠️ AI gaf geen tekst terug. Ruwe respons:\n' +
        JSON.stringify(raw, null, 2);
    }

    return res.status(200).json({ analysis: text });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
