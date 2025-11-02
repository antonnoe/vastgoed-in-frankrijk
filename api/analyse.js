// api/analyse.js
export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Alleen POST' });
  }

  const { dossier } = req.body || {};

  return res.status(200).json({
    ok: true,
    received: dossier || '(geen dossier ontvangen)'
  });
}
