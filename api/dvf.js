// /api/dvf.js
// Bron: Cquest DVF Mirror (Robuust & Future-proof)
// Functie: Haalt transacties op per departement, filtert op gemeente en berekent mediaan.

// Simpele in-memory cache voor de serverless instance (versnelt herhaalde calls)
const cache = new Map();

export default async function handler(req, res) {
  const { insee } = req.query;

  if (!insee || insee.length < 5) {
    return res.status(400).json({ ok: false, error: 'INSEE onjuist' });
  }

  try {
    // 1. Bepaal departement (eerste 2 cijfers, of 3 voor overzees)
    // Voor simpelheid: eerste 2 chars (werkt voor 99% v/d gevallen op het vasteland)
    const dep = insee.substring(0, 2); 
    
    // 2. Haal data op (of uit cache)
    let features = [];
    
    if (cache.has(dep)) {
      console.log(`Cache hit voor dep ${dep}`);
      features = cache.get(dep);
    } else {
      console.log(`Fetching DVF voor dep ${dep} via Cquest...`);
      const url = `https://data.cquest.org/dvf/latest/geojson/${dep}.geojson`;
      
      // Timeout na 8 sec (bestanden kunnen groot zijn)
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Cquest faalde met status ${response.status}`);
      }

      const data = await response.json();
      features = data.features || [];
      
      // Cache opslaan (alleen de features array om geheugen te sparen)
      cache.set(dep, features);
    }

    // 3. Filter op de specifieke gemeente (INSEE) en Type Woning (Maison)
    const transactions = features.filter(f => 
      f.properties.code_commune === insee &&
      f.properties.type_local === 'Maison' &&
      f.properties.valeur_fonciere > 10000 && // Filter symbolische verkopen eruit
      f.properties.surface_reelle_bati > 10     // Filter schuurtjes eruit
    );

    if (transactions.length === 0) {
      return res.status(200).json({ ok: true, source: 'none', summary: {} });
    }

    // 4. Bereken de Mediaan Prijs per m²
    const pricesPerM2 = transactions.map(f => {
      const price = f.properties.valeur_fonciere;
      const surface = f.properties.surface_reelle_bati;
      return price / surface;
    }).sort((a, b) => a - b);

    const count = pricesPerM2.length;
    let median = 0;

    if (count > 0) {
      const mid = Math.floor(count / 2);
      median = (count % 2 !== 0) 
        ? pricesPerM2[mid] 
        : (pricesPerM2[mid - 1] + pricesPerM2[mid]) / 2;
    }

    // Afronden op hele euro's
    median = Math.round(median);

    return res.status(200).json({ 
      ok: true, 
      source: 'cquest',
      summary: {
        median_eur_m2: median,
        count: count,
        last_transaction: transactions[0]?.properties?.date_mutation // Handig voor debug
      }
    });

  } catch (error) {
    console.error('DVF Cquest Error:', error.message);
    // Soft fail: Geen crash, maar lege data
    return res.status(200).json({ ok: true, source: 'error', summary: {} });
  }
}
