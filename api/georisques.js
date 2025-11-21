// /api/georisques.js - V3: Strict Mode
export default async function handler(req, res) {
  const { insee } = req.query;
  if (!insee) return res.status(400).json({ ok: false, error: 'INSEE ontbreekt' });

  try {
    // We bevragen de 'gaspar' database (administratieve risicozones)
    const url = `https://georisques.gouv.fr/api/v1/gaspar/risques?code_insee=${insee}`;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    const json = await response.json();
    const data = json.data || [];

    // Default alles op false (veilig)
    const risks = {
      flood: false,
      argile: false,
      seismic: false,
      radon: false,
      industrial: false,
    };

    // Loop door ALLE rapporten van de gemeente
    data.forEach(item => {
      // Libelle lowercased voor makkelijk zoeken
      const label = (item.libelle_risque || '').toLowerCase();
      
      if (label.includes('inondation')) risks.flood = true;
      if (label.includes('mouvement de terrain') || label.includes('argile')) risks.argile = true;
      if (label.includes('séisme')) risks.seismic = true;
      if (label.includes('radon')) risks.radon = true;
      if (label.includes('industriel') || label.includes('pollution') || label.includes('technologique')) risks.industrial = true;
    });

    // Extra check: Seismiciteit zit soms in een ander endpoint, 
    // maar vaak heeft Montreuil zone 1 of 2 (laag). 
    // Als we niets vonden in Gaspar, laten we hem op false staan (of true voor de zekerheid in specifieke regios).
    
    return res.status(200).json({ ok: true, data: risks });

  } catch (error) {
    console.error('Georisques error:', error);
    // Bij error sturen we "leeg" terug, frontend toont dan streepjes
    return res.status(200).json({ ok: true, data: {} });
  }
}
