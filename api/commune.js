// /api/commune.js
// Zoekt gemeentes op naam of postcode via de officiële API Géo

export default async function handler(req, res) {
  const { city, postcode } = req.query;

  if (!city && !postcode) {
    return res.status(400).json({ ok: false, error: 'City or postcode missing' });
  }

  try {
    // We gebruiken de API Géo van de Franse overheid
    // boost=population zorgt dat grote steden bovenaan komen bij gelijke namen
    let url = `https://geo.api.gouv.fr/communes?fields=nom,code,codesPostaux,centre,population&boost=population&limit=1`;
    
    if (postcode) url += `&codePostal=${postcode}`;
    if (city) url += `&nom=${encodeURIComponent(city)}`;

    const response = await fetch(url);
    const data = await response.json();

    if (!data || data.length === 0) {
      return res.status(404).json({ ok: false, error: 'Gemeente niet gevonden' });
    }

    const c = data[0];
    
    // Formatteer de output voor onze frontend
    const result = {
      name: c.nom,
      insee: c.code,
      zip: c.codesPostaux ? c.codesPostaux[0] : postcode,
      population: c.population,
      // Coördinaten zijn nodig voor de GPU check!
      lon: c.centre?.coordinates?.[0], 
      lat: c.centre?.coordinates?.[1]
    };

    return res.status(200).json({ ok: true, commune: result });

  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
