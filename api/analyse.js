// api/analyse.js
export const config = {
  runtime: 'nodejs',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Alleen POST toegestaan' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY ontbreekt op de server' });
  }

  const { dossier } = req.body || {};
  if (!dossier) {
    return res.status(400).json({ error: 'dossier ontbreekt' });
  }

  const prompt = `
Je bent een assistent voor Nederlandse en Vlaamse kopers van Frans vastgoed.

Analyseer het volgende dossier en antwoord ALLEEN in deze 3 blokken:

1. Rode vlaggen (max. 5 bullets)
2. Wat nu regelen (verzekering / ERP / PLU / servitudes)
3. Vragen aan verkoper, notaris en makelaar (3×3 bullets)

Belangrijk:
- Als het exacte adres ontbreekt: ZEG DAT en verwijs naar ERP < 6 maanden + références cadastrales.
- Maak niets mooier dan het is.
- Schrijf in het Nederlands.

--- DOSSIER ---
${dossier}
  `.trim();

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5',
        messages: [
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(resp.status).json({ error: text });
    }

    const data = await resp.json();
    const answer = data.choices?.[0]?.message?.content || 'Geen antwoord ontvangen.';
    return res.status(200).json({ analysis: answer });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
