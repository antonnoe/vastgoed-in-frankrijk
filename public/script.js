document.addEventListener('DOMContentLoaded', () => {
    
    // Koppel alle elementen
    const genereerButton = document.getElementById('genereerButton');
    const plaatsInput = document.getElementById('plaatsInput');
    const postcodeInput = document.getElementById('postcodeInput');
    const straatInput = document.getElementById('straatInput');
    const huisnummerInput = document.getElementById('huisnummerInput');
    
    const dashboardTegels = document.getElementById('dashboardTegels');
    const actieKnoppenContainer = document.getElementById('actieKnoppenContainer');
    
    // Knoppen en Modal
    const promptButton = document.getElementById('promptButton');
    const modal = document.getElementById('promptModal');
    const modalClose = document.getElementById('modalClose');
    const promptOutput = document.getElementById('promptOutput');
    const kopieerPromptButton = document.getElementById('kopieerPromptButton');

    // De tekstvakken
    const notesAdres = document.getElementById('notes-adres');
    const notesRisques = document.getElementById('notes-risques');
    const notesDvf = document.getElementById('notes-dvf');
    const notesPlu = document.getElementById('notes-plu');

    // --- STAP 1: Genereer het Automatische Dossier ---
    const genereerDossier = async () => {
        const plaats = plaatsInput.value.trim();
        if (plaats === "") {
            alert("Plaatsnaam is een verplicht veld.");
            return;
        }

        // Toon "Laden..." bericht
        dashboardTegels.style.display = 'grid';
        actieKnoppenContainer.style.display = 'none';
        notesAdres.value = "Bezig met ophalen...";
        notesRisques.value = "Bezig met ophalen...";
        notesDvf.value = "Bezig met ophalen...";
        notesPlu.value = ""; // Maak handmatig veld leeg
        genereerButton.disabled = true;

        try {
            const response = await fetch('/api/genereer-rapport', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    plaats: plaats, 
                    postcode: postcodeInput.value.trim(), 
                    straat: straatInput.value.trim(), 
                    huisnummer: huisnummerInput.value.trim() 
                }),
            });

            if (!response.ok) {
                let errorMsg = `Serverfout: ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMsg = errorData.error || errorMsg;
                } catch (e) {
                    errorMsg = await response.text();
                }
                throw new Error(errorMsg);
            }

            // SUCCES: Vul de automatische velden
            const data = await response.json();
            notesAdres.value = data.adres || "Adres niet gevonden.";
            notesRisques.value = data.georisques || "Risico data niet gevonden.";
            notesDvf.value = data.dvf || "DVF data niet gevonden.";
            
            // Toon de rest van het dashboard
            actieKnoppenContainer.style.display = 'flex';

        } catch (error) {
            // Toon fout in het eerste vak
            notesAdres.value = `Er is een fout opgetreden: ${error.message}`;
            notesRisques.value = "";
            notesDvf.value = "";
        } finally {
            genereerButton.disabled = false;
        }
    };

    // --- STAP 2: Genereer de AI-Prompt ---
    const genereerPrompt = () => {
        const prompt = `
Hallo, ik analyseer een woning in Frankrijk en heb een dossier samengesteld.
Kun je me helpen deze bevindingen te interpreteren?

--- AUTOMATISCH DOSSIER ---

[OFFICIEEL ADRES]
${notesAdres.value}

[RISICO'S (GÉORISQUES)]
${notesRisques.value}

[VERKOOPPRIJZEN (DVF)]
${notesDvf.value}

--- HANDMATIGE NOTITIES ---

[BESTEMMINGSPLAN (PLU)]
${notesPlu.value || "Geen notities ingevoerd."}

--- VRAGEN ---
1. Wat zijn de grootste "red flags" in dit dossier?
2. Wat betekent dit voor de verzekering (denk aan 'Cat Nat')?
3. Zijn er verborgen kansen (bijv. in het bestemmingsplan)?
4. Welke vragen moet ik nu stellen aan de notaris?
        `;

        // Toon de modal
        promptOutput.value = prompt.trim();
        modal.style.display = 'block';
    };

    // --- Event Listeners ---
    genereerButton.addEventListener('click', genereerDossier);
    promptButton.addEventListener('click', genereerPrompt);

    // Modal sluiten
    modalClose.onclick = () => { modal.style.display = "none"; }
    window.onclick = (event) => {
        if (event.target == modal) { modal.style.display = "none"; }
    }
    
    kopieerPromptButton.addEventListener('click', () => {
        promptOutput.select();
        document.execCommand('copy');
    });
});
