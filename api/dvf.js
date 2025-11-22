// /api/dvf.js
// Bron: Cquest Mirror
// Functie: Geavanceerde waardering (P10/Median/P90) op basis van vergelijkbare panden.

const cache = new Map();

export default async function handler(req, res) {
  const { insee, surface } = req.query;
  const targetSurface = Number(surface) || 0;

  if (!insee || insee.length < 5) {
    return res.status(400).json({ ok: false, error: 'INSEE onjuist' });
  }

  try {
    // 1. Caching & Fetching (Departement niveau)
    const dep = insee.substring(0, 2);
    let features = [];

    if (cache.has(dep)) {
      features = cache.get(dep);
    } else {
      console.log(`Fetching Cquest DVF voor ${dep}...`);
      const url = `https://data.cquest.org/dvf/latest/geojson/${dep}.geojson`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) throw new Error(`Cquest status ${response.status}`);
      const data = await response.json();
      features = data.features || [];
      cache.set(dep, features);
    }

    // 2. Basis Filter: Gemeente + Huizen (Maison) + Normale prijzen
    let transactions = features.filter(f => 
      f.properties.code_commune === insee &&
      f.properties.type_local === 'Maison' &&
      f.properties.valeur_fonciere > 10000 &&
      f.properties.surface_reelle_bati > 10
    );

    if (transactions.length === 0) {
      return res.status(200).json({ ok: true, source: 'none', summary: {} });
    }

    // 3. Slimme Filter: Vergelijkbare Oppervlakte (indien opgegeven)
    // We zoeken huizen die +/- 40% zo groot zijn als het doel
    let comps = transactions;
    if (targetSurface > 0) {
      const rangeMin = targetSurface * 0.6;
      const rangeMax = targetSurface * 1.4;
      const filtered = transactions.filter(f => {
        const s = f.properties.surface_reelle_bati;
        return s >= rangeMin && s <= rangeMax;
      });
      // Alleen gebruiken als we genoeg vergelijkingsmateriaal overhouden (>3)
      if (filtered.length >= 3) {
        comps = filtered;
      }
    }

    // 4. Statistieken Berekenen (P10, Mediaan, P90)
    const pricesPerM2 = comps.map(f => {
      return f.properties.valeur_fonciere / f.properties.surface_reelle_bati;
    }).sort((a, b) => a - b);

    const count = pricesPerM2.length;
    const median = pricesPerM2[Math.floor(count / 2)];
    const p10 = pricesPerM2[Math.floor(count * 0.10)] || median; // Fallback
    const p90 = pricesPerM2[Math.floor(count * 0.90)] || median;

    // 5. Waardering opstellen
    const summary = {
      median_eur_m2: Math.round(median),
      count: transactions.length, // Totaal in gemeente
      comps_count: comps.length,  // Aantal gebruikt voor deze berekening
      price_range: {
        low: Math.round(p10),
        high: Math.round(p90)
      }
    };

    // Als er een oppervlakte is, geef dan ook de totale waarde-schatting
    let valuation = null;
    if (targetSurface > 0) {
      valuation = {
        fair_value: Math.round(median * targetSurface),
        range_low: Math.round(p10 * targetSurface),
        range_high: Math.round(p90 * targetSurface)
      };
    }

    return res.status(200).json({ ok: true, source: 'cquest', summary, valuation });

  } catch (error) {
    console.error('DVF Error:', error.message);
    return res.status(200).json({ ok: true, source: 'error', summary: {} });
  }
}
