// /api/gpu.js - V3: Smart Fallback
export default async function handler(req, res) {
  const { lat, lon, insee } = req.query; // We accepteren nu ook INSEE als fallback

  // 1. Probeer eerst exact op coördinaten (Lat/Lon)
  if (lat && lon) {
    const zones = await fetchGpuByPoint(lat, lon);
    if (zones && zones.length > 0) {
      return res.status(200).json({ ok: true, match: 'exact', zones });
    }
  }

  // 2. Geen exacte treffer? Probeer op basis van gemeente (INSEE)
  // Dit toont of de gemeente überhaupt een digitaal plan heeft.
  if (insee) {
    const zones = await fetchGpuByPartition(insee);
    if (zones && zones.length > 0) {
      // We geven een algemene melding terug
      return res.status(200).json({ 
        ok: true, 
        match: 'commune', 
        zones: [{ code: 'PLU', label: 'Digitaal plan beschikbaar voor gemeente' }] 
      });
    }
  }

  // 3. Echt niets gevonden
  return res.status(200).json({ ok: true, match: 'none', zones: [] });
}

// --- Helpers ---

async function fetchGpuByPoint(lat, lon) {
  try {
    const geom = JSON.stringify({ type: "Point", coordinates: [parseFloat(lon), parseFloat(lat)] });
    const url = `https://apicarto.ign.fr/api/gpu/zone-urba?geom=${encodeURIComponent(geom)}`;
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) return [];
    const json = await resp.json();
    return (json.features || []).map(f => ({
      type: f.properties.typezone,
      code: f.properties.libelle,
      label: f.properties.libelong
    }));
  } catch (e) { return []; }
}

async function fetchGpuByPartition(insee) {
  try {
    // We vragen de "partition" (het document) op. Als die bestaat, is er een plan.
    const url = `https://apicarto.ign.fr/api/gpu/document?partition=DU_${insee}`;
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) return [];
    const json = await resp.json();
    // Als er features zijn, is er een plan
    return (json.features || []).length > 0 ? [true] : [];
  } catch (e) { return []; }
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
