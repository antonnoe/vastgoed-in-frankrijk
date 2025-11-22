// /api/dvf.js
// Prijshistorie met 'Anti-Block' headers

export default async function handler(req, res) {
  const { insee } = req.query;

  if (!insee) {
    return res.status(400).json({ ok: false, error: 'INSEE ontbreekt' });
  }

  try {
    // We vragen de prijsverdeling van de laatste 3 jaar
    const url = `https://apidvf.etalab.gouv.fr/api/mutations/3j/distribution/${insee}`;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000); // Max 4 sec wachten

    // HIER ZIT DE FIX: Headers toevoegen om blokkade te voorkomen
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Immodiagnostique/1.0)',
        'Accept': 'application/json'
      }
    });
    
    clearTimeout(timeout);

    if (!response.ok) {
      // Als de server nee zegt, stuur een "zachte" fail terug (geen crash)
      console.warn(`DVF Error ${response.status} voor ${insee}`);
      return res.status(200).json({ ok: true, source: 'none', summary: {} });
    }

    const json = await response.json();
    
    // We pakken de data voor 'Maison' (Huizen)
    // Structuur API is vaak: { "all": {..}, "Maison": {..}, "Appartement": {..} }
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
    console.error('DVF Fetch Failed:', error.message);
    // Stuur altijd een geldig JSON antwoord terug, anders blijft je frontend wachten
    return res.status(200).json({ ok: true, source: 'error', summary: {} });
  }
}
