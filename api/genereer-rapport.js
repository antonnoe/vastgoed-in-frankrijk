// Dit is onze "Hybride Motor" (ES Module Stijl)
// HET DOEL: Alleen automatiseerbare data ophalen.

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

    try {
        // --- STAP A: Adres Standaardiseren (GÉOPLATEFORME - DE SIMPELE METHODE) ---
        
        // DE REPARATIE: Plak alles in één 'q' string. Geen 'type' filters. Geen 'city' filters.
        const queryParts = [huisnummer, straat, postcode, plaats].filter(Boolean).join(' ');
        const adresUrl = `https://geoservices.ign.fr/geocodage/search?q=${encodeURIComponent(queryParts)}&limit=1`;
        
        const adresData = await fetchAPI(adresUrl);
        const gevondenAdres = adresData?.features?.[0];
        
        if (!gevondenAdres) {
            return response.status(404).json({ error: `Adres niet gevonden via Franse API (Géoplateforme). De API kon niets vinden met de zoekterm: "${queryParts}"` });
        }
        
        const [lon, lat] = gevondenAdres.geometry.coordinates;
        const kadasterId = gevondenAdres.properties.cadastral_parcel_id;
        
        automatischDossier.adres = `Gevonden officieel adres: ${gevondenAdres.properties.label}`;

        // --- STAP B: Risico's Ophalen (API Géorisques) ---
        const georisquesUrl = `https://api.georisques.gouv.fr/api/v1/zonages?lat=${lat}&lon=${lon}&radius=10&page=1&page_size=100`;
        const risicoData = await fetchAPI(georisquesUrl);
        if (risicoData?.data?.length > 0) {
             automatischDossier.georisques = JSON.stringify(risicoData.data, null, 2);
        } else {
            automatischDossier.georisques = "Geen directe risico's gevonden in de database.";
        }

        // --- STAP C: Verkopen Ophalen (API DVF) ---
        if (kadasterId) {
            const dvfUrl = `https://api.dvf.etalab.gouv.fr/api/latest/mutations?parcelle_id=${kadasterId}&around=500&limit=5`;
            const dvfData = await fetchAPI(dvfUrl);
            if (dvfData?.mutations?.length > 0) {
                automatischDossier.dvf = JSON.stringify(dvfData.mutations, null, 2);
            } else {
                automatischDossier.dvf = "Geen recente verkopen gevonden op/rond dit perceel.";
            }
        } else {
            automatischDossier.dvf = "Kon DVF niet controleren omdat er geen kadaster ID werd gevonden.";
        }

        // 4. Stuur het AUTOMATISCHE dossier terug naar de "voorkant"
        return response.status(200).json(automatischDossier);

    } catch (error) {
        console.error("Onverwachte fout in API-motor:", error);
        return response.status(500).json({ error: `Interne serverfout: ${error.message}` });
    }
}
