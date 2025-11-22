// /api/dvf.js
// Haalt historische huizenprijzen op (Etalab)

export default async function handler(req, res) {
  const { insee } = req.query;

  if (!insee) return res.status(400).json({ ok: false, error: 'INSEE missing' });

  try {
    // We vragen de statistieken op voor de gemeente over de laatste 5 jaar
    const url = `https://apidvf.etalab.gouv.fr/api/mutations/3j/distribution/${insee}`;
    
    // Korte timeout want deze API is snel
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      // Fallback: als gemeente te klein is voor data, geef leeg object terug (frontend toont dan 'Fallback')
      return res.status(200).json({ ok: true, source: 'none', summary: {} });
    }

    const json = await response.json();
    
    // We zoeken naar de mediaan prijs per m2 voor huizen (Maison)
    // De API geeft vaak: { "all": { ... }, "Maison": { ... }, "Appartement": { ... } }
    const stats = json.Maison || json.all || {};
    
    return res.status(200).json({ 
      ok: true, 
      source: 'commune',
      summary: {
        median_eur_m2: stats.mediane_m2 || null,
        count: stats.nb_mutations || 0
      }
    });

  } catch (error) {
    // Geen paniek, gewoon doorgaan zonder prijsdata
    return res.status(200).json({ ok: true, source: 'error', summary: {} });
  }
}
