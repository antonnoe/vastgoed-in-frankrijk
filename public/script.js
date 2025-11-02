// script.js
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

  // prompt
  const promptButton = document.getElementById('promptButton');
  const promptModal = document.getElementById('promptModal');
  const modalClose = document.getElementById('modalClose');
  const promptOutput = document.getElementById('promptOutput');
  const kopieerPromptButton = document.getElementById('kopieerPromptButton');

  // hulpfunctie: eerste letter hoofdletter
  function capitalize(word) {
    if (!word) return '';
    return word.charAt(0).toUpperCase() + word.slice(1);
  }

  // hulpfunctie: stad uit green-acres-URL halen
  function extractCityFromGreenAcres(url) {
    try {
      const u = new URL(url);
      // voorbeeld: /fr/properties/appartement/dijon/Axb1...
      const parts = u.pathname.split('/').filter(Boolean);
      // we zoeken het voorlaatste deel (vaak de stad)
      // fr, properties, appartement, dijon, code
      if (parts.length >= 4) {
        const maybeCity = parts[3]; // 0:fr 1:properties 2:type 3:stad
        return capitalize(maybeCity.replace(/-/g, ' '));
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  // hoofdactie
  genereerButton.addEventListener('click', () => {
    const advertUrl = advertLinkInput ? advertLinkInput.value.trim() : '';
    let plaats = plaatsInput.value.trim();
    const postcode = postcodeInput.value.trim();
    const straat = straatInput.value.trim();
    const huisnummer = huisnummerInput.value.trim();

    // CASE 1: gebruiker werkt met advertentielink
    if (advertUrl) {
      // proberen stad te halen uit de URL
      if (!plaats) {
        const guessedCity = extractCityFromGreenAcres(advertUrl);
        if (guessedCity) {
          plaats = guessedCity;
          plaatsInput.value = guessedCity; // vul het formulier alsnog
        }
      }

      if (!plaats) {
        alert('De advertentie geeft geen plaats vrij. Vul de plaatsnaam even handmatig in.');
        return;
      }

      // dashboard tonen in "gemeente-modus"
      dashboardTegels.style.display = 'grid';
      actieKnoppenContainer.style.display = 'flex';

      notesAdres.value =
        `Advertentie: ${advertUrl}\n` +
        `Gevonden plaats: ${plaats}${postcode ? ' (' + postcode + ')' : ''}\n` +
        `Let op: exact adres wordt door de aanbieder niet vrijgegeven. Vraag bij makelaar/notaris:\n` +
        `- exact adres\n- références cadastrales\n- ERP < 6 maanden\n`;

      notesRisques.value =
        `Open en controleer op: https://www.georisques.gouv.fr/ (zoek op: ${plaats})\n` +
        `Als site traag is: vraag ERP aan verkoper/notaris.`;

      notesDvf.value =
        `Open DVF voor de gemeente (indicatief): https://app.dvf.etalab.gouv.fr/?q=${encodeURIComponent(plaats)}\n` +
        `Zonder exact perceel is dit alleen een prijsniveau-check.`;

      if (!notesPlu.value) {
        notesPlu.value =
          `PLU online controleren voor: ${plaats}\n` +
          `https://www.geoportail-urbanisme.gouv.fr/map/\n` +
          `Zoek op gemeente, zoom in, noteer zone (Ub, Uc, A, N...).`;
      }

      return;
    }

    // CASE 2: normale adres-invoer
    if (!plaats) {
      alert('Plaatsnaam is verplicht');
      return;
    }

    // hier komt later je echte fetch / Vercel call
    dashboardTegels.style.display = 'grid';
    actieKnoppenContainer.style.display = 'flex';

    notesAdres.value =
      `Invoer:\n${[huisnummer, straat, postcode, plaats].filter(Boolean).join(' ')}\n(dit is de genormaliseerde adresbasis)`;

    notesRisques.value =
      `Controleer risico's voor: ${plaats}\nhttps://www.georisques.gouv.fr/\nAls er niets gevonden wordt: bij notaris ERP opvragen.`;

    notesDvf.value =
      `Controleer verkopen voor: ${plaats}\nhttps://app.dvf.etalab.gouv.fr/?q=${encodeURIComponent(plaats)}\nZonder kadaster-id alleen gemeentelijk niveau.`;

    if (!notesPlu.value) {
      notesPlu.value =
        `Controleer PLU voor: ${plaats}\nhttps://www.geoportail-urbanisme.gouv.fr/map/\nNoteer zone + beperkingen.`;
    }
  });

  // prompt genereren
  if (promptButton) {
    promptButton.addEventListener('click', () => {
      const adresRegel = [
        huisnummerInput.value,
        straatInput.value,
        postcodeInput.value,
        plaatsInput.value,
      ]
        .filter(Boolean)
        .join(' ');

      const advertUrl = advertLinkInput ? advertLinkInput.value.trim() : '';

      const prompt = `
Hallo, ik analyseer een woning in Frankrijk en heb een dossier samengesteld.
Kun je me helpen deze bevindingen te interpreteren?

--- HANDMATIG DOSSIER ---

[ADRES / ADVERTENTIE]
${advertUrl ? advertUrl + '\n' : ''}${adresRegel || 'Geen volledig adres bekend'}

[RISICO'S (GÉORISQUES)]
${notesRisques.value || 'Geen notities ingevoerd.'}

[VERKOOPPRIJZEN (DVF)]
${notesDvf.value || 'Geen notities ingevoerd.'}

[KADASTER]
${notesAdres.value || 'Geen kadastrale info.'}

[BESTEMMINGSPLAN (PLU)]
${notesPlu.value || 'Nog niet gecontroleerd.'}

--- VRAGEN ---
1. Wat zijn de grootste "red flags" in dit dossier?
2. Wat betekent dit voor de verzekering (denk aan 'Cat Nat')?
3. Zijn er verborgen kansen (bijv. in het bestemmingsplan)?
4. Welke vragen moet ik nu stellen aan de notaris?
      `.trim();

      promptOutput.value = prompt;
      promptModal.style.display = 'block';
    });
  }

  // modal acties
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
