// /api/gpu.js
// Haalt de exacte bestemmingszone op voor een specifiek punt (lat/lon)
// Bron: IGN Apicarto GPU

export default async function handler(req, res) {
  const { lat, lon } = req.query;

  // Check of we coördinaten hebben
  if (!lat || !lon) {
    return res.status(400).json({ ok: false, error: 'Coördinaten (lat/lon) ontbreken' });
  }

  try {
    // IGN verwacht GeoJSON formaat: [lengtegraad, breedtegraad]
    const geom = JSON.stringify({
      type: "Point",
      coordinates: [parseFloat(lon), parseFloat(lat)]
    });

    const url = `https://apicarto.ign.fr/api/gpu/zone-urba?geom=${encodeURIComponent(geom)}`;
    
    // Timeout instellen (IGN is soms traag)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      // 404 betekent: Geen digitaal plan beschikbaar op deze plek
      return res.status(200).json({ ok: true, zones: [] });
    }

    const json = await response.json();
    const features = json.features || [];

    // Map de data naar een leesbaar formaat voor de frontend
    const zones = features.map(f => ({
      type: f.properties.typezone, // bijv 'U' (Urbain), 'N' (Naturel)
      code: f.properties.libelle,  // bijv 'Ua', 'N1'
      label: f.properties.libelong // Volledige omschrijving
    }));

    return res.status(200).json({ ok: true, zones });

  } catch (error) {
    console.error('GPU API error:', error);
    // Soft fail: stuur lege zones terug zodat de app niet crasht
    return res.status(200).json({ ok: true, zones: [] });
  }
}
