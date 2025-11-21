// /public/script.js  v: gpu-smart-fallback

(() => {
  // ---------- DOM helpers ----------
  const $ = (sel) => document.querySelector(sel);
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
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
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
    document.querySelectorAll('.pipe-step').forEach(li => li.setAttribute('data-state', 'idle'));
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
      if (r.status === 404) return null;
      throw new Error(`HTTP ${r.status}`);
    }
    if (!ct.includes('application/json')) return null;
    return r.json();
  };

  // ---------- Render helpers ----------
  const euro = (n) => Number.isFinite(n) ? n.toLocaleString('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }) : '—';
  const m2 = (n) => Number.isFinite(n) ? `${n.toLocaleString('nl-NL', { maximumFractionDigits: 0 })} m²` : '—';

  const renderKeyfacts = ({ city, postcode, street, housenr, price, surface, commune }) => {
    if (!keyfactsBox) return;
    keyfactsBox.innerHTML = '';
    const facts = [
      ['Invoer', [postcode, city].filter(Boolean).join(' ') || '—'],
      ['Vraagprijs', Number.isFinite(price) ? `${euro(price)} (facultatief maar aanbevolen)` : null],
      ['Woonoppervlakte', Number.isFinite(surface) ? m2(surface) : null],
      ['Exact perceel', 'later opvragen bij notaris'],
      ['Adres (indien bekend)', [street, housenr].filter(Boolean).join(' ') || '- -'],
      ['Gemeente', commune?.name],
      ['INSEE', commune?.insee],
      ['DVF', commune?.dvf_note]
    ].filter(r => r[1]);

    facts.forEach(([k, v]) => {
      const row = document.createElement('div');
      row.className = 'fact';
      row.innerHTML = `<span class="k">${k}:</span> <span class="v">${v}</span>`;
      keyfactsBox.appendChild(row);
    });
  };

  const renderEnv = ({ insee, risks, gpu, matchType }) => {
    if (envBadges) {
      let html = '';
      
      // 1. Géorisques badges (Strenger kleurbeleid)
      const mapRisk = (key, label) => {
        const val = risks ? risks[key] : null;
        if (val === true) return `<span class="badge badge-danger">⚠️ ${label}</span>`;
        // Bij false tonen we het toch, maar groen (zodat je ziet dat het gecheckt is)
        if (val === false) return `<span class="badge badge-success">✓ ${label}</span>`;
        return `<span class="badge">— ${label}</span>`;
      };
      
      html += mapRisk('flood', 'Overstroming');
      html += mapRisk('argile', 'Klei/krimp');
      html += mapRisk('seismic', 'Seismisch');
      html += mapRisk('radon', 'Radon');
      html += mapRisk('industrial', 'Industrieel');

      // 2. GPU / Zonering badge
      if (gpu && gpu.length > 0) {
        const z = gpu[0]; // Pak de eerste (vaak de enige of belangrijkste)
        const code = z.code || z.type || 'Plan';
        const label = z.label || '';
        
        // Visueel onderscheid: Exact vs Gemeente
        const badgeStyle = matchType === 'exact' 
          ? 'background:#e3f2fd; color:#0d47a1; border:1px solid #90caf9;' // Blauw (Exact)
          : 'background:#fff3e0; color:#e65100; border:1px solid #ffcc80;'; // Oranje (Gemeente-fallback)

        const icon = matchType === 'exact' ? '📍' : '🏙️';
        
        html += `<span class="badge" style="${badgeStyle}">${icon} PLU: ${code} ${label ? `(${label})` : ''}</span>`;
      } else {
        html += `<span class="badge">🏗️ PLU: Geen digitaal plan</span>`;
      }

      envBadges.innerHTML = html;
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

  const renderPriceCompare = ({ price, surface, dvfMedian }) => {
    if (!priceCmpBox) return;
    priceCmpBox.innerHTML = '';
    if (!Number.isFinite(price) || !Number.isFinite(surface) || surface <= 0) {
      priceCmpBox.innerHTML = '<div class="pc-row pc-note">Vul vraagprijs én m² in voor vergelijking.</div>';
      return;
    }
    const askPerM2 = Math.round(price / surface);
    let html = `<div class="pc-row"><span class="k">Vraagprijs per m²:</span> <span class="v">${euro(askPerM2)}/m²</span></div>`;
    
    if (Number.isFinite(dvfMedian)) {
      const deltaPct = ((askPerM2 - dvfMedian) / dvfMedian) * 100;
      const dir = deltaPct >= 0 ? 'boven' : 'onder';
      html += `<div class="pc-row"><span class="k">DVF mediaan (gemeente):</span> <span class="v">${euro(dvfMedian)}/m²</span></div>`;
      html += `<div class="pc-row"><span class="k">Indicatie:</span> <span class="v">${dir} mediaan (${deltaPct.toFixed(0)}%)</span></div>`;
    } else {
      html += '<div class="pc-row pc-note">Geen DVF-mediaan op gemeenteniveau.</div>';
    }
    priceCmpBox.innerHTML = html;
  };

  // ---------- Email Generators (Direct Contact) ----------
  const setupContactButtons = (addressInfo) => {
    const container = byId('contact');
    if (!container) return;

    const btns = container.querySelectorAll('button');
    btns.forEach(btn => {
      const btnText = btn.innerText.toLowerCase();
      btn.onclick = null;
      btn.disabled = false;

      if (btnText.includes('e-mail')) {
        btn.onclick = () => {
          const subject = `Betreft: Woning ${addressInfo.city}`;
          let body = `Geachte,\n\nIk heb interesse in de woning te ${addressInfo.city} (${addressInfo.postcode}).\n`;
          if (addressInfo.price) body += `Vraagprijs: EUR ${addressInfo.price}\n`;
          body += `\nGraag zou ik... (uw vraag hier)\n\nMet vriendelijke groet,`;
          
          window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        };
      } else if (btnText.includes('telefoon')) {
        btn.onclick = () => alert('Telefoonnummer niet gevonden. Raadpleeg de advertentie.');
      }
    });
  };

  // ---------- Main flow ----------
  let aborter = null;

  const onGenerate = async () => {
    resetPipeline();
    setSpinner(true, 'Dossier wordt opgebouwd…');
    addLog('Dossier wordt opgebouwd…');
    
    if(byId('result')) byId('result').hidden = true;
    if(byId('contact')) byId('contact').hidden = true;
    if(btnCancel) btnCancel.hidden = false;
    if(btnExport) btnExport.hidden = true;

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
      // 1. Commune
      setStep('commune', 'active');
      addLog('Raadpleegt gemeente…');
      const C = await getJSON(`/api/commune?city=${city}&postcode=${postcode}`, { signal: aborter.signal });
      if (!C?.ok || !C?.commune?.insee) throw new Error('Geen INSEE gevonden');
      const com = C.commune;
      setStep('commune', 'done', `${com.name} (${com.insee})`);
      addLog('✔ Raadpleegt gemeente…');

      // 2. DVF
      setStep('dvf', 'active');
      addLog('Controleert DVF…');
      const DVF = await getJSON(`/api/dvf?insee=${com.insee}`, { signal: aborter.signal });
      let dvfMedian = (DVF?.source === 'commune' && DVF.summary?.median_eur_m2) ? Number(DVF.summary.median_eur_m2) : null;
      setStep('dvf', 'done', dvfMedian ? 'Mediaan gevonden' : 'Fallback');
      addLog('✔ DVF klaar');

      // 3. Géorisques (Strenge versie wordt aangeroepen door backend)
      setStep('georisques', 'active');
      addLog('Checkt Géorisques…');
      let riskData = {};
      try {
        const GR = await getJSON(`/api/georisques?insee=${com.insee}`, { signal: aborter.signal });
        if (GR?.ok) riskData = GR.data || {};
        setStep('georisques', 'done');
        addLog('✔ Géorisques klaar');
      } catch (e) { setStep('georisques', 'error'); }

      // 4. GPU (Slimme fallback versie)
      setStep('gpu', 'active');
      addLog('Checkt Zonering (GPU)…');
      let gpuData = [];
      let gpuMatch = 'none';
      try {
        // STUUR LAT/LON ÉN INSEE MEE VOOR FALLBACK
        let url = `/api/gpu?insee=${com.insee}`;
        if (com.lat && com.lon) {
           url += `&lat=${com.lat}&lon=${com.lon}`;
        }
        
        const GPU = await getJSON(url, { signal: aborter.signal });
        if (GPU?.ok) {
            gpuData = GPU.zones || [];
            gpuMatch = GPU.match || 'none'; // 'exact', 'commune' of 'none'
        }

        // Logica voor display
        if (gpuMatch === 'exact') {
            setStep('gpu', 'done', '📍 Exacte zone');
        } else if (gpuMatch === 'commune') {
            setStep('gpu', 'done', '🏙️ Gemeente-plan');
        } else {
            setStep('gpu', 'done', 'Geen plan');
        }
        setStep('gpudoc', 'done'); 
        addLog('✔ GPU Zonering klaar');
      } catch (e) { setStep('gpu', 'error'); }

      // 5. AI
      setStep('ai', 'active', 'Gemini');
      addLog('Genereert AI-analyse…');
      
      const dossierText = `
        Plaats: ${com.name} (${postcode})
        Adres: ${street} ${hous
