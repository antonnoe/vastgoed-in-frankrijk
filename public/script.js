document.addEventListener('DOMContentLoaded', () => {
    
    // Koppel de elementen
    const genereerButton = document.getElementById('genereerButton');
    const plaatsInput = document.getElementById('plaatsInput');
    const postcodeInput = document.getElementById('postcodeInput');
    const straatInput = document.getElementById('straatInput');
    const huisnummerInput = document.getElementById('huisnummerInput');
    
    const resultaatContainer = document.getElementById('resultaatContainer');
    const rapportOutput = document.getElementById('rapportOutput');

    const genereerRapport = async () => {
        // 1. Haal data op uit de velden
        const plaats = plaatsInput.value.trim();
        const postcode = postcodeInput.value.trim();
        const straat = straatInput.value.trim();
        const huisnummer = huisnummerInput.value.trim();

        if (plaats === "") {
            alert("Plaatsnaam is een verplicht veld.");
            return;
        }

        // 2. Toon "Laden..." bericht
        resultaatContainer.style.display = 'block';
        rapportOutput.innerHTML = 'AI-Rapport wordt gegenereerd... Dit kan 30-60 seconden duren...';
        rapportOutput.classList.add('loading');
        genereerButton.disabled = true;

        try {
            // 3. Stuur aanvraag naar onze *eigen* server-motor (de /api/ file)
            const response = await fetch('/api/genereer-rapport', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ plaats, postcode, straat, huisnummer }),
            });

            // GECORRIGEERDE FOUTAFHANDELING
            if (!response.ok) {
                let errorMsg = `Serverfout: ${response.status}`;
                
                // STAP 1: Lees de body als TEXT (dit kan maar één keer)
                const errorText = await response.text();

                // STAP 2: Probeer de tekst te parsen als JSON
                try {
                    const errorData = JSON.parse(errorText);
                    errorMsg = errorData.error || errorMsg;
                } catch (e) {
                    // Het was geen JSON (waarschijnlijk HTML), gebruik de ruwe tekst
                    // Verwijder HTML-tags voor een schonere foutmelding
                    errorMsg = errorText.replace(/<[^>]*>?/gm, '');
                }
                throw new Error(errorMsg);
            }

            // 4. Ontvang en toon het AI-rapport
            const data = await response.json();
            
            rapportOutput.classList.remove('loading');
            // We gebruiken .textContent om de opmaak (newlines) te behouden
            rapportOutput.textContent = data.rapport;

        } catch (error) {
            // 5. Toon een foutmelding als er iets misgaat
            rapportOutput.classList.remove('loading');
            rapportOutput.textContent = `Er is een fout opgetreden: ${error.message}`;
        } finally {
            genereerButton.disabled = false;
        }
    };

    // Koppel de knop
    genereerButton.addEventListener('click', genereerRapport);
});
