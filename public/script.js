// public/script.js
document.addEventListener('DOMContentLoaded', () => {
  const genereerButton = document.getElementById('genereerButton');

  const plaatsInput = document.getElementById('plaatsInput');
  const postcodeInput = document.getElementById('postcodeInput');
  const straatInput = document.getElementById('straatInput');
  const huisnummerInput = document.getElementById('huisnummerInput');
  const advertLinkInput = document.getElementById('advertLinkInput');
  const advertText = document.getElementById('advertText');

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

  const aiPanel = document.getElementById('aiPanel');
  const aiResult = document.getElementById('aiResult');

  const letterLang = document.getElementById('letterLang');
  const btnNotaris = document.getElementById('btnNotaris');
  const btnMakelaar = document.getElementById('btnMakelaar');
  const btnVerkoper = document.getElementById('btnVerkoper');
  const letterOutput = document.getElementById('letterOutput');

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
      actieKnoppenContainer.style.display = 'grid';

      const adBlock = [
        `Advertentie: ${advertUrl}`,
        `Gevonden plaats: ${plaats}${postcode ? ' (' + postcode + ')' : ''}`,
        `Vraag bij makelaar/notaris: exact adres, références cadastrales, ERP < 6 mnd.`
      ].join('\n');

      const pasted = (advertText?.value || '').trim();
      const pastedLine = pasted ? `\n\nAdvertentietekst (samengevat):\n${pasted.slice(0, 1200)}` : '';

      notesAdres.value = adBlock + pastedLine;

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
    actieKnoppenContainer.style.display = 'grid';

    const line = [huisnummer, straat, postcode, plaats].filter(Boolean).join(' ');
    const pasted = (advertText?.value || '').trim();
    const pastedLine = pasted ? `\n\nAdvertentietekst (samengevat):\n${pasted.slice(0, 1200)}` : '';

    notesAdres.value =
      `Invoer:\n${line}\n(exact perceel later opvragen bij notaris)\n` + pastedLine;

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
        huisnummerInput.value, straatInput.value, postcodeInput.value, plaatsInput.value
      ].filter(Boolean).join(' ');

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
        sendBtn.className = 'primary-cta';
        sendBtn.style.marginTop = '.6rem';
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

          if (!resp.ok) {
            aiPanel.style.display = 'block';
            aiResult.textContent = 'API FOUT:\n' + JSON.stringify(data, null, 2);
          } else {
            const out = data.analysis || JSON.stringify(data, null, 2);
            aiPanel.style.display = 'block';
            aiResult.textContent = out;

            // scroll naar AI panel
            document.getElementById('aiPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        } catch (err) {
          aiPanel.style.display = 'block';
          aiResult.textContent = 'JS FOUT: ' + err.message;
        } finally {
          sendBtn.textContent = '👍 Verstuur naar AI';
          promptModal.style.display = 'none';
        }
      };
    });
  }

  // compose letters
  async function composeLetter(kind, lang) {
    const context = aiResult.textContent?.trim() || '';
    if (!context) {
      letterOutput.value = 'Geen AI-overzicht beschikbaar. Maak eerst het AI-overzicht.';
      return;
    }
    letterOutput.value = 'Bezig met opstellen...';

    try {
      const resp = await fetch('/api/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, lang, context })
      });
      const data = await resp.json();

      if (!resp.ok) {
        letterOutput.value = 'API FOUT:\n' + JSON.stringify(data, null, 2);
      } else {
        letterOutput.value = data.letter || JSON.stringify(data, null, 2);
      }
    } catch (e) {
      letterOutput.value = 'JS FOUT: ' + e.message;
    }
  }

  btnNotaris?.addEventListener('click', () => composeLetter('notaris', 'FR'));
  btnMakelaar?.addEventListener('click', () => composeLetter('makelaar', 'FR'));
  btnVerkoper?.addEventListener('click', () => composeLetter('verkoper', (letterLang?.value || 'NL')));

  // modal sluiten
  modalClose?.addEventListener('click', () => { promptModal.style.display = 'none'; });
  window.addEventListener('click', (e) => { if (e.target === promptModal) promptModal.style.display = 'none'; });

  // kopieer prompt
  kopieerPromptButton?.addEventListener('click', () => {
    promptOutput.select();
    document.execCommand('copy');
    kopieerPromptButton.textContent = 'Gekopieerd!';
    setTimeout(() => (kopieerPromptButton.textContent = 'Kopieer naar klembord'), 1500);
  });
});
