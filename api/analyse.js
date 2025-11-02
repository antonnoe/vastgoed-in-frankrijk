// api/analyse.js
export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Alleen POST' });
  }

  const { dossier } = req.body || {};
  const sample = `1) Rode vlaggen
- Dit is een testrespons uit de API (geen AI)
- Dossier ontvangen: ${dossier ? 'ja' : 'nee'}

2) Wat nu regelen
- N.v.t. (test)

3) Vragen aan verkoper/notaris/makelaar
- N.v.t. (test)`;

  return res.status(200).json({ analysis: sample });
}
