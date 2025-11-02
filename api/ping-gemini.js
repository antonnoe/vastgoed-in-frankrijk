// api/ping-gemini.js
export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY ontbreekt in Vercel' });
  }

  // superkleine prompt
  const prompt = 'Geef 1 zin: ik ben bereikbaar.';

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );

    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({ error: data });
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n').trim() ||
      '(leeg antwoord)';

    return res.status(200).json({
      ok: true,
      model: 'gemini-1.5-flash',
      text
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
