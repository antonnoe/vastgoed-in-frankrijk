// /public/script.js  v: final-fixed-links

(() => {
  console.log('Immodiagnostique Engine V10 (Links Fixed) Loaded');

  const byId = (id) => document.getElementById(id);
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // --- ELEMENTS ---
  const spinner = byId('progress-spinner');
  const spinnerLabel = byId('spinner-label');
  const pipeline = byId('progress-pipeline');
  const logBox = byId('progress-log');
  
  const btnGenerate = byId('btn-generate');
  const btnCancel = byId('btn-cancel');
  const btnExport = byId('btn-export');

  const resultCard = byId('result');
  const contactCard = byId('contact');
  
  // Result containers
  const keyfactsBox = byId('keyfacts');
  const envBadges = byId('env-badges');
  const envLinks = byId('env-links');
  const actieplanList = byId('actieplan-list');
  const priceCmpBox = byId('price-compare');
  const locationProfileBox = byId('location-profile');

  // Hidden fields (gevuld door Autocomplete)
  const hCity = byId('city');
  const hPostcode = byId('postcode');
  const hStreet = byId('street');
  const hHousenr = byId('housenr');
  const hLat = byId('lat');
  const hLon = byId('lon');

  // --- AUTOCOMPLETE LOGIC ---
  const addressInput = byId("global-address");
  const suggestions = byId("address-suggestions");

  if (addressInput && suggestions) {
    addressInput.addEventListener("input", async () => {
        const q = addressInput.value.trim();
        if (q.length < 3) {
            suggestions.innerHTML = "";
            return;
        }
        try {
            const r = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=5`);
            const data = await r.json();
            
            suggestions.innerHTML = "";
            data.features.forEach(f => {
                const li = document.createElement("li");
                li.textContent = f.properties.label;
                li.addEventListener("click", () => {
                    // Vul zichtbaar veld
                    addressInput.value = f.properties.label;
                    suggestions.innerHTML = "";
                    
                    // Vul verborgen velden
                    hCity.value = f.properties.city;
                    hPostcode.value = f.properties.postcode;
                    hStreet.value = f.properties.street || '';
                    hHousenr.value = f.properties.housenumber || '';
                    hLat.value = f.geometry.coordinates[1]; 
                    hLon.value = f.geometry.coordinates[0];
                });
                suggestions.appendChild(li);
            });
        } catch (e) { console.error("Autocomplete error", e); }
    });

    // Sluit lijst bij klik buiten
    document.addEventListener('click', (e) => {
        if (!addressInput.contains(e.target) && !suggestions.contains(e.target)) {
            suggestions.innerHTML = "";
        }
    });
  }

  // --- UI HELPERS ---
  const ts = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  };

  const setSpinner = (on, label) => {
    if (spinner) spinner.style.visibility = on ? 'visible' : 'hidden';
    // Radar animatie
    const radar = byId('radar');
    if (radar) radar.style.visibility = on ? 'visible' : 'hidden';
    if (spinnerLabel) spinnerLabel.textContent = label || (on ? 'SYSTEEM ACTIEF…' : 'Gereed.');
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
    if (locationProfileBox) {
        locationProfileBox.innerHTML = '';
        locationProfileBox.hidden = true;
    }
    setSpinner(false, 'Wachten op start…');
  };

  // --- FETCH ---
  const getJSON = async (url, init) => {
    try {
      const r = await fetch(url, init);
      const ct = r.headers.get('content-type') || '';
      if (!r.ok) { if (r.status === 404) return null; throw new Error(`HTTP ${r.status}`); }
      if (!ct.includes('application/json')) return null;
      return await r.json();
    } catch (e) { console.error("Fetch error:", url, e); throw e; }
  };

  // --- RENDER ---
  const euro = (n) => Number.isFinite(n) ? n.toLocaleString('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }) : '—';
  const m2 = (n) => Number.isFinite(n) ? `${n.toLocaleString('nl-NL', { maximumFractionDigits: 0 })} m²` : '—';

  const refreshResults = (addressInfo, communeInfo, cPrice, cSurface, cPlot) => {
    if (keyfactsBox) {
      keyfactsBox.innerHTML = '';
      const facts = [
        ['Gekozen Adres', addressInput.value || [addressInfo.postcode, addressInfo.city].join(' ')],
        ['Vraagprijs', cPrice ? `${euro(cPrice)}` : 'Niet gevonden'],
        ['Woonoppervlakte', cSurface ? m2(cSurface) : 'Niet gevonden'],
        ['Perceel', cPlot ? m2(cPlot) : 'Niet in tekst'],
        ['Gemeente', communeInfo?.name],
        ['INSEE', communeInfo?.insee],
        ['DVF Bron', communeInfo?.dvf_note]
      ].filter(r => r[1]);

      facts.forEach(([k, v]) => {
        const row = document.createElement('div');
        row.className = 'fact';
        row.innerHTML = `<span class="k">${k}:</span> <span class="v">${v}</span>`;
        keyfactsBox.appendChild(row);
      });
    }
    setupContactButtons(addressInfo, cPrice);
  };

  const renderEnv = ({ insee, risks, gpu, matchType }) => {
    // 1. Badges
    if (envBadges) {
      let html = '';
      const mapRisk = (key, label) => {
        const val = risks ? risks[key] : null;
        if (val === true) return `<span class="badge badge-danger">⚠️ ${label}</span>`;
        if (val === false) return `<span class="badge badge-success">✓ ${label}</span>`;
        return `<span class="badge" style="opacity:0.6">— ${label}</span>`;
      };
      html += mapRisk('flood', 'Overstroming');
      html += mapRisk('argile', 'Klei/krimp');
      html += mapRisk('seismic', 'Seismisch');
      html += mapRisk('radon', 'Radon');
      html += mapRisk('industrial', 'Industrieel');

      if (gpu && gpu.length > 0) {
        const z = gpu[0];
        const code = z.code || z.type || 'Plan';
        const label = z.label || '';
        const badgeStyle = matchType === 'exact' 
          ? 'background:#e3f2fd; color:#0d47a1; border:1px solid #90caf9;' 
          : 'background:#fff3e0; color:#e65100; border:1px solid #ffcc80;';
        const icon = matchType === 'exact' ? '📍' : '🏙️';
        html += `<span class="badge" style="${badgeStyle}">${icon} PLU: ${code} ${label ? `(${label})` : ''}</span>`;
      } else {
        html += `<span class="badge">🏗️ PLU: Geen digitaal plan</span>`;
      }
      envBadges.innerHTML = html;
    }

    // 2. Externe Links (GECORRIGEERD)
    if (envLinks && insee) {
      const urlGPU = `https://www.geoportail-urbanisme.gouv.fr/recherche?insee=${insee}`;
      const urlGeo = `https://www.georisques.gouv.fr/commune/${insee}`;
      // Explore.data.gouv.fr is een moderne, werkende visualisatie voor DVF per gemeente
      const urlDVF = `https://explore.data.gouv.fr/fr/immobilier?code_commune=${insee}`;

      envLinks.innerHTML = `
        <a href="${urlGPU}" target="_blank" rel="noopener" class="ext-link">🌍 Géoportail</a>
        <a href="${urlGeo}" target="_blank" rel="noopener" class="ext-link">⚠️ Géorisques</a>
        <a href="${urlDVF}" target="_blank" rel="noopener" class="ext-link">💰 DVF Transacties</a>
      `;
    }
  };

  const renderActieplan = (items) => {
    if (!actieplanList) return;
    actieplanList.innerHTML = '';
    (items?.length ? items : ['Geen actiepunten.']).forEach(txt => {
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
      (items?.length ? items : ['Geen punten gevonden']).forEach(txt => {
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

  const renderPriceCompare = (p, s, m) => {
    if (!priceCmpBox) return;
    priceCmpBox.innerHTML = '';
    
    if (!p || !s) {
      priceCmpBox.innerHTML = '<div class="pc-row pc-note">Wacht op prijs/m² data...</div>';
      return;
    }
    
    const askPerM2 = Math.round(p / s);
    let html = `<div class="pc-row"><span class="k">Vraagprijs per m²:</span> <span class="v">${euro(askPerM2)}/m²</span></div>`;
    
    if (m) {
      const deltaPct = ((askPerM2 - m) / m) * 100;
      const dir = deltaPct >= 0 ? 'boven' : 'onder';
      const color = deltaPct > 20 ? 'red' : (deltaPct < -10 ? 'green' : 'orange');
      html += `<div class="pc-row"><span class="k">DVF mediaan (gemeente):</span> <span class="v">${euro(m)}/m²</span></div>`;
      html += `<div class="pc-row"><span class="k">Indicatie:</span> <span class="v" style="color:${color}; font-weight:bold;">${dir} mediaan (${Math.abs(deltaPct).toFixed(0)}%)</span></div>`;
    } else {
      html += '<div class="pc-row pc-note">Geen DVF-mediaan op gemeenteniveau beschikbaar.</div>';
    }
    priceCmpBox.innerHTML = html;
  };

  const setupContactButtons = (addr, price) => {
    const container = byId('contact');
    if (!container) return;
    const btns = container.querySelectorAll('button');
    btns.forEach(btn => {
      const btnText = btn.innerText.toLowerCase();
      btn.onclick = null; btn.disabled = false;
      if (btnText.includes('e-mail')) {
        btn.onclick = () => {
          const subject = `Betreft: Woning ${addr.city}`;
          let body = `Geachte,\n\nIk heb interesse in de woning te ${addr.city}.\n`;
          if (price) body += `Vraagprijs: EUR ${price}\n`;
          body += `\nGraag zou ik... (uw vraag hier)\n\nMet vriendelijke groet,`;
          window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        };
      } else if (btnText.includes('bellen')) {
        btn.onclick = () => alert('Zie advertentie voor telefoonnummer.');
      }
    });
  };

  // --- MAIN FLOW ---
  let aborter = null;
  let currentPrice = 0, currentSurface = 0, currentPlot = 0, currentMedian = 0;

  const onGenerate = async () => {
    resetPipeline();
    setSpinner(true, 'Initialiseren…');
    addLog('Systeem start op…');
    
    if(byId('result')) byId('result').hidden = true;
    if(byId('contact')) byId('contact').hidden = true;
    if(btnCancel) btnCancel.hidden = false;
    if(btnExport) btnExport.hidden = true;

    // Inputs
    let city = hCity.value || '';
    let postcode = hPostcode.value || '';
    if (!city && addressInput.value.length > 2) city = addressInput.value;

    const inputPrice = Number(byId('price')?.value);
    const inputSurface = Number(byId('surface')?.value);
    const adText = byId('ad-text')?.value?.trim() || '';
    const advertLink = byId('advert-link')?.value?.trim() || '';

    // GPS (Goudmijn voor GPU)
    const lat = hLat.value;
    const lon = hLon.value;

    currentPrice = inputPrice || 0;
    currentSurface = inputSurface || 0;
    currentPlot = 0;
    currentMedian = 0;

    if (!city && !adText) {
      setSpinner(false, 'Vul adres of tekst in.');
      addLog('❌ Geen invoer.');
      return;
    }

    aborter = new AbortController();

    try {
      // 1. Commune (Startmotor)
      setStep('commune', 'active');
      addLog('Verbinding Insee database…');
      let cUrl = `/api/commune?city=${encodeURIComponent(city)}`;
      if (postcode) cUrl += `&postcode=${encodeURIComponent(postcode)}`;

      const C = await getJSON(cUrl, { signal: aborter.signal });
      if (!C?.ok || !C?.commune?.insee) throw new Error('Gemeente niet gevonden.');
      const com = C.commune;
      
      if (lat && lon) {
         com.lat = lat; com.lon = lon;
         addLog(`✔ Exact adres gelokaliseerd (${lat}, ${lon})`);
      } else {
         addLog('⚠ Gebruik gemeentecentrum (geen exact adres).');
      }
      setStep('commune', 'done', `${com.name} (${com.insee})`);

      // 2. DVF (Waardering Expert Mode)
      setStep('dvf', 'active');
      addLog('Ophalen historische marktprijzen (Cquest)…');
      
      let dvfUrl = `/api/dvf?insee=${com.insee}`;
      // Als we al een surface hebben, stuur mee voor P10/P90
      if (currentSurface > 0) dvfUrl += `&surface=${currentSurface}`;

      const DVF = await getJSON(dvfUrl, { signal: aborter.signal });
      
      currentMedian = (DVF?.summary?.median_eur_m2) ? Number(DVF.summary.median_eur_m2) : 0;
      
      // Log waardering in de console (visuele feedback)
      if (DVF?.valuation) {
         const low = DVF.valuation.range_low.toLocaleString();
         const high = DVF.valuation.range_high.toLocaleString();
         addLog(`💰 Waardering: €${low} - €${high}`);
      }

      setStep('dvf', 'done', currentMedian ? 'Data beschikbaar' : 'Beperkte data');
      addLog('✔ Marktwaarde berekend');

      // 3. Géorisques
      setStep('georisques', 'active');
      addLog('Scannen risico-kaarten (Gaspar)…');
      let riskData = {};
      try {
        const GR = await getJSON(`/api/georisques?insee=${com.insee}`, { signal: aborter.signal });
        if (GR?.ok) riskData = GR.data || {};
        setStep('georisques', 'done');
        addLog('✔ Risico-analyse voltooid');
      } catch (e) { setStep('georisques', 'error'); }

      // 4. GPU (Zonering)
      setStep('gpu', 'active');
      addLog('Raadplegen bestemmingsplannen (IGN)…');
      let gpuData = [];
      let gpuMatch = 'none';
      try {
        let url = `/api/gpu?insee=${com.insee}`;
        if (com.lat && com.lon) url += `&lat=${com.lat}&lon=${com.lon}`;
        const GPU = await getJSON(url, { signal: aborter.signal });
        if (GPU?.ok) {
            gpuData = GPU.zones || [];
            gpuMatch = GPU.match || 'none';
        }
        if (gpuMatch === 'exact') setStep('gpu', 'done', '📍 Exact Perceel');
        else if (gpuMatch === 'commune') setStep('gpu', 'done', '🏙️ Gemeente-plan');
        else setStep('gpu', 'done', 'Geen plan');
        setStep('gpudoc', 'done');
        addLog('✔ Zonering vastgesteld');
      } catch (e) { setStep('gpu', 'error'); }

      // 5. AI Analyse
      setStep('ai', 'active', 'Gemini');
      addLog('Starten neurale analyse advertentie…');
      
      const dossierText = `
        Plaats: ${com.name} (${postcode})
        Adres: ${addressInput.value}
        Vraagprijs: ${currentPrice || '?'}
        Oppervlakte: ${currentSurface || '?'}
        Advertentietekst: ${adText}
        Link: ${advertLink}
      `.trim();

      const signals = {
        price: currentPrice,
        dvf: { median_price: currentMedian, comparables: DVF?.comparables || [] }, // Stuur DVF-comps mee!
        georisques: riskData,
        gpu: gpuData,
        gpuMatch: gpuMatch,
        advertentie: { truncated: adText.length < 50 }
      };

      const AI = await getJSON('/api/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dossier: dossierText, signals }),
        signal: aborter.signal
      });

      if(AI?.ok && AI?.output) {
         setStep('ai', 'done');
         addLog('✔ Rapport gegenereerd');
         const out = AI.output;
         
         // --- AUTO FILL LOGIC ---
         // Als AI cijfers vindt, en we hebben ze nog niet, gebruik ze!
         let recalcNeeded = false;
         
         if (out.extracted) {
            if (!currentPrice && out.extracted.price) {
                currentPrice = out.extracted.price;
                addLog(`💡 AI vond prijs: €${currentPrice}`);
                recalcNeeded = true;
            }
            if (!currentSurface && out.extracted.surface) {
                currentSurface = out.extracted.surface;
                addLog(`💡 AI vond woonopp.: ${currentSurface}m²`);
                recalcNeeded = true;
            }
            if (out.extracted.plot) currentPlot = out.extracted.plot;
         }
         
         // Als we nieuwe meters hebben, herbereken de DVF-vergelijking als die nog niet gedaan was
         if (recalcNeeded && currentSurface > 0 && !DVF?.valuation) {
             // Dit is een 'nice to have': nog een keer DVF roepen met de juiste m2
             // Voor snelheid slaan we dit over en doen we de simpele berekening in renderPriceCompare
         }
         
         renderActieplan(out.actieplan);
         renderSwot(out.swot);
         if (locationProfileBox) {
            locationProfileBox.textContent = out.locatie_profiel || '';
            locationProfileBox.hidden = !out.locatie_profiel;
         }
         
         // Toon Expert Waardering Tekst (als beschikbaar)
         if (out.valuation_report && byId('price-compare')) {
             const reportDiv = document.createElement('div');
             reportDiv.style.marginTop = '15px';
             reportDiv.style.padding = '10px';
             reportDiv.style.backgroundColor = '#fffbe6';
             reportDiv.style.borderLeft = '4px solid #ffe58f';
             reportDiv.style.fontSize = '0.9rem';
             reportDiv.style.whiteSpace = 'pre-line';
             reportDiv.textContent = out.valuation_report;
             byId('price-compare').appendChild(reportDiv);
         }

      } else {
         throw new Error(AI?.error || 'AI mislukt');
      }

      // FINAL RENDER
      refreshResults(
        { city: com.name, postcode: hPostcode.value || com.zip, street: hStreet.value, housenr: hHousenr.value }, 
        { name: com.name, insee: com.insee, dvf_note: DVF?.source === 'cquest' ? 'Cquest Data' : 'Fallback' },
        currentPrice, currentSurface, currentPlot
      );
      
      renderEnv({ insee: com.insee, risks: riskData, gpu: gpuData, matchType: gpuMatch });
      renderPriceCompare(currentPrice, currentSurface, currentMedian);

      setSpinner(false, 'Klaar.');
      if(byId('result')) byId('result').hidden = false;
      if(byId('contact')) byId('contact').hidden = false;
      if(btnExport) btnExport.hidden = false;
      if(btnCancel) btnCancel.hidden = true;

    } catch (err) {
      if (err.name === 'AbortError') return;
      setSpinner(false, 'Fout.');
      addLog(`❌ ${err.message}`);
      setStep('commune', 'error');
    } finally {
      aborter = null;
    }
  };

  const onCancel = () => { if (aborter) aborter.abort(); setSpinner(false, 'Afgebroken.'); };
  const onExport = () => window.print();

  if (btnGenerate) btnGenerate.addEventListener('click', onGenerate);
  if (btnCancel) btnCancel.addEventListener('click', onCancel);
  if (btnExport) btnExport.addEventListener('click', onExport);

})();
