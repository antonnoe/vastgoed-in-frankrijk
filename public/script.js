// public/script.js  (vervang je huidige script.js hiermee)
document.addEventListener('DOMContentLoaded', () => {
  const genereerButton = document.getElementById('genereerButton');

  const plaatsInput = document.getElementById('plaatsInput');
  const postcodeInput = document.getElementById('postcodeInput');
  const straatInput = document.getElementById('straatInput');
  const huisnummerInput = document.getElementById('huisnummerInput');

  const advertLinkInput = document.getElementById('advertLinkInput');

  const dashboardTegels = document.getElementById('dashboardTegels');
  const actieKnoppenContainer = document.getElementById('actieKnoppenContainer');

  const notesAdres = document.getElementById('notes-adres');
  const notesRisques = document.getElementById('notes-risques');
  const notesDvf = document.getElementById('notes-dvf');
  const notesPlu = document.getElementById('notes-plu');

  const promptButton = document.getElementById('promptButton');
  const promptModal = document.getElementById('promptModal');
  const modalClose = document.getElementById('modalClose');
  const promptOutput = document.getElementById('promptOutput');
  const kopieerPromptButton = document.getElementById('kopieerPromptButton');

  function capitalize(word) {
    if (!word) return '';
    return word.charAt(0).toUpperCase() + word.slice(1);
  }

  function extractCityFromGreenAcres(url) {
    try {
      const u = new URL(url);
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 4) {
        const maybeCity = parts[3];
        return capitalize(maybeCity.replace(/-/g, ' '));
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  genereerButton.addEventListener('click', () => {
    const advertUrl = advertLinkInput ? advertLinkInput.value.trim() : '';
    let plaats = plaatsInput.value.trim();
    const postcode = postcodeInput.value.trim();
    const straat = straatInput.value.trim();
    const huisnummer = huisnummerInput.value.trim();

    // advertentie-modus
    if (advertUrl) {
      if (!plaats) {
        const guessedCity = extractCityFromGreenAcres(advertUrl);
        if (guessedCity) {
          plaats = guessedCity;
          plaatsInput.value = guessedCity;
        }
      }

      if (!plaats) {
        alert('De advertentie geeft geen plaats vrij. Vul de plaatsnaam even handmatig in.');
        return;
      }

      dashboardTegels.style.display = 'grid';
      actieKnoppenContainer.style.display = 'flex';

      notesAdres.value =
        `Advertentie: ${advertUrl}\n` +
        `Gevonden plaats: ${plaats}${postcode ? ' (' + postcode + ')' : ''}\n` +
        `Let op: exact adres wordt door de aanbieder niet vrijgegeven. Vraag bij makelaar/notaris:\n` +
        `- exact adres\n- références cadastrales\n- ERP (< 6 maanden)\n`;

      notesRisques.value =
        `Controleer risico's voor: ${plaats}\n` +
        `https://www.georisques.gouv.fr/\n` +
        `Als site traag is: vraag ERP bij notaris.`;

      notesDvf.value =
        `Controleer DVF (gemeente-niveau):\n` +
        `https://app.dvf.etalab.gouv.fr/?q=${encodeURIComponent(plaats)}\n` +
        `Zonder exact perceel alleen indicatief.`;

      if (!notesPlu.value) {
        notesPlu.value =
          `Controleer PLU voor: ${plaats}\n` +
          `https://www.geoportail-urbanisme.gouv.fr/map/\n` +
          `Noteer zone + beperkingen.`;
      }

      return;
    }

    // adres-modus
    if (!plaats) {
      alert('Plaatsnaam is verplicht');
      return;
    }

    dashboardTegels.style.display = 'grid';
    actieKnoppenContainer.style.display = 'flex';

    notesAdres.value =
      `Invoer:\n${[huisnummer, straat, postcode, plaats].filter(Boolean).join(' ')}\n` +
      `(genormaliseerde adresbasis)`;

    notesRisques.value =
      `Controleer risico's voor: ${plaats}\nhttps://www.georisques.gouv.fr/`;

    notesDvf.value =
      `Controleer DVF voor: ${plaats}\nhttps://app.dvf.etalab.gouv.fr/?q=${encodeURIComponent(plaats)}`;

    if (!notesPlu.value) {
      notesPlu.value =
        `PLU via:\nhttps://www.geoportail-urbanisme.gouv.fr/map/\n` +
        `Noteer zone, servitudes d’utilité publique.`;
    }
  });

  if (promptButton) {
    promptButton.addEventListener('click', () => {
      const advertUrl = advertLinkInput ? advertLinkInput.value.trim() : '';
      const adresRegel = [
        huisnummerInput.value,
        straatInput.value,
        postcodeInput.value,
        plaatsInput.value,
      ]
        .filter(Boolean)
        .join(' ');

      const dossier = `
[ADRES / ADVERTENTIE]
${advertUrl ? advertUrl : adresRegel || 'Geen volledig adres bekend'}

[RISICO'S (GÉORISQUES)]
${notesRisques.value || 'Geen notities ingevoerd.'}

[VERKOOPPRIJZEN (DVF)]
${notesDvf.value || 'Geen notities ingevoerd.'}

[KADASTER / ADRES]
${notesAdres.value || 'Geen kadastrale info.'}

[PLU]
${notesPlu.value || 'Nog niet gecontroleerd.'}
      `.trim();

      // laat eerst de prompt zien
      promptOutput.value = dossier;
      promptModal.style.display = 'block';

      // stuurknop toevoegen (1x)
      let sendBtn = document.getElementById('sendToAiButton');
      if (!sendBtn) {
        sendBtn = document.createElement('button');
        sendBtn.id = 'sendToAiButton';
        sendBtn.textContent = '👍 Verstuur naar AI';
        sendBtn.style.marginTop = '0.75rem';
        promptOutput.parentNode.appendChild(sendBtn);

        sendBtn.addEventListener('click', async () => {
          sendBtn.textContent = 'Bezig...';
          try {
            const resp = await fetch('/api/analyse', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dossier }),
            });
            const data = await resp.json();
            if (!resp.ok) {
              promptOutput.value = dossier + '\n\n--- AI FOUT ---\n' + (data.error || 'Onbekende fout');
            } else {
              promptOutput.value =
                dossier + '\n\n--- AI-ANALYSE ---\n' + (data.analysis || 'Geen antwoord.');
            }
          } catch (e) {
            promptOutput.value = dossier + '\n\n--- AI FOUT ---\n' + e.message;
          } finally {
            sendBtn.textContent = '👍 Verstuur naar AI';
          }
        });
      }
    });
  }

  if (modalClose) {
    modalClose.addEventListener('click', () => {
      promptModal.style.display = 'none';
    });
  }

  window.addEventListener('click', (e) => {
    if (e.target === promptModal) {
      promptModal.style.display = 'none';
    }
  });

  if (kopieerPromptButton) {
    kopieerPromptButton.addEventListener('click', () => {
      promptOutput.select();
      document.execCommand('copy');
      kopieerPromptButton.textContent = 'Gekopieerd!';
      setTimeout(() => (kopieerPromptButton.textContent = 'Kopieer naar Klembord'), 2000);
    });
  }
});
