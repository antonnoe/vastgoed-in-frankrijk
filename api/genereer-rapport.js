// Dit is onze "server-motor" (Node.js)
// Het importeert de Google AI bibliotheek
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Haal onze ENIGE geheime API-sleutel op (deze stellen we in Vercel in)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Initialiseer de AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Hulpfunctie om externe APIs aan te roepen (zoals de Franse)
async function fetchAPI(url, options = {}) {
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`API call failed: ${response.status} ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Fout bij ophalen ${url}:`, error.message);
        return null; // Geef null terug bij een fout
    }
}

// --- De Hoofdfunctie ---
// Dit is wat Vercel uitvoert bij elke aanvraag
export default async function handler(request, response) {
    // 1. Check of het een POST-verzoek is
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Alleen POST-verzoeken zijn toegestaan' });
    }

    // 2. Controleer of de Gemini API-sleutel is ingesteld in Vercel
    if (!GEMINI_API_KEY) {
        console.error("Gemini API-sleutel ontbreekt!");
        return response.status(500).json({ error: "Serverconfiguratiefout: API-sleutel ontbreekt." });
    }

    // 3. Haal de adresgegevens uit de aanvraag
    const { plaats, postcode, straat, huisnummer } = request.body;
    if (!plaats) {
        return response.status(400).json({ error: 'Plaatsnaam is verplicht' });
    }

    let ruwDossier = {}; // Hier verzamelen we alle data

    try {
        // --- STAP A: Adres Standaardiseren (NIEUWE Géoplateforme API) ---
        const queryParts = [huisnummer, straat, postcode, plaats].filter(Boolean).join(' ');
        // Dit is de nieuwe API-url die GEEN sleutel nodig heeft
        const adresUrl = `https://api.geoplateforme.fr/geocodage/search/?q=${encodeURIComponent(queryParts)}&limit=1`;
        
        const adresData = await fetchAPI(adresUrl);
        const gevondenAdres = adresData?.features?.[0];
        
        if (!gevondenAdres) {
            return response.status(404).json({ error: `Adres niet gevonden via Franse API: ${queryParts}` });
        }
        
        const { coordinates } = gevondenAdres.geometry;
        const [lon, lat] = coordinates;
        // Haal de kadastrale ID op uit de properties
        const kadasterId = gevondenAdres.properties.cadastral_parcel_id; 
        
        ruwDossier.adres = `Gevonden officieel adres: ${gevondenAdres.properties.label}`;
        ruwDossier.kadasterId = kadasterId || "Geen kadaster ID gevonden voor dit adres.";

        // --- STAP B: Risico's Ophalen (API Géorisques) ---
        const georisquesUrl = `https://api.georisques.gouv.fr/api/v1/zonages?lat=${lat}&lon=${lon}&radius=10&page=1&page_size=100`;
        const risicoData = await fetchAPI(georisquesUrl);
        ruwDossier.georisques = risicoData?.data || "Geen directe risico's gevonden.";

        // --- STAP C: Verkopen Ophalen (API DVF) ---
        if (kadasterId) {
            const dvfUrl = `https://api.dvf.etalab.gouv.fr/api/latest/mutations?parcelle_id=${kadasterId}&around=500&limit=5`;
            const dvfData = await fetchAPI(dvfUrl);
            ruwDossier.dvf = dvfData?.mutations || "Geen recente verkopen gevonden op/rond dit perceel.";
        } else {
            ruwDossier.dvf = "Kon DVF niet controleren omdat er geen kadaster ID werd gevonden voor dit adres.";
        }

        // --- STAP D: Stuur alles naar de AI voor Analyse ---
        const prompt = `
            Je bent een expert in Frans vastgoed en adviseert een Nederlandse koper.
            Analyseer het volgende ruwe, technische dossier voor een leek.
            Schrijf een helder, beknopt rapport in het Nederlands.
            Begin met het officiële adres.
            Focus op "Red Flags" en "Kansen".

            RUW DOSSIER:
            ${JSON.stringify(ruwDossier, null, 2)}
        `;

        const result = await model.generateContent(prompt);
        const aiRapport = await result.response.text();

        // 4. Stuur het definitieve rapport terug naar de gebruiker
        return response.status(200).json({ rapport: aiRapport });

    } catch (error) {
        console.error("Onverwachte fout in API-motor:", error);
        return response.status(500).json({ error: `Interne serverfout: ${error.message}` });
    }
}
