document.addEventListener('DOMContentLoaded', () => {

    // Koppel alle UI-elementen
    const genereerButton = document.getElementById('genereerButton');
    const plaatsInput = document.getElementById('plaatsInput');
    const postcodeInput = document.getElementById('postcodeInput');
    const straatInput = document.getElementById('straatInput');
    const huisnummerInput = document.getElementById('huisnummerInput');
    
    const dashboardTegels = document.getElementById('dashboardTegels');
    const actieKnoppenContainer = document.getElementById('actieKnoppenContainer');
    const opslaanButton = document.getElementById('opslaanButton');
    const promptButton = document.getElementById('promptButton');
    
    // Modal elementen
    const modal = document.getElementById('promptModal');
    const modalClose = document.getElementById('modalClose');
    const promptOutput = document.getElementById('promptOutput');
    const kopieerPromptButton = document.getElementById('kopieerPromptButton');

    // Data voor de 5 tegels
    const bronnen = [
        {
            id: 'risques',
            titel: "Risico's (Géorisques)",
            instructie: "Check hier de officiële staatsrisico's (overstroming, bodemverzakking, etc.). Kopieer de belangrijkste risico's en plak ze hieronder.",
            getUrl: (query) => `https://www.georisques.gouv.fr/mes-risques-sur-une-adresse?adresse=${query}`
        },
        {
            id: 'dvf',
            titel: 'Verkoopprijzen (DVF)',
            instructie: 'Bekijk recente verkopen in de buurt. Noteer de meest relevante transacties (prijs, m²) hieronder.',
            getUrl: (query) => `https://app.dvf.etalab.gouv.fr/?search=${query}`
        },
        {
            id: 'cadastre',
            titel: 'Kadastrale Kaart',
            instructie: 'Bekijk de exacte perceelgrenzen. Noteer het perceelnummer (bv. "Sectie A, nummer 123") hieronder.',
            getUrl: (query) => `https://www.cadastre.gouv.fr/scpc/rechercher.do?saisirRecherche=true&libelleVoie=${query}`
        },
        {
            id: 'plu',
            titel: 'Bestemmingsplan (PLU)',
            instructie: 'Deze site opent de kaart. U moet de zoekterm zelf plakken. Zoek de zone (bv. "Zone Ub") en noteer de belangrijkste bouwregels.',
            getUrl: (query) => `https://www.geoportail-urbanisme.gouv.fr/map/`
        },
        {
            id: 'geofoncier',
            titel: 'Landmeters (Géofoncier)',
            instructie: 'Deze site opent de kaart. U moet de zoekterm zelf plakken. Check of er officiële grensafbakeningen (bornages) zijn.',
            getUrl: (query) => `https://public.geofoncier.fr/`
        }
    ];

    // --- HOOFDFUNCTIE: Genereer het Dashboard ---
    const genereerDashboard = () => {
        const plaats = plaatsInput.value.trim();
        if (plaats === "") {
            alert("Plaatsnaam is een verplicht veld.");
            return;
        }

        const queryParts = [
            huisnummerInput.value.trim(),
            straatInput.value.trim(),
            postcodeInput.value.trim(),
            plaats
        ];
        const fullQuery = queryParts.filter(Boolean).join(' ');
        const encodedQuery = encodeURIComponent(fullQuery);

        // Maak dashboard leeg
        dashboardTegels.innerHTML = '';
        
        // Bouw de 5 tegels
        bronnen.forEach(bron => {
            const tegelHtml = `
                <div class="tegel" id="tegel-${bron.id}">
                    <div class="tegel-header">
                        <h3>${bron.titel}</h3>
                    </div>
                    <div class="tegel-body">
                        <p>${bron.instructie}</p>
                        <a href="${bron.getUrl(encodedQuery)}" class="tegel-knop" target="_blank">1. Open ${bron.titel}</a>
                        <label for="notes-${bron.id}">2. Plak hier uw bevindingen:</label>
                        <textarea id="notes-${bron.id}" class="tegel-textarea" placeholder="Kopieer & plak uw notities hier..."></textarea>
                    </div>
                </div>
            `;
            dashboardTegels.innerHTML += tegelHtml;
        });

        // Toon de actieknoppen
        actieKnoppenContainer.style.display = 'flex';

        // Probeer opgeslagen notities te laden
        laadNotities();
    };

    // --- OPSLAAN & LADEN FUNCTIES ---
    const opslaanNotities = () => {
        let notities = {};
        let opgeslagenQuery = [
            huisnummerInput.value.trim(),
            straatInput.value.trim(),
            postcodeInput.value.trim(),
            plaatsInput.value.trim()
        ].filter(Boolean).join(' ');

        // Sla de zoekopdracht op
        notities['zoekopdracht'] = opgeslagenQuery;

        // Sla de inhoud van elke textarea op
        bronnen.forEach(bron => {
            const textarea = document.getElementById(`notes-${bron.id}`);
            if (textarea) {
                notities[bron.id] = textarea.value;
            }
        });

        // Sla op in de browseropslag
        localStorage.setItem('vastgoedDossier', JSON.stringify(notities));
        
        // Geef feedback
        opslaanButton.textContent = '✅ Opgeslagen!';
        setTimeout(() => {
            opslaanButton.textContent = '💾 Notities Opslaan (in browser)';
        }, 2000);
    };

    const laadNotities = () => {
        const opgeslagenData = localStorage.getItem('vastgoedDossier');
        if (opgeslagenData) {
            const notities = JSON.parse(opgeslagenData);
            
            // Vul de textarea's
            bronnen.forEach(bron => {
                const textarea = document.getElementById(`notes-${bron.id}`);
                if (textarea && notities[bron.id]) {
                    textarea.value = notities[bron.id];
                }
            });
        }
    };

    // --- AI-PROMPT & MODAL FUNCTIES ---
    const genereerPrompt = () => {
        const notities = JSON.parse(localStorage.getItem('vastgoedDossier') || '{}');
        const zoekopdracht = notities['zoekopdracht'] || 'Niet opgeslagen';

        let prompt = `Hallo, ik analyseer een woning in Frankrijk en heb een dossier samengesteld. Kun je me helpen deze bevindingen te interpreteren?\n\nAdres/Regio: ${zoekopdracht}\n\n--- SAMENVATTING DOSSIER ---\n\n`;

        bronnen.forEach(bron => {
            const notitie = document.getElementById(`notes-${bron.id}`).value;
            if (notitie) {
                prompt += `[${bron.titel}]\n${notitie}\n\n`;
            }
        });

        prompt += `--- VRAGEN ---\n1. Wat zijn de grootste "red flags" in dit dossier?\n2. Wat betekent dit voor de verzekering (denk aan 'Cat Nat')?\n3. Zijn er verborgen kansen (bijv. in het bestemmingsplan)?\n4. Welke vragen moet ik nu stellen aan de notaris?`;

        // Toon de modal
        promptOutput.value = prompt;
        modal.style.display = 'block';
    };

    const kopieerNaarKlembord = () => {
        promptOutput.select();
        document.execCommand('copy');
        
        // Geef feedback
        kopieerPromptButton.textContent = 'Gekopieerd!';
        setTimeout(() => {
            kopieerPromptButton.textContent = 'Kopieer naar Klembord';
        }, 2000);
    };

    // --- TABBLADEN LOGICA (onveranderd) ---
    window.openTab = (evt, tabName) => {
        var i, tabcontent, tabbuttons;
        tabcontent = document.getElementsByClassName("tab-content");
        for (i = 0; i < tabcontent.length; i++) {
            tabcontent[i].style.display = "none";
        }
        tabbuttons = document.getElementsByClassName("tab-button");
        for (i = 0; i < tabbuttons.length; i++) {
            tabbuttons[i].className = tabbuttons[i].className.replace(" active", "");
        }
        document.getElementById(tabName).style.display = "block";
        evt.currentTarget.className += " active";
    }
    // Open de eerste tab standaard
    document.getElementById("DossierDashboard").style.display = "block";


    // --- KOPPEL ALLE EVENT LISTENERS ---
    genereerButton.addEventListener('click', genereerDashboard);
    opslaanButton.addEventListener('click', opslaanNotities);
    promptButton.addEventListener('click', genereerPrompt);
    
    // Modal sluiten
    modalClose.onclick = () => {
        modal.style.display = "none";
    }
    window.onclick = (event) => {
        if (event.target == modal) {
            modal.style.display = "none";
        }
    }
    kopieerPromptButton.addEventListener('click', kopieerNaarKlembord);

    // Probeer notities te laden bij het opstarten van de pagina
    // (Dit is een goede toevoeging, maar kan ook wachten tot na genereren)
    // laadNotities(); // Kan hier, of in genereerDashboard
});