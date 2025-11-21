// /public/script.js  v: georisques-fix

(() => {
  // ---------- DOM helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const byId = (id) => document.getElementById(id);

  const spinner = byId('progress-spinner');
  const spinnerLabel = byId('spinner-label');
  const pipeline = byId('progress-pipeline');
  const logBox = byId('progress-log');

  const btnGenerate = byId('btn-generate');
  const btnCancel = byId('btn-cancel');
  const btnExport = byId('btn-export');

  const resultCard = byId('result');
  const contactCard = byId('contact');

  // Resultaat boxen
  const keyfactsBox = byId('keyfacts');
  const envBadges = byId('env-badges');
  const envLinks = byId('env-links');
  const actieplanList = byId('actieplan-list');
  const priceCmpBox = byId('price-compare');

  // ---------- UI: pipeline & log ----------
  const ts = () => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  };

  const setSpinner = (on, label) => {
    if (spinner) spinner.style.visibility = on ? 'visible' : 'hidden';
    if (spinnerLabel) spinnerLabel.textContent = label || (on ? 'Bezig…' : 'Klaar.');
  };

  const setStep = (step, state, meta = '') => {
    const li = pipeline ? pipeline.querySelector(`.pipe-step[data-step="${step}"]`) : null;
    if (!li) return;
    li.setAttribute('data-state', state);
    const metaEl = byId(`step-${step}-meta`);
    if (metaEl) metaEl.textContent = meta;
  };

  const addLog = (text) => {
    if (!logBox) return;
    const line = document.createElement('div');
    line.className = 'log-line';
    line.textContent = `${ts()} · ${text}`;
    logBox.appendChild(line);
    logBox.scrollTop = logBox.scrollHeight;
  };

  const resetPipeline = () => {
    if (!pipeline) return;
    $$('.pipe-step').forEach(li => li.setAttribute('data-state', 'idle'));
    ['commune','gpu','gpudoc','dvf','georisques','ai'].forEach(s => {
      const m = byId(`step-${s}-meta`);
      if (m) m.textContent = '';
    });
    if (logBox) logBox.innerHTML = '';
    setSpinner(false, 'Wachten op start…');
  };

  // ---------- Fetch helpers ----------
  const getJSON = async (url, init) => {
    const r = await fetch(url, init);
    const ct = r.headers.get('content-type') || '';
    if (!r.ok) {
      // Probeer de foutmelding te lezen, maar faal niet hard als het HTML is
      const text = await r.text().catch(()=>'');
      // Als het een 404 is op een optionele API, return null (handled in logic)
      if (r.status === 404) return null; 
      throw new Error(`HTTP ${r.status} @ ${url}`);
    }
    if (!ct.includes('application/json')) {
      // Soms stuurt Vercel HTML bij errors
      return null;
    }
    return r.json();
  };

  // ---------- Render helpers ----------
  const euro = (n) => {
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  };
  const m2 = (n) => {
    if (!Number.isFinite(n)) return '—';
    return `${n.toLocaleString('nl-NL', { maximumFractionDigits: 0 })} m²`;
  };

  const renderKeyfacts = ({ city, postcode, street, housenr, price, surface, commune }) => {
    if (!keyfactsBox) return;
    keyfactsBox.innerHTML = '';
    const facts = [];

    const inp = [postcode, city].filter(Boolean).join(' ');
    facts.push(['Invoer', inp || '—']);
    if (Number.isFinite(price)) facts.push(['Vraagprijs', `${euro(price)} (facultatief maar aanbevolen)`]);
    if (Number.isFinite(surface)) facts.push(['Woonoppervlakte', m2(surface)]);
    facts.push(['Exact perceel', 'later opvragen bij notaris']);
    if (street || housenr) facts.push(['Adres (indien bekend)', [street, housenr].filter(Boolean).join(' ') || '—']);
    if (commune?.name) facts.push(['Gemeente', commune.name]);
    if (commune?.insee) facts.push(['INSEE', commune.insee]);
    if (commune?.dvf_note) facts.push(['DVF', commune.dvf_note]);

    for (const [k, v] of facts) {
      const row = document.createElement('div');
      row.className = 'fact';
      row.innerHTML = `<span class="k">${k}:</span> <span class="v">${v}</span>`;
      keyfactsBox.appendChild(row);
    }
  };

  // NIEUW: Badges worden nu dynamisch gekleurd
  const renderEnv = ({ insee, risks }) => {
    if (envBadges) {
      // Default lijstje, we checken 'risks' object om te zien of ze true/false zijn
      // Verwacht risks structuur: { flood: true, seismic: false, ... } of vergelijkbaar
      
      const mapRisk = (key, label) => {
        const val = risks ? risks[key] : null; 
        let className = 'badge';
        let icon = '—';
        
        if (val === true || val === 'high') {
          className += ' badge-danger'; // Rood
          icon = '⚠️';
        } else if (val === false || val === 'low') {
          className += ' badge-success'; // Groen (optioneel)
          icon = '✓';
        }
        return `<span class="${className}">${icon} ${label}</span>`;
      };

      // Mappings op basis van wat api/georisques.js waarschijnlijk teruggeeft
      envBadges.innerHTML = `
        ${mapRisk('flood', 'Overstroming')}
        ${mapRisk('argile', 'Klei/krimp')}
        ${mapRisk('seismic', 'Seismisch')}
        ${mapRisk('radon', 'Radon')}
        ${mapRisk('industrial', 'Industrieel')}
      `;
    }

    if (envLinks) {
      const gpul = insee ? `https://www.geoportail-urbanisme.gouv.fr/recherche?insee=${insee}` : null;
      const grl  = insee ? `https://www.georisques.gouv.fr/commune/${insee}` : null;
      const dvf  = `https://app.dvf.etalab.gouv.fr/`;
      envLinks.innerHTML = `
        ${gpul ? `<a href="${gpul}" target="_blank" rel="noopener">Géoportail Urbanisme</a>` : ''}
        ${grl ? `<a href="${grl}" target="_blank" rel="noopener">Géorisques – gemeente</a>` : ''}
        <a href="${dvf}" target="_blank" rel="noopener">DVF – Etalab</a>
      `;
    }
  };

  const renderActieplan = (planItems) => {
    if (!actieplanList) return;
    actieplanList.innerHTML = '';
    const items = (planItems && planItems.length > 0) ? planItems : ['Geen actiepunten gegenereerd.'];
    items.forEach(txt => {
      const li = document.createElement('li');
      li.textContent = txt;
      actieplanList.appendChild(li);
    });
  };

  const renderSwot = (swot) => {
    const fill = (id, items) => {
      const ul = byId(id);
      if (!ul) return;
      ul.innerHTML = '';
      if (!items || items.length === 0) {
        ul.innerHTML = '<li><i>Geen punten gevonden</i></li>';
        return;
      }
      items.forEach(txt => {
        const li = document.createElement('li');
        li.textContent = txt;
        ul.appendChild(li);
      });
    };
    
    if (swot) {
      fill('list-sterke-punten', swot.sterke_punten);
      fill('list-mogelijke-zorgpunten', swot.mogelijke_zorgpunten);
      fill('list-mogelijke-kansen', swot.mogelijke_kansen);
      fill('list-mogelijke-bedreigingen', swot.mogelijke_bedreigingen);
    }
  };

  const renderPriceCompare = ({ price, surface, dvfMedian }) => {
    if (!priceCmpBox) return;
    priceCmpBox.innerHTML = '';
    if (!Number.isFinite(price) || !Number.isFinite(surface) || surface <= 0) {
      const note = document.createElement('div');
      note.className = 'pc-row pc-note';
      note.textContent = 'Vul vraagprijs én woonoppervlakte in om m²-vergelijking te tonen.';
      priceCmpBox.appendChild(note);
      if (Number.isFinite(dvfMedian)) {
        const row = document.createElement('div');
        row.className = 'pc-row';
        row.innerHTML = `<span class="k">DVF mediaan (gemeente):</span> <span class="v">${euro(dvfMedian)}/m²</span>`;
        priceCmpBox.appendChild(row);
      }
      return;
    }
    const askPerM2 = Math.round(price / surface);
    const r1 = document.createElement('div');
    r1.className = 'pc-row';
    r1.innerHTML = `<span class="k">Vraagprijs per m²:</span> <span class="v">${euro(askPerM2)}/m²</span>`;
    priceCmpBox.appendChild(r1);

    if (Number.isFinite(dvfMedian)) {
      const r2 = document.createElement('div');
      r2.className = 'pc-row';
      r2.innerHTML = `<span class="k">DVF mediaan (gemeente):</span> <span class="v">${euro(dvfMedian)}/m²</span>`;
      priceCmpBox.appendChild(r2);
      const deltaPct = ((askPerM2 - dvfMedian) / dvfMedian) * 100;
      const r3 = document.createElement('div');
      r3.className = 'pc-row';
      const dir = deltaPct >= 0 ? 'boven' : 'onder';
      r3.innerHTML = `<span class="k">Indicatie:</span> <span class="v">${dir} mediaan (${deltaPct.toFixed(0)}%)</span>`;
      priceCmpBox.appendChild(r3);
    } else {
      const r2 = document.createElement('div');
      r2.className = 'pc-row pc-note';
      r2.textContent = 'Geen DVF-mediaan op gemeenteniveau; gebruik departementsbestanden.';
      priceCmpBox.appendChild(r2);
    }
  };

  const reveal = (el) => { if (el) el.hidden = false; };
  const hide = (el) => { if (el) el.hidden = true; };

  // ---------- Main flow ----------
  let aborter = null;

  const onGenerate = async () => {
    resetPipeline();
    setSpinner(true, 'Dossier wordt opgebouwd…');
    addLog('Dossier wordt opgebouwd…');

    reveal(btnCancel);
    hide(btnExport);
    hide(contactCard);
    hide(resultCard);

    const city = byId('city')?.value?.trim() || '';
    const postcode = byId('postcode')?.value?.trim() || '';
    const street = byId('street')?.value?.trim() || '';
    const housenr = byId('housenr')?.value?.trim() || '';
    const price = Number(byId('price')?.value);
    const surface = Number(byId('surface')?.value);
    const adText = byId('ad-text')?.value?.trim() || '';
    const advertLink = byId('advert-link')?.value?.trim() || '';

    if (!city) {
      setSpinner(false, 'Vul minimaal de plaatsnaam in.');
      addLog('❌ Plaatsnaam ontbreekt.');
      return;
    }

    aborter = new AbortController();

    try {
      // Step 1: Commune
      setStep('commune', 'active');
      addLog('Raadpleegt gemeente…');
      const q = new URLSearchParams();
      q.set('city', city);
      if (postcode) q.set('postcode', postcode);
      
      const C = await getJSON(`/api/commune?${q.toString()}`, { signal: aborter.signal });
      if (!C?.ok || !C?.commune?.insee) throw new Error('Geen INSEE gevonden');
      const com = C.commune;
      setStep('commune', 'done', `${com.name} (INSEE ${com.insee})`);
      addLog('✔ Raadpleegt gemeente…');

      // Step 2: DVF
      setStep('dvf', 'active');
      addLog('Controleert DVF (verkoopprijzen)…');
      const DVF = await getJSON(`/api/dvf?insee=${encodeURIComponent(com.insee)}`, { signal: aborter.signal });
      let dvfMedian = null;
      if (DVF?.ok) {
        if (DVF.source === 'commune' && DVF.summary?.median_eur_m2) {
          dvfMedian = Number(DVF.summary.median_eur_m2);
          setStep('dvf', 'done', 'gemeente-mediaan');
        } else {
          setStep('dvf', 'done', 'departement-fallback');
        }
      } else {
        setStep('dvf', 'error', 'fout bij DVF');
      }
      addLog('✔ DVF opgehaald');

      // Step 3: Géorisques (NU TOEGEVOEGD!)
      setStep('georisques', 'active');
      addLog('Checkt Géorisques (risico’s)…');
      let riskData = {};
      try {
        const GR = await getJSON(`/api/georisques?insee=${encodeURIComponent(com.insee)}`, { signal: aborter.signal });
        if (GR && GR.ok) {
            riskData = GR.data || {};
            setStep('georisques', 'done', 'Data opgehaald');
            addLog('✔ Risico-data ontvangen');
        } else {
            setStep('georisques', 'done', 'Geen details');
            addLog('⚠ Geen Géorisques data');
        }
      } catch (e) {
        setStep('georisques', 'error');
        addLog('⚠ Fout bij Géorisques');
      }

      setStep('gpu', 'done', 'bekijk link in Omgevingsdossier');
      setStep('gpudoc', 'done', 'bekijk link in Omgevingsdossier');

      // Step 4: AI
      setStep('ai', 'active', 'gemini-2.0-flash');
      addLog('Genereert AI-analyse (dit duurt even)…');
      
      const dossierText = `
        Plaats: ${com.name} (${postcode})
        Adres: ${street} ${housenr}
        Vraagprijs: ${price || '?'}
        Oppervlakte: ${surface || '?'}
        Advertentietekst: ${adText}
        Link: ${advertLink}
      `.trim();

      const signals = {
        price: price,
        dvf: { median_price: dvfMedian },
        // Hier sturen we nu de echte risico-data mee naar Gemini:
        georisques: riskData, 
        advertentie: {
          keywords: [],
          truncated: adText.length < 50
        }
      };

      const AI = await getJSON('/api/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dossier: dossierText, signals: signals }),
        signal: aborter.signal
      });

      if(AI?.ok && AI?.output) {
         setStep('ai', 'done');
         addLog('✔ Analyse gereed');
         
         const out = AI.output;
         renderActieplan(out.actieplan);
         renderSwot(out.swot);
      } else {
         throw new Error(AI?.error || 'AI analyse mislukt');
      }

      // Render Results
      renderKeyfacts({
        city, postcode, street, housenr,
        price: Number.isFinite(price) ? price : undefined,
        surface: Number.isFinite(surface) ? surface : undefined,
        commune: {
          name: com.name, insee: com.insee,
          dvf_note: DVF?.source === 'commune' ? 'DVF status: gemeente-mediaan beschikbaar.' : `DVF status: fallback op departement.`
        }
      });
      
      // Geef de riskData mee aan renderEnv voor de kleurtjes
      renderEnv({ insee: com.insee, lat: com.lat, lon: com.lon, risks: riskData });
      
      renderPriceCompare({
        price: Number.isFinite(price) ? price : NaN,
        surface: Number.isFinite(surface) ? surface : NaN,
        dvfMedian: Number.isFinite(dvfMedian) ? dvfMedian : NaN
      });

      setSpinner(false, 'Klaar.');
      reveal(resultCard);
      reveal(contactCard);
      reveal(btnExport);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setSpinner(false, 'Fout.');
      addLog(`❌ ${err.message || err}`);
      setStep('commune', 'error');
    } finally {
      aborter = null;
    }
  };

  const onCancel = () => {
    if (aborter) aborter.abort('user-cancel');
    setSpinner(false, 'Afgebroken.');
    addLog('⏹ Afgebroken.');
    aborter = null;
  };
  const onExport = () => window.print();

  // ---------- Wire up ----------
  if (btnGenerate) btnGenerate.addEventListener('click', onGenerate);
  if (btnCancel) btnCancel.addEventListener('click', onCancel);
  if (btnExport) btnExport.addEventListener('click', onExport);

  // Init
  setSpinner(false, 'Wachten op start…');
})();
