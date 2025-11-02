// public/script.js
document.addEventListener('DOMContentLoaded', () => {
  const genereerButton = document.getElementById('genereerButton');

  // adres-velden
  const plaatsInput = document.getElementById('plaatsInput');
  const postcodeInput = document.getElementById('postcodeInput');
  const straatInput = document.getElementById('straatInput');
  const huisnummerInput = document.getElementById('huisnummerInput');

  // advertentie-veld
  const advertLinkInput = document.getElementById('advertLinkInput');

  // dashboard
  const dashboardTegels = document.getElementById('dashboardTegels');
  const actieKnoppenContainer = document.getElementById('actieKnoppenContainer');

  // tegels
  const notesAdres = document.getElementById('notes-adres');
  const notesRisques = document.getElementById('notes-risques');
  const notesDvf = document.getElementById('notes-dvf');
  const notesPlu = document.getElementById('notes-plu');

  // prompt / modal
  const promptButton = document.getElementById('promptButton');
  const promptModal = document.getElementById('promptModal');
  const modalClose = document.getElementById('modalClose');
  const promptOutput = document.getElementById('promptOutput');
  const kopieerPromptButton = document.getElementById('kopieerPromptButton');

  function capitalize(word) {
    if (!word) return '';
    return word.charAt(0).toUpperCase() + word.slice(1);
  }

  // stad uit green-acres-URL halen
  function extractCityFromGreenAcres(url) {
    try {
      const u = new URL(url);
      const parts = u.pathname.split('/').filter(Boolean);
      // fr/properties/.../STAD/...
      if (parts.length >= 4) {
        const maybeCity = parts[3];
        return capitalize(maybeCity.replace(/-/g, ' '));
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  // hoofdknop
  genereerButton.addEventListener('click', () => {
    const advertUrl = advertLinkInput ? advertLinkInput.value.trim() : '';
    let plaats = plaatsInput.value.trim();
    const postcode = postcodeInput.value.trim();
    const straat = straatInput.value.trim();
    const huisnummer = huisnummerInput.value.trim();

    // 1) advertentie-modus
    if (advertUrl) {
      if (!plaats) {
        const guessed = extractCityFromGreenAcres(advertUrl);
        if (guessed) {
          plaats = guessed;
          plaatsInput.value = guessed;
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
        `Let op: exact adres wordt door de aanbieder niet vrijgegeven.\n` +
        `Vraag bij makelaar/notaris:\n` +
        `- exact adres\n` +
        `- références cadastrales\n` +
        `- ERP (État des Risques et Pollutions) < 6 maanden\n`;

      notesRisques.value =
        `Controleer risico's voor: ${plaats}\n` +
        `Primair: https://www.georisques.gouv.fr/\n` +
        `Als traag/offline: ERP bij notaris opvragen.\n`;

      notesDvf.value =
        `Controleer DVF (gemeente-niveau) voor: ${plaats}\n` +
        `Primair: https://app.dvf.etalab.gouv.fr/?q=${encodeURIComponent(plaats)}\n` +
        `Als traag/offline: https://www.data.gouv.fr/ → zoek op "dvf"\n` +
        `Zonder exact perceel is dit alleen indicatief.\n`;

      if (!notesPlu.value) {
        notesPlu.value =
          `Controleer PLU / SUP voor: ${plaats}\n` +
          `https://www.geoportail-urbanisme.gouv.fr/map/\n` +
          `Noteer zone (U, AU, A, N) en servitudes d'utilité publique.\n`;
      }

      return;
    }

    // 2) adres-modus
    if (!plaats) {
      alert('Plaatsnaam is verplicht');
      return;
    }

    dashboardTegels.style.display = 'grid';
    actieKnoppenContainer.style.display = 'flex';

    notesAdres.value =
      `Invoer:\n${[huisnummer, straat, postcode, plaats].filter(Boolean).join(' ')}\n` +
      `(genormaliseerde adresbasis, exact perceel later opvragen bij notaris)\n`;

    notesRisques.value =
      `Controleer risico's voor: ${plaats}\n` +
      `Primair: https://www.georisques.gouv.fr/\n` +
      `Als traag/offline: ERP via verkoper/notaris (max 6 mnd).\n`;

    notesDvf.value =
      `Controleer DVF voor: ${plaats}\n` +
      `Primair: https://app.dvf.etalab.gouv.fr/?q=${encodeURIComponent(plaats)}\n` +
      `Als traag/offline: https://www.data.gouv.fr/ → "dvf"\n`;

    if (!notesPlu.value) {
      notesPlu.value =
        `PLU / SUP via:\nhttps://www.geoportail-urbanisme.gouv.fr/map/\n` +
        `Noteer zone + beperkingen.\n`;
    }
  });

  // prompt → modal
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
${advertUrl ? advertUrl : (adresRegel || 'Geen volledig adres bekend')}

[RISICO'S (GÉORISQUES)]
${notesRisques.value || 'Geen notities ingevoerd.'}

[VERKOOPPRIJZEN (DVF)]
${notesDvf.value || 'Geen notities ingevoerd.'}

[KADASTER / ADRES]
${notesAdres.value || 'Geen kadastrale info.'}

[PLU]
${notesPlu.value || 'Nog niet gecontroleerd.'}
      `.trim();

      // strengere prompt
      const finalPrompt = `
Je mag ALLEEN werken met de info hieronder. NIET zelf extra Franse bronnen, telefoonnummers, gemeenten, prijzen, PPR’s of openingstijden verzinnen.

Geef je antwoord ALLEEN in deze 3 blokken:

1. Rode vlaggen (max. 5 bullets)
2. Wat nu regelen (verzekering / ERP / PLU / servitudes)
3. Vragen aan verkoper, notaris en makelaar (3×3 bullets)

Als het exacte adres ontbreekt: zeg dat en verwijs naar ERP < 6 maanden + références cadastrales.

--- DOSSIER ---
${dossier}
      `.trim();

      promptOutput.value = finalPrompt;
      promptModal.style.display = 'block';

      // stuurknop
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
              body: JSON.stringify({ dossier: finalPrompt }),
            });
            const data = await resp.json();
            if (!resp.ok) {
              promptOutput.value =
                finalPrompt + '\n\n--- AI FOUT ---\n' + (data.error || 'Onbekende fout');
            } else {
              promptOutput.value =
                finalPrompt + '\n\n--- AI-ANALYSE ---\n' + (data.analysis || 'Geen antwoord.');
            }
          } catch (e) {
            promptOutput.value = finalPrompt + '\n\n--- AI FOUT ---\n' + e.message;
          } finally {
            sendBtn.textContent = '👍 Verstuur naar AI';
          }
        });
      }
    });
  }

  // modal sluiten
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

  // kopieerknop
  if (kopieerPromptButton) {
    kopieerPromptButton.addEventListener('click', () => {
      promptOutput.select();
      document.execCommand('copy');
      kopieerPromptButton.textContent = 'Gekopieerd!';
      setTimeout(() => (kopieerPromptButton.textContent = 'Kopieer naar Klembord'), 2000);
    });
  }
});
