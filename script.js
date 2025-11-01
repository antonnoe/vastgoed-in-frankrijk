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
        // (Bijv. "Châtillon-en-Bazois" wordt "Ch%C3%A2tillon-en-Bazois")
        const encodedQuery = encodeURIComponent(query);

        // 3. Genereer de 5 slimme URL's
        // Deze links zijn specifiek ontworpen om direct naar de zoekresultaten te gaan
        const urls = [
            {
                naam: "Risico's (Géorisques)",
                beschrijving: "Officiële risico's (overstroming, bodem, etc.)",
                url: `https://www.georisques.gouv.fr/mes-risques-sur-une-adresse?search=${encodedQuery}`
            },
            {
                naam: "Verkoopprijzen (DVF)",
                beschrijving: "Recente transacties (wat is er echt betaald?)",
                url: `https://app.dvf.etalab.gouv.fr/?search=${encodedQuery}`
            },
            {
                naam: "Bestemmingsplan (PLU)",
                beschrijving: "Wat mag u bouwen? (Plan Local d'Urbanisme)",
                url: `https://www.geoportail-urbanisme.gouv.fr/recherche/?search=${encodedQuery}`
            },
            {
                naam: "Kadastrale kaart",
                beschrijving: "Officiële perceelkaart (Gemeente/Perceel)",
                url: `https://www.cadastre.gouv.fr/scpc/rechercher.do?saisirRecherche=true&libelleVoie=${encodedQuery}`
            },
            {
                naam: "Landmeters (Géofoncier)",
                beschrijving: "Info over grensafbakening (bornage)",
                url: `https://public.geofoncier.fr/carte?recherche=${encodedQuery}`
            }
        ];

        // 4. Toon de links op de pagina
        linksOutput.innerHTML = ''; // Maak het uitvoerveld leeg
        
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

        // 5. Update de CSS voor de knoppen (dit moet in de <head> of in style.css)
        // We voegen dit hier toe voor de zekerheid, maar het hoort in style.css
        // Zorg dat de volgende CSS in je style.css staat:
        /*
        .link-knop {
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