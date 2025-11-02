// public/script.js
document.addEventListener('DOMContentLoaded', () => {
  const genereerButton = document.getElementById('genereerButton');

  const plaatsInput = document.getElementById('plaatsInput');
  const postcodeInput = document.getElementById('postcodeInput');
  const straatInput = document.getElementById('straatInput');
  const huisnummerInput = document.getElementById('huisnummerInput');
  const advertLinkInput = document.getElementById('advertLinkInput');
  const advertTextInput = document.getElementById('advertTextInput');

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

  const aiResult = document.getElementById('aiResult');
  const needBtn = document.getElementById('showNeed');
  const niceBtn = document.getElementById('showNice');

  let lastAIText = '';
  let lastSources = [];

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

    if (advertUrl) {
      if (!plaats) {
        const guessed = extractCityFromGreenAcres(advertUrl);
        if (guessed) {
          plaats = guessed;
          plaatsInput.value = guessed;
        }
      }
      if (!plaats) {
        alert('Vul even de plaatsnaam in.');
        return;
      }

      dashboardTegels.style.display = 'grid';
      actieKnoppenContainer.style.display = 'flex';

      notesAdres.value =
        `Advertentie: ${advertUrl}\nGevonden plaats: ${plaats}${
          postcode ? ' (' + postcode + ')' : ''
        }\n` + `Vraag bij makelaar/notaris: exact adres, références cadastrales, ERP < 6 mnd.\n`;

      notesRisques.value =
        `Controleer risico's voor: ${plaats}\nhttps://www.georisques.gouv.fr/\nAls traag: ERP via notaris.\n`;

      notesDvf.value =
        `Controleer DVF (gemeente):\nhttps://app.dvf.etalab.gouv.fr/?q=${encodeURIComponent(
          plaats
        )}\n` + `Als traag: https://www.data.gouv.fr → "dvf"\n`;

      if (!notesPlu.value) {
        notesPlu.value =
          `PLU / SUP:\nhttps://www.geoportail-urbanisme.gouv.fr/map/\n` +
          `Noteer zone + servitudes.\n`;
      }

      return;
    }

    if (!plaats) {
      alert('Plaatsnaam is verplicht');
      return;
    }

    dashboardTegels.style.display = 'grid';
    actieKnoppenContainer.style.display = 'flex';

    notesAdres.value =
      `Invoer:\n${[huisnummer, straat, postcode, plaats].filter(Boolean).join(' ')}\n` +
      `(exact perceel later opvragen bij notaris)\n`;

    notesRisques.value =
      `Controleer risico's voor: ${plaats}\nhttps://www.georisques.gouv.fr/\nAls traag/offline: ERP bij notaris.\n`;

    notesDvf.value =
      `Controleer DVF voor: ${plaats}\nhttps://app.dvf.etalab.gouv.fr/?q=${encodeURIComponent(
        plaats
      )}\n` + `Als traag/offline: https://www.data.gouv.fr → "dvf"\n`;

    if (!notesPlu.value) {
      notesPlu.value =
        `PLU / SUP via:\nhttps://www.geoportail-urbanisme.gouv.fr/map/\nNoteer zone + beperkingen.\n`;
    }
  });

  if (promptButton) {
    promptButton.addEventListener('click', () => {
      const advertUrl = advertLinkInput ? advertLinkInput.value.trim() : '';
      const advertText = advertTextInput ? advertTextInput.value.trim() : '';
      const adresRegel = [
        huisnummerInput.value,
        straatInput.value,
        postcodeInput.value,
        plaatsInput.value
      ]
        .filter(Boolean)
        .join(' ');

      const dossier = `
[ADRES / ADVERTENTIE]
${advertUrl ? advertUrl : adresRegel || 'Geen volledig adres'}

[RISICO'S (GÉORISQUES)]
${notesRisques.value || 'Geen notities'}

[VERKOOPPRIJZEN (DVF)]
${notesDvf.value || 'Geen notities'}

[KADASTER / ADRES]
${notesAdres.value || 'Geen kadastrale info.'}

[PLU]
${notesPlu.value || 'Nog niet gecontroleerd.'}

[ADVERTENTIE-TEKST (optioneel)]
${advertText || 'Geen advertentietekst geplakt.'}
      `.trim();

      // we laten de modal zien met de ruwe prompt
      promptOutput.value = dossier;
      promptModal.style.display = 'block';

      let sendBtn = document.getElementById('sendToAiButton');
      if (!sendBtn) {
        sendBtn = document.createElement('button');
        sendBtn.id = 'sendToAiButton';
        sendBtn.textContent = '👍 Verstuur naar AI';
        sendBtn.style.marginTop = '0.5rem';
        promptOutput.parentNode.appendChild(sendBtn);
      }

      sendBtn.onclick = async () => {
        sendBtn.textContent = 'Bezig...';
        aiResult.textContent = 'AI wordt aangeroepen...';

        try {
          const resp = await fetch('/api/analyse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dossier })
          });
          const data = await resp.json();

          if (!resp.ok) {
            aiResult.textContent = 'API FOUT:\n' + JSON.stringify(data, null, 2);
            return;
          }

          lastAIText = data.analysis || '';
          lastSources = Array.isArray(data.sources) ? data.sources : [];

          // standaard: toon alles
          aiResult.textContent = lastAIText;
        } catch (err) {
          console.error(err);
          aiResult.textContent = 'JS FOUT: ' + err.message;
        } finally {
          sendBtn.textContent = '👍 Verstuur naar AI';
        }
      };
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

  if (kopieerPromptButton) {
    kopieerPromptButton.addEventListener('click', () => {
      promptOutput.select();
      document.execCommand('copy');
      kopieerPromptButton.textContent = 'Gekopieerd!';
      setTimeout(() => (kopieerPromptButton.textContent = 'Kopieer naar klembord'), 1500);
    });
  }

  // need / nice knoppen
  if (needBtn) {
    needBtn.addEventListener('click', () => {
      if (!lastAIText) return;
      // pak alleen het deel tot OMGEVINGSDOSSIER
      const splitIdx = lastAIText.indexOf('[OMGEVINGSDOSSIER');
      const needPart =
        splitIdx > -1 ? lastAIText.slice(0, splitIdx).trim() : lastAIText.trim();
      aiResult.textContent = needPart;
    });
  }

  if (niceBtn) {
    niceBtn.addEventListener('click', () => {
      if (!lastAIText) return;
      const splitIdx = lastAIText.indexOf('[OMGEVINGSDOSSIER');
      const nicePart =
        splitIdx > -1 ? lastAIText.slice(splitIdx).trim() : '(geen omgevingsdeel)';
      aiResult.textContent = nicePart + '\n\nBronnen:\n' + lastSources.join('\n');
    });
  }
});
