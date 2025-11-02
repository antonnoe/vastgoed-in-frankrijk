// api/analyse.js
export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Alleen POST' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY ontbreekt in Vercel' });
  }

  const { dossier } = req.body || {};
  if (!dossier) {
    return res.status(400).json({ error: 'dossier ontbreekt' });
  }

  // jouw prompt rechtstreeks doorzetten
  const prompt = dossier;

  try {
    const resp = await fetch(
      // LET OP: nieuw model + nog steeds v1beta
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
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

    const parts = raw?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
      ? parts.map((p) => p.text || '').join('\n').trim()
      : '';

    return res.status(200).json({
      analysis: text || '⚠️ AI gaf geen tekst terug.',
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
