// /public/script.js  v: gpu-connected + email-buttons

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

  // NIEUW: Nu met GPU zones (Bestemmingsplan) en Risico's
  const renderEnv = ({ insee, risks, gpu }) => {
    if (envBadges) {
      let html = '';
      
      // 1. Géorisques badges
      const mapRisk = (key, label) => {
        const val = risks ? risks[key] : null;
        if (val === true) return `<span class="badge badge-danger">⚠️ ${label}</span>`;
        if (val === false) return `<span class="badge badge-success">✓ ${label}</span>`;
        return `<span class="badge">— ${label}</span>`;
      };
      
      html += mapRisk('flood', 'Overstroming');
      html += mapRisk('argile', 'Klei/krimp');
      html += mapRisk('seismic', 'Seismisch');
      html += mapRisk('radon', 'Radon');
      html += mapRisk('industrial', 'Industrieel');

      // 2. GPU / Zonering badge (NIEUW)
      if (gpu && gpu.length > 0) {
        // Pak de eerste zone (vaak de belangrijkste)
        const z = gpu[0];
        const label = z.code || z.type || 'Zone?';
        const desc = z.label || '';
        html += `<span class="badge" style="background:#e3f2fd; color:#0d47a1; border:1px solid #90caf9;">🏗️ PLU: ${label} ${desc ? `(${desc})` : ''}</span>`;
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
    // Zoek alle contact knoppen binnen de #contact sectie
    const container = byId('contact');
    if (!container) return;

    const btns = container.querySelectorAll('button');
    btns.forEach(btn => {
      // Bepaal context uit de DOM structuur (Notaris/Makelaar/Verkoper)
      const roleBlock = btn.closest('.contact-role');
      const roleTitle = roleBlock ? roleBlock.querySelector('h4').textContent.trim() : 'Contact';
      const btnText = btn.innerText.toLowerCase();

      // Reset
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
        btn.onclick = () => alert('Telefoonnummer niet automatisch gevonden. Raadpleeg de advertentie.');
      }
    });
  };

  // ---------- Main flow ----------
  let aborter = null;

  const onGenerate = async () => {
    resetPipeline();
    setSpinner(true, 'Dossier wordt opgebouwd…');
    addLog('Dossier wordt opgebouwd…');
    
    // UI toggle
    if(byId('result')) byId('result').hidden = true;
    if(byId('contact')) byId('contact').hidden = true;
    if(btnCancel) btnCancel.hidden = false;
    if(btnExport) btnExport.hidden = true;

    // Inputs
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

      // 3. Géorisques
      setStep('georisques', 'active');
      addLog('Checkt Géorisques…');
      let riskData = {};
      try {
        const GR = await getJSON(`/api/georisques?insee=${com.insee}`, { signal: aborter.signal });
        if (GR?.ok) riskData = GR.data || {};
        setStep('georisques', 'done');
        addLog('✔ Géorisques klaar');
      } catch (e) { setStep('georisques', 'error'); }

      // 4. GPU (NIEUW: Bestemmingsplan)
      setStep('gpu', 'active');
      addLog('Checkt Zonering (GPU)…');
      let gpuData = [];
      try {
        // We hebben lat/lon nodig. api/commune geeft die meestal terug als .lat/.lon
        if (com.lat && com.lon) {
           const GPU = await getJSON(`/api/gpu?lat=${com.lat}&lon=${com.lon}`, { signal: aborter.signal });
           if (GPU?.ok) gpuData = GPU.zones || [];
        }
        setStep('gpu', 'done', gpuData.length ? `${gpuData.length} zone(s)` : 'Geen plan');
        setStep('gpudoc', 'done'); // slaan we over voor visual
        addLog('✔ GPU Zonering klaar');
      } catch (e) { setStep('gpu', 'error'); }

      // 5. AI
      setStep('ai', 'active', 'Gemini');
      addLog('Genereert AI-analyse…');
      
      const dossierText = `
        Plaats: ${com.name} (${postcode})
        Adres: ${street} ${housenr}
        Vraagprijs: ${price || '?'}
        Oppervlakte: ${surface || '?'}
        Advertentietekst: ${adText}
        Link: ${advertLink}
      `.trim();

      const signals = {
        price,
        dvf: { median_price: dvfMedian },
        georisques: riskData,
        gpu: gpuData, // stuur zones mee naar AI
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
         addLog('✔ Analyse gereed');
         
         const out = AI.output;
         renderActieplan(out.actieplan);
         renderSwot(out.swot);
      } else {
         throw new Error(AI?.error || 'AI mislukt');
      }

      // Render Final
      renderKeyfacts({
        city, postcode, street, housenr, price, surface,
        commune: { name: com.name, insee: com.insee, dvf_note: DVF?.source === 'commune' ? 'Gemeente-data' : 'Departement-fallback' }
      });
      
      // Render Env met GPU data!
      renderEnv({ insee: com.insee, risks: riskData, gpu: gpuData });
      
      renderPriceCompare({ price, surface, dvfMedian });

      // Activeer de knoppen
      setupContactButtons({ city: com.name, postcode: postcode, price: price });

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
