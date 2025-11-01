// /api/insee-motor.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Alleen POST-verzoeken zijn toegestaan' });
  }

  const { plaats, postcode, straat, huisnummer } = req.body || {};
  if (!plaats) {
    return res.status(400).json({ error: 'Plaatsnaam is verplicht' });
  }

  const dossier = {
    adres: 'Niet gevonden',
    georisques: 'Niet opgehaald',
    dvf: 'Niet opgehaald'
  };

  let inseeCode = null;
  let kadasterId = null;

  // hulpfunctie lokaal defs
  async function fetchAPI(url) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return await r.json();
    } catch (e) {
      console.error('API-fout:', url, e.message);
      return null;
    }
  }

  try {
    // A. adres
    const query = [huisnummer, straat, postcode, plaats].filter(Boolean).join(' ');
    const baseGeoUrl = 'https://data.geopf.fr/geocodage/search?q=';
    const adresData = await fetchAPI(`${baseGeoUrl}${encodeURIComponent(query)}&limit=1`);
    const feature = adresData?.features?.[0];

    if (!feature) {
      return res.status(404).json({ error: `Adres niet gevonden voor: "${query}"` });
    }

    const props = feature.properties || {};
    inseeCode = props.citycode || null;
    kadasterId = props.cadastral_parcel_id || props.id_parcelle || null;

    dossier.adres = `Gevonden officieel adres: ${props.label || query}`;

    // Fallback INSEE op gemeente
    if (!inseeCode) {
      const gemeenteQuery = [postcode, plaats].filter(Boolean).join(' ');
      const gemeenteUrl = `${baseGeoUrl}${encodeURIComponent(gemeenteQuery)}&type=municipality&limit=1`;
      const gemeenteData = await fetchAPI(gemeenteUrl);
      const gemeente = gemeenteData?.features?.[0];
      if (!gemeente) {
        return res.status(404).json({ error: `Kon de gemeente-INSEE niet vinden voor: "${gemeenteQuery}"` });
      }
      inseeCode = gemeente.properties?.citycode;
      dossier.adres += '\n(Fallback: INSEE via gemeente opgehaald)';
    }

    // B. GeoRisques
    const georisquesUrl = `https://api.georisques.gouv.fr/api/v1/catnat?code_insee=${inseeCode}&page=1&page_size=10`;
    const risicoData = await fetchAPI(georisquesUrl);
    if (risicoData?.data?.length) {
      dossier.georisques = `LET OP: ${risicoData.data.length} CatNat-erkenning(en) voor deze gemeente.`;
      dossier.georisquesDetails = risicoData.data;
    } else {
      dossier.georisques = 'Geen CatNat gevonden voor deze gemeente.';
    }

    // C. DVF
    let dvfData = null;
    if (kadasterId) {
      const dvfPerceelUrl = `https://api.dvf.etalab.gouv.fr/api/latest/mutations?parcelle_id=${kadasterId}&around=500&limit=5`;
      dvfData = await fetchAPI(dvfPerceelUrl);
    }

    if (!dvfData || !dvfData.mutations || !dvfData.mutations.length) {
      const dvfGemeenteUrl = `https://api.dvf.etalab.gouv.fr/api/latest/stats/commune?code_insee=${inseeCode}`;
      const dvfStats = await fetchAPI(dvfGemeenteUrl);
      dossier.dvf = dvfStats
        ? 'Gemeentelijke DVF-statistieken gevonden.'
        : 'Geen DVF-gegevens gevonden.';
      dossier.dvfDetails = dvfStats || null;
    } else {
      dossier.dvf = 'Mutaties op/rond dit perceel gevonden.';
      dossier.dvfDetails = dvfData.mutations;
    }

    return res.status(200).json(dossier);
  } catch (e) {
    console.error('Interne fout:', e);
    return res.status(500).json({ error: e.message });
  }
}
