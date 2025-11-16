/* /public/script.js — UI-flow: voortgang, summary→DVF→analyse, rapport render */

(function () {
  // ---- DOM utils ----
  const $ = (sel) => document.querySelector(sel);
  const $all = (sel) => Array.from(document.querySelectorAll(sel));

  // Elements
  const btnGenerate = $('#btn-generate');
  const btnCancel = $('#btn-cancel');
  const btnExport = $('#btn-export');

  const spinner = $('#progress-spinner');
  const spinnerLabel = $('#spinner-label');

  const pipeline = $('#progress-pipeline');
  const logBox = $('#progress-log');

  const resultCard = $('#result');
  const contactCard = $('#contact');

  const keyfacts = $('#keyfacts');
  const envBadges = $('#env-badges');
  const envLinks = $('#env-links');
  const actieplanList = $('#actieplan-list');
  const swSterke = $('#swot-sterke');
  const swZorg = $('#swot-zorg');
  const swKansen = $('#swot-kansen');
  const swBedr = $('#swot-bedreigingen');

  // ---- State & helpers ----
  let aborter = null;

  const STEP_KEYS = ['commune','gpu','gpudoc','dvf','georisques','ai'];

  function resetProgress() {
    // spinner uit en label leeg
    if (spinner) spinner.style.display = 'none';
    if (spinnerLabel) spinnerLabel.textContent = '';

    // pipeline reset
    STEP_KEYS.forEach(k => setStepState(k, 'idle', ''));

    // log leeg
    if (logBox) logBox.innerHTML = '';
  }

  function showSpinner(on, label='Dossier wordt opgebouwd…') {
    if (spinner) spinner.style.display = on ? 'inline-block' : 'none';
    if (spinnerLabel) spinnerLabel.textContent = on ? label : '';
  }

  function setStepState(step, state, metaText) {
    const li = pipeline?.querySelector(`.pipe-step[data-step="${step}"]`);
    if (!li) return;
    li.setAttribute('data-state', state); // idle | active | done | error | skip
    const meta = li.querySelector('.pipe-meta');
    if (meta && metaText != null) meta.textContent = metaText;
  }

  function logProgress(msg) {
    if (!logBox) return;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2,'0');
    const mm = String(now.getMinutes()).padStart(2,'0');
    const ss = String(now.getSeconds()).padStart(2,'0');
    const p = document.createElement('p');
    p.textContent = `${hh}:${mm}:${ss} · ${msg}`;
    logBox.appendChild(p);
    // autoscroll
    logBox.scrollTop = logBox.scrollHeight;
  }

  function cleanAdLink(url) {
    try {
      const u = new URL(url);
      u.search = '';
      u.hash = '';
      return u.toString();
    } catch {
      return url || '';
    }
  }

  function euro(v) {
    if (v == null || v === '') return '—';
    try {
      const n = Number(v);
      if (Number.isFinite(n)) {
        return n.toLocaleString('nl-NL', { style:'currency', currency:'EUR', maximumFractionDigits:0 });
      }
    } catch {}
    return String(v);
  }

  function disableDuringRun(disabled) {
    if (btnGenerate) btnGenerate.disabled = disabled;
    if (btnCancel) btnCancel.hidden = !disabled;
    if (btnExport) btnExport.hidden = true; // pas na rapport tonen
  }

  function collectInput() {
    const city = $('#city')?.value?.trim() || '';
    const postcode = $('#postcode')?.value?.trim() || '';
    const price = $('#price')?.value?.trim() || '';
    const advertLink = $('#advert-link')?.value?.trim() || '';
    const adText = $('#ad-text')?.value?.trim() || '';
    const street = $('#street')?.value?.trim() || '';
    const housenr = $('#housenr')?.value?.trim() || '';

    return { city, postcode, price, advertLink, adText, street, housenr };
  }

  // ---- Render rapport ----
  function renderReport({ input, summary, dvf, analysis }) {
    // Toon result + contact
    if (resultCard) resultCard.hidden = false;
    if (contactCard) contactCard.hidden = false;
    if (btnExport) btnExport.hidden = false;

    // Keyfacts
    if (keyfacts) {
      const facts = [];
      const invoer = [input.postcode, input.city].filter(Boolean).join(' ');
      facts.push(fact('Invoer', invoer || '—'));
      facts.push(fact('Vraagprijs', input.price ? `${euro(input.price)} (facultatief maar aanbevolen)` : '—'));
      facts.push(fact('Exact perceel', 'later opvragen bij notaris'));

      if (input.advertLink) {
        const cleaned = cleanAdLink(input.advertLink);
        const fullBtn = `<button class="link-mini" data-action="copy-full-link" data-url="${input.advertLink}">Kopieer volledige link</button>`;
        facts.push(fact('Advertentielink', `<a href="${cleaned}" target="_blank" rel="noopener">${cleaned}</a> ${fullBtn}`));
      }

      if (summary?.commune?.insee) {
        facts.push(fact('Gemeente', `${summary.commune.name || '—'}`));
        facts.push(fact('INSEE', summary.commune.insee));
        const dep = summary.commune.department;
        if (dep?.code) {
          facts.push(fact('Departement', `${dep.code} ${dep.name ? `(${dep.name})` : ''}`));
        }
      }
      keyfacts.innerHTML = facts.join('');
    }

    // Omgevingsbadges (op basis van summary.georisques.summary[] booleans)
    if (envBadges) {
      envBadges.innerHTML = '';
      const s = summary?.georisques?.summary;
      const items = [
        { key:'flood', label:'Overstroming' },
        { key:'coastal', label:'Kust' },
        { key:'industrial', label:'Industrieel' },
        { key:'seismic', label:'Seismisch' },
        { key:'radon', label:'Radon' },
        { key:'clay', label:'Klei/krimp' },
        { key:'forestfire', label:'Bosbrand' },
      ];
      items.forEach(it => {
        const present = Array.isArray(s) ? !!s.find(x => x.key === it.key && x.present === true) : false;
        const badge = document.createElement('span');
        badge.className = 'badge ' + (present ? 'ok' : 'na');
        badge.textContent = (present ? '✅ ' : '— ') + it.label;
        envBadges.appendChild(badge);
      });
    }

    // Omgevingslinks
    if (envLinks) {
      const links = [];
      const l1 = summary?.gpu?.links?.gpu_site_commune || summary?.gpudoc?.links?.gpu_recherche;
      const l2 = summary?.georisques?.links?.commune || summary?.georisques?.links?.search;
      const l3 = summary?.dvf?.links?.etalab_app;

      if (l1) links.push(linkBox('Géoportail Urbanisme', l1));
      if (l2) links.push(linkBox('Géorisques – gemeente', l2));
      if (l3) links.push(linkBox('DVF – Etalab', l3));
      envLinks.innerHTML = links.join('');
    }

    // Actieplan
    if (actieplanList) {
      actieplanList.innerHTML = '';
      const items = analysis?.actieplan || [];
      (Array.isArray(items) ? items : []).forEach(line => {
        const li = document.createElement('li');
        li.textContent = line.replace(/^•\s*/, '');
        actieplanList.appendChild(li);
      });
    }

    // SWOT
    fillList(swSterke, analysis?.swot?.sterke_punten);
    fillList(swZorg, analysis?.swot?.mogelijke_zorgpunten);
    fillList(swKansen, analysis?.swot?.mogelijke_kansen);
    fillList(swBedr, analysis?.swot?.mogelijke_bedreigingen);

    // event: copy full advert link
    keyfacts?.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.matches && t.matches('[data-action="copy-full-link"]')) {
        const url = t.getAttribute('data-url') || '';
        navigator.clipboard?.writeText(url).then(()=>{
          t.textContent = 'Gekopieerd!';
          setTimeout(()=>{ t.textContent = 'Kopieer volledige link'; }, 1200);
        });
      }
    });
  }

  function fact(k, vHtml) {
    return `<div class="fact"><span class="k">${k}:</span> <span class="v">${vHtml}</span></div>`;
  }
  function linkBox(label, href) {
    return `<a class="env-link" href="${href}" target="_blank" rel="noopener">${label}</a>`;
  }
  function fillList(ul, items) {
    if (!ul) return;
    ul.innerHTML = '';
    const arr = Array.isArray(items) ? items : [];
    if (!arr.length) {
      const li = document.createElement('li');
      li.textContent = '—';
      ul.appendChild(li);
      return;
    }
    arr.forEach(x=>{
      const li = document.createElement('li');
      li.textContent = String(x).replace(/^•\s*/, '');
      ul.appendChild(li);
    });
  }

  // ---- Flow ----
  async function runGenerate() {
    const input = collectInput();
    if (!input.city) {
      alert('Plaatsnaam is verplicht.');
      return;
    }

    // start
    resetProgress();
    disableDuringRun(true);
    showSpinner(true);

    aborter = new AbortController();
    const signal = aborter.signal;

    try {
      // Commune via /api/summary (POST)
      setStepState('commune','active','');
      logProgress('Raadpleegt gemeente…');

      const sumRes = await fetch('/api/summary', {
        method: 'POST',
        headers: { 'content-type':'application/json' },
        body: JSON.stringify({ city: input.city, postcode: input.postcode }),
        signal
      });
      if (!sumRes.ok) {
        const txt = await sumRes.text();
        setStepState('commune','error',`HTTP ${sumRes.status}`);
        throw new Error(`/api/summary → ${txt}`);
      }
      const summary = await sumRes.json();
      setStepState('commune','done','✔');
      logProgress('✔ Raadpleegt gemeente…');

      // GPU/gpudoc/georisques: we tonen als “skip” wanneer geen INSEE
      const hasInsee = !!summary?.commune?.insee;
      if (!hasInsee) {
        setStepState('gpu','skip','Geen INSEE');
        setStepState('gpudoc','skip','Geen INSEE');
        setStepState('georisques','skip','Geen INSEE');
        logProgress('ℹ Geen INSEE: beperkt dossier');
      } else {
        setStepState('gpu','done','(bekijk link in Omgevingsdossier)');
        setStepState('gpudoc','done','(bekijk link in Omgevingsdossier)');
        setStepState('georisques','done','(bekijk link in Omgevingsdossier)');
      }

      // DVF
      setStepState('dvf','active','');
      logProgress('Controleert DVF (verkoopprijzen)…');
      let dvf = null;
      if (hasInsee) {
        const dvfRes = await fetch(`/api/dvf?insee=${encodeURIComponent(summary.commune.insee)}`, { signal });
        if (dvfRes.ok) {
          dvf = await dvfRes.json();
          setStepState('dvf','done', dvf?.summary?.median_eur_m2 != null ? `${dvf.summary.median_eur_m2} €/m²` : 'fallback');
          logProgress('✔ DVF opgehaald');
        } else {
          setStepState('dvf','error', `HTTP ${dvfRes.status}`);
          logProgress('⚠ DVF niet beschikbaar (HTTP '+dvfRes.status+')');
        }
      } else {
        setStepState('dvf','skip','Geen INSEE');
      }

      // AI analyse
      setStepState('ai','active','gemini-2.0-flash');
      logProgress('Genereert AI-analyse…');
      const dossierPrompt = buildPrompt(input, summary, dvf);
      const aRes = await fetch('/api/analyse', {
        method: 'POST',
        headers: { 'content-type':'application/json' },
        body: JSON.stringify({ dossier: dossierPrompt }),
        signal
      });
      if (!aRes.ok) {
        const txt = await aRes.text();
        setStepState('ai','error', `HTTP ${aRes.status}`);
        throw new Error(`/api/analyse → ${txt}`);
      }
      const analysis = await aRes.json();
      setStepState('ai','done','✔');
      logProgress('✔ Analyse gereed');

      // render
      renderReport({ input, summary, dvf, analysis: analysis?.output || {} });
      showSpinner(false);
      disableDuringRun(false);
    } catch (err) {
      if (err?.name === 'AbortError') {
        logProgress('⏹ Afgebroken op verzoek');
      } else {
        logProgress(`⚠ Fout: ${err?.message || err}`);
      }
      showSpinner(false);
      disableDuringRun(false);
    } finally {
      aborter = null;
    }
  }

  function buildPrompt(input, summary, dvf) {
    const parts = [];
    parts.push(`Plaats: ${input.city || '—'} ${input.postcode || ''}`.trim());
    if (summary?.commune?.insee) parts.push(`INSEE: ${summary.commune.insee}`);
    if (dvf?.summary?.median_eur_m2 != null) parts.push(`DVF mediaan: ${dvf.summary.median_eur_m2} €/m²`);
    if (input.adText) parts.push(`Advertentietekst: ${input.adText.slice(0, 800)}`);
    return parts.join(' | ');
  }

  function cancelRun() {
    if (aborter) {
      aborter.abort();
      aborter = null;
    }
  }

  // ---- Export (print) ----
  function doExport() {
    window.print();
  }

  // ---- Wire up ----
  function init() {
    resetProgress();
    if (btnGenerate) btnGenerate.addEventListener('click', runGenerate);
    if (btnCancel) btnCancel.addEventListener('click', cancelRun);
    if (btnExport) btnExport.addEventListener('click', doExport);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
