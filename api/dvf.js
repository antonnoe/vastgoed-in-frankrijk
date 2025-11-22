// /api/dvf.js
// V9: EXPERT ENGINE (Cquest Source + Advanced Valuation + Caching)
// Fixed: Correct Node.js handler to prevent HTTP 405 errors.

const cache = new Map();

export default async function handler(req, res) {
  // 1. Methode Check (Voorkomt 405)
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const { insee, surface } = req.query;
  
  // 2. Validatie
  if (!insee || insee.length < 5) {
    return res.status(400).json({ ok: false, error: 'INSEE onjuist' });
  }

  const targetSurface = Number(surface) || 0;

  try {
    // 3. Data Ophalen (Met Caching)
    const dep = insee.substring(0, 2);
    let features = [];

    if (cache.has(dep)) {
      features = cache.get(dep);
    } else {
      // We gebruiken Cquest omdat die stabiel is en niet blokkeert
      const url = `https://data.cquest.org/dvf/latest/geojson/${dep}.geojson`;
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) throw new Error(`Bron onbereikbaar: ${response.status}`);
      
      const data = await response.json();
      features = data.features || [];
      
      // Cache opslaan (5 min)
      cache.set(dep, features);
      setTimeout(() => cache.delete(dep), 300000); 
    }

    // 4. Filteren: Alleen Huizen, Alleen deze Gemeente, Geen symbolische bedragen
    let transactions = features.filter(f => 
      f.properties.code_commune === insee &&
      f.properties.type_local === 'Maison' &&
      f.properties.valeur_fonciere > 15000 && 
      f.properties.surface_reelle_bati > 10
    );

    if (transactions.length === 0) {
      return res.status(200).json({ ok: true, source: 'none', summary: {}, comparables: [] });
    }

    // 5. Slimme Selectie (De Rolls Royce logica)
    // Als we een oppervlakte hebben, zoeken we vergelijkbare panden (range 60%-140%)
    let comps = transactions;
    if (targetSurface > 0) {
      const tight = transactions.filter(f => {
        const s = f.properties.surface_reelle_bati;
        return s >= targetSurface * 0.6 && s <= targetSurface * 1.4;
      });
      // Alleen filteren als we genoeg data overhouden (>5 panden), anders te onnauwkeurig
      if (tight.length >= 5) comps = tight; 
    }

    // 6. Berekeningen (P10, Mediaan, P90)
    const pricesM2 = comps.map(f => {
      return f.properties.valeur_fonciere / f.properties.surface_reelle_bati;
    }).sort((a, b) => a - b);

    const count = pricesM2.length;
    const median = pricesM2[Math.floor(count / 2)];
    const p10 = pricesM2[Math.floor(count * 0.10)] || median;
    const p90 = pricesM2[Math.floor(count * 0.90)] || median;

    // 7. Selecteer de Top 5 meest recente vergelijkbare verkopen (voor de AI prompt)
    // We sorteren eerst op datum aflopend
    const recentComps = [...comps]
      .sort((a, b) => new Date(b.properties.date_mutation) - new Date(a.properties.date_mutation))
      .slice(0, 5)
      .map(f => ({
        date: f.properties.date_mutation,
        price: f.properties.valeur_fonciere,
        surface: f.properties.surface_reelle_bati,
        m2_price: Math.round(f.properties.valeur_fonciere / f.properties.surface_reelle_bati)
      }));

    // 8. De Output
    const summary = {
      median_eur_m2: Math.round(median),
      count_total: transactions.length,
      count_comps: comps.length,
      price_range: {
        low: Math.round(p10),
        high: Math.round(p90)
      }
    };

    // Waardering specifiek voor dit huis (als surface bekend is)
    let valuation = null;
    if (targetSurface > 0) {
      valuation = {
        fair_value: Math.round(median * targetSurface),
        range_low: Math.round(p10 * targetSurface),
        range_high: Math.round(p90 * targetSurface)
      };
    }

    return res.status(200).json({ 
      ok: true, 
      source: 'cquest', 
      summary, 
      valuation,
      comparables: recentComps 
    });

  } catch (error) {
    console.error('DVF Engine Error:', error);
    // Geef een clean error object terug zodat de frontend niet crasht
    return res.status(200).json({ ok: true, source: 'error', summary: {}, error: error.message });
  }
}
