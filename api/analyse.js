// api/analyse.js

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  // alleen POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Alleen POST' });
  }

  // input uit de tool
  const { dossier } = req.body || {};
  if (!dossier) {
    return res.status(400).json({ error: 'Geen dossier meegegeven' });
  }

  // API key uit Vercel env
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY ontbreekt in Vercel' });
  }

  // prompt = precies wat jij in de textarea zet
  const prompt = dossier;

  try {
    const resp = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-001:generateContent?key=' +
        apiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ]
        })
      }
    );

    const raw = await resp.json();

    // als Google iets terugstuurt dat geen 200 is
    if (!resp.ok) {
      return res.status(resp.status).json({ error: raw });
    }

    // tekst eruit peuteren
    const candidate = raw?.candidates?.[0];
    const parts = candidate?.content?.parts;
    let text = '';

    if (Array.isArray(parts) && parts.length > 0) {
      text = parts.map((p) => p.text || '').join('\n').trim();
    }

    if (!text) {
      text =
        '⚠️ AI gaf geen leesbare tekst terug. Ruwe respons:\n' +
        JSON.stringify(raw, null, 2);
    }

    // dit gebruikt jouw frontend
    return res.status(200).json({ analysis: text });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
