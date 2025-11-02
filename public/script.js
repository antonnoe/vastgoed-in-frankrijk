// public/script.js
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

  const aiResult = document.getElementById('aiResult');

  // NIEUW: knoppen in modal
  const makePdfBtn = document.getElementById('makePdfBtn');
  const notarisBriefBtn = document.getElementById('notarisBriefBtn');

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

  // dossier maken
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
        `Advertentie: ${advertUrl}\nGevonden plaats: ${plaats}${postcode ? ' (' + postcode + ')' : ''}\n` +
        `Vraag bij makelaar/notaris: exact adres, références cadastrales, ERP < 6 mnd.\n`;

      notesRisques.value =
        `Controleer risico's voor: ${plaats}\nhttps://www.georisques.gouv.fr/\nAls traag: ERP via notaris.\n`;

      notesDvf.value =
        `Controleer DVF (gemeente):\nhttps://app.dvf.etalab.gouv.fr/?q=${encodeURIComponent(plaats)}\n` +
        `Als traag: https://www.data.gouv.fr → "dvf"\n`;

      if (!notesPlu.value) {
        notesPlu.value =
          `PLU / SUP:\nhttps://www.geoportail-urbanisme.gouv.fr/map/\n` +
          `Noteer zone + servitudes.\n`;
      }

      return;
    }

    // adresmodus
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
      `Controleer DVF voor: ${plaats}\nhttps://app.dvf.etalab.gouv.fr/?q=${encodeURIComponent(plaats)}\n` +
      `Als traag/offline: https://www.data.gouv.fr → "dvf"\n`;

    if (!notesPlu.value) {
      notesPlu.value =
        `PLU / SUP via:\nhttps://www.geoportail-urbanisme.gouv.fr/map/\nNoteer zone + beperkingen.\n`;
    }
  });

  // prompt + send-to-ai
  if (promptButton) {
    promptButton.addEventListener('click', () => {
      const advertUrl = advertLinkInput ? advertLinkInput.value.trim() : '';
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
${advertUrl ? advertUrl : (adresRegel || 'Geen volledig adres')}

[RISICO'S (GÉORISQUES)]
${notesRisques.value || 'Geen notities'}

[VERKOOPPRIJZEN (DVF)]
${notesDvf.value || 'Geen notities'}

[KADASTER / ADRES]
${notesAdres.value || 'Geen kadastrale info.'}

[PLU]
${notesPlu.value || 'Nog niet gecontroleerd.'}
      `.trim();

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
            body: JSON.stringify({ dossier: finalPrompt })
          });

          const data = await resp.json();
          console.log('API response:', data);

          if (!resp.ok) {
            aiResult.textContent = 'API FOUT:\n' + JSON.stringify(data, null, 2);
            promptOutput.value =
              finalPrompt + '\n\n--- API FOUT ---\n' + JSON.stringify(data, null, 2);
          } else {
            const out = data.analysis || JSON.stringify(data, null, 2);
            aiResult.textContent = out;
            promptOutput.value = finalPrompt + '\n\n--- AI-ANALYSE ---\n' + out;
          }
        } catch (err) {
          console.error('JS fetch error:', err);
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

  // NIEUW: placeholders voor PDF en notarisbrief
  if (makePdfBtn) {
    makePdfBtn.addEventListener('click', () => {
      const content = promptOutput.value || '(geen prompt gevonden)';
      alert(
        'PDF-export komt hier.\n\nVoor nu kun je deze tekst plakken in Word/Docs en als PDF bewaren.\n\nLengte: ' +
          content.length +
          ' tekens.'
      );
    });
  }

  if (notarisBriefBtn) {
    notarisBriefBtn.addEventListener('click', () => {
      const dossierTekst = promptOutput.value || '';
      const briefFr = `Objet : Demande de communication du dossier de diagnostic et de l’ERP (moins de 6 mois)

Maître,

Je vous prie de bien vouloir me communiquer, pour le bien concerné, l’ensemble des pièces suivantes :
- ERP (État des Risques et Pollutions) de moins de 6 mois,
- références cadastrales complètes,
- extrait de PLU ou indication de la zone d’urbanisme applicable,
- indication d’éventuelles servitudes d’utilité publique.

Cette demande fait suite à une analyse préalable (outil “Immodiagnostique”) basée sur les seules données publiques (Géorisques, DVF, Géoportail Urbanisme). Elle doit donc être confirmée par vos soins.

Je vous remercie par avance.

Cordialement,`;

      // toon in AI-resultaat, maar niet wijzigbaar in textarea
      aiResult.textContent = briefFr + '\n\n---\n(gegenereerd door Immodiagnostique)';
    });
  }
});
