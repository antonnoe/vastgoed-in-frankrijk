// api/georisques.js
export default async function handler(req, res) {
  const { insee } = req.query;

  if (!insee) {
    return res.status(400).json({ ok: false, error: 'INSEE ontbreekt' });
  }

  try {
    // We gebruiken de officiële Géorisques API
    const url = `https://georisques.gouv.fr/api/v1/gaspar/risques?code_insee=${insee}`;
    
    // Fetch met timeout van 5 sec (overheid API is soms traag)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      // Als de gemeente niet gevonden is, is dat geen harde error, maar gewoon 'geen data'
      return res.status(200).json({ ok: true, data: {} });
    }

    const json = await response.json();
    const data = json.data || [];

    // De API geeft een lijst van risico's terug. Wij mappen dit naar een simpel object.
    const risks = {
      flood: false,      // Inondation
      argile: false,     // Mouvement de terrain / Argile
      seismic: false,    // Séisme
      radon: false,      // Radon
      industrial: false, // Installations classées / Pollutions
    };

    // Loop door de resultaten van de overheid
    // Elk item in 'data' is een risicocategorie
    if (Array.isArray(data)) {
        data.forEach(item => {
            const code = item.code_risque || '';
            const label = (item.libelle_risque || '').toLowerCase();
            
            // Logica: als het item in de lijst staat, is er in principe een risico in de gemeente.
            // Soms moeten we checken op specifieke codes.
            
            if (label.includes('inondation')) risks.flood = true;
            if (label.includes('mouvement de terrain') || label.includes('argile')) risks.argile = true;
            if (label.includes('séisme')) risks.seismic = true;
            if (label.includes('radon')) risks.radon = true;
            if (label.includes('industriel') || label.includes('pollution')) risks.industrial = true;
        });
    }

    // Specifieke check voor Radon: de API geeft soms 'niveau 1' (laag) of 'niveau 3' (hoog).
    // Voor nu zetten we true als het woord radon voorkomt, maar je kunt dit verfijnen.

    return res.status(200).json({ ok: true, data: risks });

  } catch (error) {
    console.error('Georisques fout:', error);
    // Bij timeout of crash sturen we lege data terug zodat de app niet crasht
    return res.status(200).json({ ok: true, data: {} });
  }
}
