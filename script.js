// Wacht tot de pagina volledig geladen is
document.addEventListener('DOMContentLoaded', () => {

    // Koppel de elementen aan variabelen
    const genereerButton = document.getElementById('genereerButton');
    const adresInput = document.getElementById('adresInput');
    const linksOutput = document.getElementById('linksOutput');

    // Functie die wordt uitgevoerd als op de knop wordt geklikt
    const genereerLinks = () => {
        // 1. Haal de ingevoerde tekst op en verwijder witruimte
        const query = adresInput.value.trim();

        if (query === "") {
            linksOutput.innerHTML = '<p class="placeholder-text">Voer alstublieft een adres of gemeentenaam in.</p>';
            return;
        }

        // 2. Maak de zoekterm URL-vriendelijk
        const encodedQuery = encodeURIComponent(query);
        // Voor Géoportail Urbanisme: we sturen de gebruiker naar de kaart
        // en ze moeten zelf plakken.
        const encodedForClipboard = query.replace(/"/g, '\\"');

        // 3. Genereer de 5 slimme URL's (NU GECORRIGEERD)
        const urls = [
            {
                naam: "Risico's (Géorisques) - WERKT",
                beschrijving: "Officiële risico's (overstroming, bodem, etc.)",
                url: `https://www.georisques.gouv.fr/risques?query=${encodedQuery}`
            },
            {
                naam: "Verkoopprijzen (DVF) - WERKT",
                beschrijving: "Recente transacties (wat is er echt betaald?)",
                url: `https://app.dvf.etalab.gouv.fr/?search=${encodedQuery}`
            },
            {
                naam: "Kadastrale kaart - WERKT",
                beschrijving: "Officiële perceelkaart (Gemeente/Perceel)",
                url: `https://www.cadastre.gouv.fr/scpc/rechercher.do?saisirRecherche=true&libelleVoie=${encodedQuery}`
            },
            {
                naam: "Bestemmingsplan (PLU)",
                beschrijving: "Opent kaart. U moet de zoekterm zelf plakken.",
                url: `https://www.geoportail-urbanisme.gouv.fr/map/`
            },
            {
                naam: "Landmeters (Géofoncier)",
                beschrijving: "Opent kaart. U moet de zoekterm zelf plakken.",
                url: `https://public.geofoncier.fr/`
            }
        ];

        // 4. Toon de links op de pagina
        linksOutput.innerHTML = ''; // Maak het uitvoerveld leeg
        
        // Instructie voor de 'plak'-links
        linksOutput.innerHTML += `<p class="placeholder-text">Voor 2 links moet u zelf plakken: <strong>${query}</strong></p>`;

        urls.forEach(link => {
            // Maak de HTML voor elke knop
            const linkHtml = `
                <a href="${link.url}" class="link-knop" target="_blank">
                    <strong>${link.naam}</strong>
                    <span>${link.beschrijving}</span>
                    <span class="pijl">&rarr;</span>
                </a>
            `;
            linksOutput.innerHTML += linkHtml;
        });
        
        // Zorg dat deze CSS-regels in je style.css staan!
        /* .link-knop {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background-color: #f9f9f9;
            border: 1px solid #ddd;
            padding: 15px 20px;
            margin-bottom: 10px;
            border-radius: 5px;
            text-decoration: none;
            color: #333;
            transition: all 0.3s;
        }
        .link-knop:hover {
            background-color: #f1f1f1;
            border-color: #004a99;
            transform: translateY(-2px);
            box-shadow: 0 4px 10px rgba(0,0,0,0.05);
        }
        .link-knop strong {
            color: #004a99;
            font-size: 1.1em;
        }
        .link-knop span {
            font-size: 0.9em;
            color: #555;
        }
        .link-knop .pijl {
            font-size: 1.5em;
            color: #004a99;
        }
        .links-container .placeholder-text {
            color: #888;
            text-align: center;
            font-style: italic;
        }
        */
    };

    // Koppel de functie aan de knop
    genereerButton.addEventListener('click', genereerLinks);

    // Voer ook uit als de gebruiker op Enter drukt in het invoerveld
    adresInput.addEventListener('keyup', (event) => {
        if (event.key === 'Enter') {
            genereerLinks();
        }
    });

});