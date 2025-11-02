// Dit is onze "Hybride Motor" (v14 - MET DE VERCEL RUNTIME FIX)
// HET DOEL: Zowel specifieke als gemeentebrede data ophalen.

// DE GOUDEN SLEUTEL: Dwing Vercel om de Node.js motor te gebruiken
export const config = {
  runtime: 'nodejs',
};

// Hulpfunctie om externe APIs aan te roepen
async function fetchAPI(url, options = {}) {
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API call failed: ${response.status} ${response.statusText} - ${errorText}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Fout bij ophalen ${url}:`, error.message);
        return null;
    }
}

// --- De Hoofdfunctie ---
export default async function handler(request, response) {
    // 1. Check of het een POST-verzoek is
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Alleen POST-verzoeken zijn toegestaan' });
    }

    // 2. Haal de adresgegevens uit de aanvraag
    const { plaats, postcode, straat, huisnummer } = request.body;
    if (!plaats) {
        return response.status(400).json({ error: 'Plaatsnaam is verplicht' });
    }

    let automatischDossier = {
        adres: "Niet gevonden",
        georisques: "Niet opgehaald",
        dvf: "Niet opgehaald"
    };
    
    let inseeCode = null;
    let kadasterId = null;
    let lon = null;
    let lat = null;

    try {
        // --- STAP A: Adres Standaardiseren (GÉOPLATEFORME) ---
        const queryParts = [huisnummer, straat, postcode, plaats].filter(Boolean).join(' ');
        let adresUrl = `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(queryParts)}&limit=1`;
        
        const adresData = await fetchAPI(adresUrl);
        const gevondenAdres = adresData?.features?.[0];
        
        if (!gevondenAdres) {
            return response.status(404).json({ error: `Adres niet gevonden via Franse API (Géoplateforme). De API kon niets vinden met de zoekterm: "${queryParts}"` });
        }
        
        // Pak de data die we hebben
        [lon, lat] = gevondenAdres.geometry.coordinates;
        kadasterId = gevondenAdres.properties.cadastral_parcel_id;
        inseeCode = gevondenAdres.properties.citycode; // De gemeente-ID, bv. 62585
        automatischDossier.adres = `Gevonden officieel adres: ${gevondenAdres.properties.label}`;

        // --- STAP A.2: DE ANTI-FRAGIELE FALLBACK ---
        if (!inseeCode) {
            automatischDossier.adres += "\n(Waarschuwing: Specifiek adres gaf geen INSEE code, fallback naar gemeente-zoekopdracht...)";
            const gemeenteQuery = [postcode, plaats].filter(Boolean).join(' ');
            const gemeenteUrl = `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(gemeenteQuery)}&type=municipality&limit=1`;
            
            const gemeenteData = await fetchAPI(gemeenteUrl);
            const gevondenGemeente = gemeenteData?.features?.[0];
            
            if (gevondenGemeente) {
                inseeCode = gevondenGemeente.properties.citycode; // We hebben de INSEE code gered!
            } else {
                 return response.status(404).json({ error: `Adres wel gevonden, but kon de GEMEENTE INSEE code niet vinden voor: "${gemeenteQuery}"` });
            }
        }


        // --- STAP B: Risico's Ophalen (DE "CHATGPT" METHODE) ---
        // We gebruiken de (nu gegarandeerde) INSEE code.
        const georisquesUrl = `https://api.georisques.gouv.fr/api/v1/catnat?code_insee=${inseeCode}&page=1&page_size=10`; // Pak de 10 laatste events
        const risicoData = await fetchAPI(georisquesUrl);
        
        if (risicoData?.data?.length > 0) {
             automatischDossier.georisques = `LET OP: ${risicoData.data.length} natuurramp(en) ('Cat Nat') erkend voor deze gemeente (meest recente bovenaan):\n\n`;
             automatischDossier.georisques += JSON.stringify(risicoData.data, null, 2);
        } else {
            automatischDossier.georisques = "Geen erkende natuurrampen ('Cat Nat') gevonden voor deze gemeente.";
        }

        // --- STAP C: Verkopen Ophalen (DE FALLBACK METHODE) ---
        let dvfData = null;
        if (kadasterId) {
            // Plan A: Zoek op het specifieke perceel
            const dvfPerceelUrl = `https://api.dvf.etalab.gouv.fr/api/latest/mutations?parcelle_id=${kadasterId}&around=500&limit=5`;
            dvfData = await fetchAPI(dvfPerceelUrl);
        }
        
        // Plan B: Als Plan A faalt (geen kadasterId of geen resultaten), zoek in de hele gemeente
        if (!dvfData || !dvfData.mutations || dvfData.mutations.length === 0) {
            automatischDossier.dvf = "Geen verkopen gevonden op het specifieke perceel. Bezig met zoeken in de hele gemeente...\n\n";
            const dvfGemeenteUrl = `https://api.dvf.etalab.gouv.fr/api/latest/stats/commune?code_insee=${inseeCode}`; 
            const dvfStats = await fetchAPI(dvfGemeenteUrl);

            if (dvfStats) {
                 automatischDossier.dvf += "Statistieken voor de gemeente (laatste 24 maanden):\n" + JSON.stringify(dvfStats, null, 2);
            } else {
                 automatischDossier.dvf = "Kon DVF niet controleren (geen kadaster ID) en ook geen statistieken gevonden voor de hele gemeente.";
            }
        } else {
             automatischDossier.dvf = "Verkopen gevonden op/rond het specifieke perceel:\n\n" + JSON.stringify(dvfData.mutations, null, 2);
        }

        // 4. Stuur het AUTOMATISCHE dossier terug naar de "voorkant"
        return response.status(200).json(automatischDossier);

    } catch (error) {
        console.error("Onverwachte fout in API-motor:", error);
        return response.status(500).json({ error: `Interne serverfout: ${error.message}` });
    }
}
