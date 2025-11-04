// /public/script.js
// Immodiagnostique – UI met voortgang, annuleren, watchdog + advertentie-tekstanalyse (plaatsnamen, water, 'read more').
// Belangrijk: geen externe fetches in de browser; alles via /api/*.

window.addEventListener('DOMContentLoaded', () => {
  const $ = (s) => document.querySelector(s);

  // Invoer
  const adLinkEl   = $('#adLink');
  const cityEl     = $('#city');
  const priceEl    = $('#price');
  const postcodeEl = $('#postcode');
  const streetEl   = $('#street');
  const numberEl   = $('#number');
  const adTextEl   = $('#adText');

  // UI
  const btnGenerate   = $('#btn-generate');
  const loader        = $('#loader');
  const spinnerLabel  = loader?.querySelector('.spinner-label');
  const logArea       = $('#progress-log');
  const dossierPanel  = $('#dossier-panel');
  const dossierOut    = $('#dossier-output');
  const overviewPanel = $('#overview-panel');
  const overviewOut   = $('#overview-output');
  const letterPanel   = $('#letter-panel');
  const letterOut     = $('#letter-output');

  // Compose-knoppen
  const btnNotary = $('#btn-notary');
  const btnAgent  = $('#btn-agent');
  const btnSeller = $('#btn-seller');

  // Abort management
  let runId = 0;
  let activeControllers = [];
  function resetControllers() {
    try { activeControllers.forEach(c => c.abort()); } catch {}
    activeControllers = [];
  }

  // Watchdog voor spinner
  let spinnerWatchdog = null;
  function armWatchdog(ms = 30000, reason = 'watchdog timeout') {
    clearWatchdog();
    spinnerWatchdog = setTimeout(() => {
      appendLog(`⏱ ${reason} – spinner geforceerd uit`);
      hideSpinner();
    }, ms);
  }
  function clearWatchdog() { if (spinnerWatchdog) { clearTimeout(spinnerWatchdog); spinnerWatchdog = null; } }

  // Helpers
  const sanitize = (s) => String(s ?? '').trim();
  const escapeHtml = (str = '') =>
    str.replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const escapeAttr = (v) => escapeHtml(String(v ?? ''));
  const fmtMoney = (n) => {
    if (n == null || n === '') return '—';
    try { return new Intl.NumberFormat('nl-NL', { style:'currency', currency:'EUR', maximumFractionDigits:0 }).format(Number(n)); }
    catch { return String(n); }
  };
  function buildFullAddress({ number, street, postcode, city }) {
    const parts = [];
    if (sanitize(number)) parts.push(sanitize(number));
    if (sanitize(street)) parts.push(sanitize(street));
    if (sanitize(postcode)) parts.push(sanitize(postcode));
    if (sanitize(city)) parts.push(sanitize(city));
    return parts.join(' ') || '—';
  }

  // Spinner + log
  function showSpinner(msg) {
    if (spinnerLabel) spinnerLabel.textContent = msg || 'Bezig…';
    loader?.removeAttribute('hidden');
    appendLog(msg || 'Bezig…');
    armWatchdog(30000, 'lange bewerking');
  }
  function hideSpinner() {
    loader?.setAttribute('hidden', '');
    clearWatchdog();
  }
  function appendLog(line) {
    if (!logArea || !line) return;
    const p = document.createElement('div');
    p.className = 'small muted';
    p.textContent = `${new Date().toLocaleTimeString()} · ${line}`;
    logArea.appendChild(p);
    while (logArea.childNodes.length > 12) logArea.removeChild(logArea.firstChild);
  }
  function clearLog() { if (logArea) logArea.innerHTML = ''; }

  // HTTP met timeout en nette fouten
  function withTimeout(ms, fetcher) {
    const controller = new AbortController();
    activeControllers.push(controller);
    const timer = setTimeout(() => { try { controller.abort(); } catch {} }, ms);
    return fetcher(controller.signal).finally(() => clearTimeout(timer));
  }

  async function getJson(url, label) {
    showSpinner(label || 'Bezig…');
    try {
      const data = await withTimeout(12000, async (signal) => {
        const res = await fetch(url, { headers: { 'Accept': 'application/json' }, signal });
        if (res.status === 404 && /favicon\.ico(\?|$)/i.test(url)) { appendLog('⚐ favicon.ico 404 genegeerd'); return null; }
        const ct = res.headers.get('content-type') || '';
        const isJson = ct.includes('application/json');
        const body = isJson ? await res.json() : null;
        if (!res.ok || (isJson && body && body.ok === false)) {
          const msg = (body && (body.error || body.message)) || `HTTP ${res.status}`;
          const err = new Error(msg); err.status = res.status; err.url = url; throw err;
        }
        return body;
      });
      if (data) appendLog(`✔ ${label || url}`);
      return data;
    } catch (e) {
      if (e?.name === 'AbortError') { appendLog(`⏹ Afgebroken: ${label || url}`); return null; }
      const tag = e?.status ? `HTTP ${e.status}` : 'FOUT';
      appendLog(`✖ ${tag} bij ${label || url} → ${e?.url || url}`);
      return null;
    }
  }

  async function postJson(url, payload, label) {
    showSpinner(label || 'Bezig…');
    try {
      const data = await withTimeout(20000, async (signal) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(payload),
          signal
        });
        const ct = res.headers.get('content-type') || '';
        const isJson = ct.includes('application/json');
        const body = isJson ? await res.json() : await res.text();
        if (!res.ok) {
          if (res.status === 429) appendLog('↻ 429 throttled – server-side backoff toegepast');
          const msg = (isJson && (body.error || body.message)) || `HTTP ${res.status}`;
          const err = new Error(msg);
          err.status = res.status; err.detail = isJson ? JSON.stringify(body) : String(body); err.url = url;
          throw err;
        }
        appendLog(`✔ ${label || url}`);
        return body;
      });
      return data;
    } catch (e) {
      if (e?.name === 'AbortError') { appendLog(`⏹ Afgebroken: ${label || url}`); throw e; }
      const tag = e?.status ? `HTTP ${e.status}` : 'FOUT';
      appendLog(`✖ ${tag} bij ${label || url} → ${e?.url || url}`);
      throw e;
    }
  }

  // -------- Advertentie-tekstanalyse (geen scraping, alleen heuristiek) --------
  function normalizeSpaces(s) { return s.replace(/\s+/g, ' ').trim(); }

  // 1) Vind plaatsnamen in patronen “X min van Y” (FR/NL/EN varianten)
  function extractNearbyTowns(text) {
    if (!text) return [];
    const lower = text.toLowerCase();
    const candidates = new Set();

    // FR: "à 20 minutes de Berck sur Mer", "à 15 min de Nice"
    const reFr = /\b(?:à|a)\s*(\d{1,2})\s*(?:min|minutes)\s*(?:de|du|des|d’|d')\s+([A-ZÉÈÀÂÎÔÙÇ][A-Za-zÀ-ÖØ-öø-ÿ' -]{2,})/gmi;
    // NL: "op 20 minuten van Berck-sur-Mer"
    const reNl = /\b(?:op|slechts)?\s*(\d{1,2})\s*(?:min(?:uut)?(?:en)?)\s*(?:van|bij)\s+([A-Z][A-Za-zÀ-ÖØ-öø-ÿ' -]{2,})/gmi;
    // EN: "20 minutes from Berck-sur-Mer"
    const reEn = /\b(\d{1,2})\s*(?:min|minutes)\s*(?:from|to)\s+([A-Z][A-Za-zÀ-ÖØ-öø-ÿ' -]{2,})/gmi;

    const push = (m) => {
      const name = normalizeSpaces((m[2] || '').replace(/\s+sur\s+/gi, '-sur-').replace(/\s+Saint\s+/gi, ' Saint-'));
      if (name.length >= 3) candidates.add(name);
    };
    let m;
    while ((m = reFr.exec(text)) ) push(m);
    while ((m = reNl.exec(text)) ) push(m);
    while ((m = reEn.exec(text)) ) push(m);

    // Extra heuristiek: typisch Franse vormen “-sur-Mer”, “Saint-…”
    const extra = text.match(/\b([A-Z][a-z]+(?:-[A-Z][a-z]+)*(?:-sur-|-sur\-| sur |-sur-)[A-Z][a-z]+)\b/g);
    if (extra) extra.forEach(v => candidates.add(normalizeSpaces(v)));

    return Array.from(candidates).slice(0, 8);
  }

  // 2) Water-nabijheid
  function detectNearWater(text) {
    if (!text) return false;
    const kw = [
      'rivière','fleuve','canal','marais','étang','lagune','bords de mer','bord de mer','digue',
      'inondable','zone inondable','submersion','crue','berk','mer','littoral'
    ];
    const lower = text.toLowerCase();
    return kw.some(k => lower.includes(k));
  }

  // 3) Mogelijk afgekapt (Lees meer / Lire plus)
  function detectTruncated(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    return /lire\s+plus|lire\s+la\s+suite|read\s+more/.test(lower) || /…(\s*)$/.test(text);
  }

  // Rendering
  function renderDossier(values) {
    const fullAddr = buildFullAddress(values);
    dossierOut.innerHTML = `
      <ol class="checklist">
        <li>
          <strong>1. Officieel adres / advertentie</strong>
          <div class="box">
            <div><em>Invoer:</em><br>${escapeHtml(fullAddr)}</div>
            ${values.price
              ? `<div class="note">Vraagprijs: <strong>${escapeHtml(values.price)}</strong> <span class="small muted">(facultatief maar aanbevolen)</span></div>`
              : `<div class="small muted">Vraagprijs: — <span>(facultatief maar aanbevolen)</span></div>`
            }
            <div class="note">Exact perceel later opvragen bij notaris.</div>
            ${values.adLink ? `<div class="note">Advertentielink: <code>${escapeHtml(values.adLink)}</code></div>` : ''}
            <div class="small muted">Tip: open eerst “Lees meer / Lire plus” op de advertentiepagina, kopieer dan pas de volledige tekst.</div>
          </div>
        </li>
        <li><strong>2. Risico's (Géorisques)</strong><div class="box">ERP (≤ 6 maanden) vereist zodra adres exact is.</div></li>
        <li><strong>3. Verkoopprijzen (DVF)</strong><div class="box">Indicatief op gemeenteniveau.</div></li>
        <li><strong>4. Bestemmingsplan (PLU)</strong><div class="box">Check zone/beperkingen via Géoportail Urbanisme (PLU/SUP).</div></li>
      </ol>
      <div id="official-data"></div>
    `;
    dossierPanel?.removeAttribute('hidden');
  }
  function appendOfficialSection(html) {
    const mount = $('#official-data'); if (!mount) return;
    const div = document.createElement('div'); div.innerHTML = html; mount.appendChild(div);
  }
  function renderCommune(c) {
    appendOfficialSection(`
      <section>
        <h3>Gegevens uit officiële bronnen</h3>
        <div class="box">
          <div><strong>Gemeente:</strong> ${escapeHtml(c.name)} (INSEE: <code>${escapeHtml(c.insee)}</code>)</div>
          <div class="small muted">Departement: ${escapeHtml(c.department?.name || '')} (${escapeHtml(c.department?.code || '')})</div>
        </div>
      </section>
    `);
  }
  function renderGeorisques(gr) {
    const items = (gr.summary || []).map(s => {
      const badge = s.present ? '✅' : '—';
      const cls = s.present ? 'ok' : 'muted';
      return `<li><span class="badge ${cls}">${badge}</span> ${escapeHtml(s.label)}</li>`;
    }).join('') || '<li class="muted">Geen categorieën gevonden</li>';
    appendOfficialSection(`
      <section>
        <h4>Géorisques</h4>
        <div class="box">
          <ul class="badgelist">${items}</ul>
          <div class="small"><a href="${escapeAttr(gr.links?.commune)}" target="_blank" rel="noopener">Open Géorisques (commune)</a></div>
        </div>
      </section>
    `);
  }
  function renderGPU(gpu) {
    const z = gpu.zones || [];
    const items = z.length
      ? z.map(item => `<li>${escapeHtml(item.code || item.label || 'Zone')} <span class="small muted">×${item.count}</span></li>`).join('')
      : '<li class="muted">Geen zone-urba polygonen aangetroffen (mogelijk RNU of alleen documenten).</li>';
    appendOfficialSection(`
      <section>
        <h4>Géoportail Urbanisme (PLU/SUP)</h4>
        <div class="box">
          <ul>${items}</ul>
          <div class="small"><a href="${escapeAttr(gpu.links?.gpu_site_commune)}" target="_blank" rel="noopener">Open GPU (gemeente)</a></div>
        </div>
      </section>
    `);
  }
  function renderGPUDoc(gpudoc) {
    const docs = gpudoc.documents || [];
    const items = docs.length
      ? docs.map(d => {
          const t = [d.type, d.title].filter(Boolean).join(' — ');
          const dt = d.date ? ` <span class="small muted">(${escapeHtml(d.date)})</span>` : '';
          return `<li><a href="${escapeAttr(d.url)}" target="_blank" rel="noopener">${escapeHtml(t || 'Document')}</a>${dt}</li>`;
        }).join('')
      : '<li class="muted">Geen documenten via API gevonden.</li>';
    appendOfficialSection(`
      <section>
        <h4>Documenten (PLU/SUP)</h4>
        <div class="box">
          <ul>${items}</ul>
          <div class="small"><a href="${escapeAttr(gpudoc.links?.gpu_recherche)}" target="_blank" rel="noopener">Zoek in GPU</a></div>
        </div>
      </section>
    `);
  }
  function renderDVF(dvf) {
    let inner = '<li class="muted">Geen samenvatting beschikbaar (gebruik links)</li>';
    if (dvf.summary?.total) {
      const t = dvf.summary.total;
      inner = `
        <li>Totaal transacties (met waarde): <strong>${escapeHtml(String(t.count))}</strong></li>
        <li>Mediaan prijs: <strong>${fmtMoney(t.median_price)}</strong></li>
        <li>Mediaan €/m²: <strong>${fmtMoney(t.median_eur_m2)}</strong></li>
      `;
    }
    appendOfficialSection(`
      <section>
        <h4>DVF (verkoopprijzen)</h4>
        <div class="box">
          <ul>${inner}</ul>
          <div class="small">
            <a href="${escapeAttr(dvf.links?.etalab_app)}" target="_blank" rel="noopener">Open Etalab DVF</a>
          </div>
        </div>
      </section>
    `);
  }

  function renderLocationWarnings(values, advertSignals) {
    const msgs = [];
    const chosen = sanitize(values.city);
    const towns = advertSignals?.towns || [];
    const nearWater = !!advertSignals?.near_water;
    const truncated = !!advertSignals?.truncated;

    // Locatie-mismatch
    if (chosen && towns.length) {
      const normalizedChosen = chosen.replace(/\s+/g, ' ').toLowerCase();
      const match = towns.some(t => t.replace(/\s+/g, ' ').toLowerCase().includes(normalizedChosen));
      if (!match) {
        msgs.push(`Advertentie noemt nabijgelegen plaatsen: ${escapeHtml(towns.join(', '))}. Dit kan afwijken van ingevoerde gemeente (${escapeHtml(chosen)}). Vraag het exacte adres of een kaart-pin op.`);
      }
    }
    // Water
    if (nearWater) {
      msgs.push('Tekst wijst op ligging nabij water (rivière/canal/marais/mer). Plan een grondige ERP-check en controleer PLU-zonering.');
    }
    // Read more
    if (truncated) {
      msgs.push('Advertentietekst lijkt niet volledig. Open eerst “Lees meer / Lire plus”, kopieer daarna de volledige tekst voor betere analyse.');
    }

    if (!msgs.length) return '';
    return `
      <section>
        <div class="alert warn">
          <strong>Locatie/kwaliteit waarschuwingen:</strong>
          <ul>${msgs.map(m => `<li>${m}</li>`).join('')}</ul>
        </div>
      </section>
    `;
  }

  function renderSWOT(swot) {
    const s = swot || { sterke_punten:[], mogelijke_zorgpunten:[], mogelijke_kansen:[], mogelijke_bedreigingen:[] };
    const cell = (title, items, extra='') => `
      <div class="swot-cell ${extra}">
        <h4>${title}</h4>
        ${items?.length ? `<ul>${items.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : '<p class="muted">—</p>'}
      </div>
    `;
    return `
      <section>
        <h3>SWOT-matrix</h3>
        <div class="swot-grid">
          ${cell('Sterke punten', s.sterke_punten, 'ok')}
          ${cell('Mogelijke zorgpunten', s.mogelijke_zorgpunten, 'warn')}
          ${cell('Mogelijke kansen', s.mogelijke_kansen)}
          ${cell('Mogelijke bedreigingen', s.mogelijke_bedreigingen, 'warn')}
        </div>
      </section>
    `;
  }

  function renderOverview(result, values, advertSignals) {
    const out = result?.output || {};
    const throttle = result?.throttleNotice;

    const warnings = renderLocationWarnings(values, advertSignals);

    const vragen = [
      ...(out.communicatie?.verkoper || []),
      ...(out.communicatie?.notaris || []),
      ...(out.communicatie?.makelaar || []),
    ];
    overviewOut.innerHTML = `
      ${throttle ? `<div class="alert warn">Throttling door Gemini; backoff toegepast. (${escapeHtml(throttle)})</div>` : ''}
      <div class="small muted">Model: <code>${escapeHtml(result?.model || '')}</code> · ${new Date().toLocaleString()}</div>
      ${warnings}
      ${renderSWOT(out.swot)}
      <h3>Actieplan</h3>
      ${out.actieplan?.length ? `<ul>${out.actieplan.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul>` : '<p class="muted">—</p>'}
      <h3>Vragen & Communicatie</h3>
      ${vragen.length ? `<ul>${vragen.map(v => `<li>${escapeHtml(v)}</li>`).join('')}</ul>` : '<p class="muted">—</p>'}
      <div class="alert warn small">
        <strong>Let op:</strong> voorkom een overhaaste “coup de cœur”. Weeg rustig af, bepaal totale acquisitiekosten
        (incl. makelaar en notaris) en plan verbouwingskosten realistisch in. Tip: de koper kan een eigen notaris kiezen;
        de cumulatieve notariskosten blijven doorgaans gelijk.
      </div>
    `;
    overviewPanel?.removeAttribute('hidden');
    overviewPanel.scrollIntoView({ behavior:'smooth', block:'start' });
  }

  // Data ophalen
  async function fetchCommune(city, postcode) {
    const qs = new URLSearchParams(); if (city) qs.set('city', city); if (postcode) qs.set('postcode', postcode);
    return await getJson(`/api/commune?${qs.toString()}`, 'Raadpleegt gemeente…');
  }
  async function fetchGeorisques(insee){ return await getJson(`/api/georisques?insee=${encodeURIComponent(insee)}`, 'Raadpleegt Géorisques…'); }
  async function fetchGPU(insee){ return await getJson(`/api/gpu?insee=${encodeURIComponent(insee)}`, 'Raadpleegt GPU (PLU/SUP)…'); }
  async function fetchGPUDoc(insee){ return await getJson(`/api/gpu-doc?insee=${encodeURIComponent(insee)}`, 'Raadpleegt GPU-documenten…'); }
  async function fetchDVF(insee){ return await getJson(`/api/dvf?insee=${encodeURIComponent(insee)}`, 'Raadpleegt DVF (verkoopprijzen)…'); }

  // Signals samenstellen
  function buildSignals(values, summary, advertSignals) {
    const s = {};
    if (values.price && !Number.isNaN(Number(values.price))) s.price = Number(values.price);
    if (summary?.dvf?.summary?.total?.median_price) s.dvf = { median_price: Number(summary.dvf.summary.total.median_price) };
    if (summary?.georisques?.summary) {
      const flags = {}; for (const item of summary.georisques.summary) flags[item.key] = !!item.present;
      s.georisques = flags;
    }
    if (advertSignals?.keywords?.length) s.advertentie = { keywords: advertSignals.keywords.slice(0,12) };
    if (advertSignals?.towns?.length) {
      s.advertentie = Object.assign({}, s.advertentie || {}, { towns: advertSignals.towns.slice(0,8) });
    }
    if (advertSignals?.near_water) {
      s.advertentie = Object.assign({}, s.advertentie || {}, { near_water: true });
    }
    if (advertSignals?.truncated) {
      s.advertentie = Object.assign({}, s.advertentie || {}, { truncated: true });
    }
    return s;
  }

  function composeDossierText(values, summary, advertSignals) {
    const { adLink, city, price, postcode, street, number, adText } = values;
    const fullAddr = buildFullAddress({ number, street, postcode, city });
    const route = (street || number || postcode) ? 'Route B (adres bekend)' : 'Route A (geen adres)';

    const lines = [];
    lines.push(`[${route}]`, '');
    lines.push('1) Officieel adres / advertentie');
    lines.push(`Invoer: ${fullAddr}`);
    if (price) lines.push(`Vraagprijs: ${price}`);
    if (adLink) lines.push(`Advertentielink: ${adLink}`);
    lines.push('Exact perceelnummer later via notaris opvragen.', '');

    if (summary?.commune) lines.push(`Gemeente: ${summary.commune.name} (INSEE ${summary.commune.insee})`);
    if (summary?.georisques) {
      const hits = (summary.georisques.summary || []).filter(s => s.present).map(s => s.label);
      lines.push(`Géorisques: ${hits.length ? hits.join(', ') : 'geen expliciete categorieën gevonden'}`);
    }
    if (summary?.gpu) {
      const z = summary.gpu.zones || [];
      lines.push(`PLU (zone-urba): ${z.length ? `${z.length} zones` : 'geen polygonen gevonden'}`);
    }
    if (summary?.dvf?.summary?.total) {
      const t = summary.dvf.summary.total;
      lines.push(`DVF (indicatief): transacties=${t.count}, mediaan prijs≈${fmtMoney(t.median_price)}, mediaan €/m²≈${fmtMoney(t.median_eur_m2)}`);
    }
    // Advertentie-observaties
    if (advertSignals?.towns?.length) lines.push(`Advertentie noemt nabij: ${advertSignals.towns.join(', ')}`);
    if (advertSignals?.near_water) lines.push('Advertentie suggereert ligging nabij water (extra ERP/PLU check).');
    if (advertSignals?.truncated) lines.push('Advertentietekst lijkt afgekapt (open “Lire plus/Lees meer” en kopieer opnieuw).');

    lines.push('', "2) Risico's (Géorisques)", 'ERP nodig (≤ 6 maanden) indien adres bekend.', '');
    lines.push('3) Verkoopprijzen (DVF)', 'DVF is op gemeenteniveau.', '');
    lines.push('4) Bestemmingsplan (PLU)', 'Noteer zone/beperkingen via Géoportail Urbanisme (PLU/SUP).', '');
    if (adText) { lines.push('Advertentietekst (volledig):', adText); }
    return lines.join('\n');
  }

  // Export-knop (pas zinvol na analyse)
  let btnExport = null;
  function ensureExportButtonOnce() {
    if (btnExport) return;
    btnExport = document.createElement('button');
    btnExport.id = 'btn-export';
    btnExport.className = 'btn';
    btnExport.textContent = 'Exporteer rapport (PDF/print)';
    const actions = document.querySelector('.actions');
    if (actions) actions.insertAdjacentElement('afterend', btnExport);
    else document.body.appendChild(btnExport);

    btnExport.addEventListener('click', () => {
      const values = collectInput();
      const summary = window.__lastSummary || null;
      const html = buildPrintableReport(values, summary, overviewOut.innerHTML || '');
      const w = window.open('', '_blank');
      if (!w) return alert('Pop-up geblokkeerd: sta pop-ups toe voor export.');
      w.document.open(); w.document.write(html); w.document.close(); w.focus(); w.print();
    });
  }
  function renderOfficialSummaryToStatic(summary) {
    if (!summary) return `<div class="box"><p class="muted">Geen officiële gegevens opgehaald.</p></div>`;
    const parts = [];
    if (summary.commune) {
      parts.push(`
        <h3>Gemeente</h3>
        <div class="box">
          <div><strong>${escapeHtml(summary.commune.name)}</strong> (INSEE ${escapeHtml(summary.commune.insee)})</div>
          <div class="small muted">Departement: ${escapeHtml(summary.commune.department?.name || '')} (${escapeHtml(summary.commune.department?.code || '')})</div>
        </div>
      `);
    }
    if (summary.georisques) {
      const items = (summary.georisques.summary || []).map(s => {
        const badge = s.present ? '✅' : '—';
        const cls = s.present ? 'ok' : 'muted';
        return `<li><span class="badge ${cls}">${badge}</span> ${escapeHtml(s.label)}</li>`;
      }).join('') || '<li class="muted">Geen categorieën gevonden</li>';
      parts.push(`<h3>Géorisques</h3><div class="box"><ul class="badgelist">${items}</ul></div>`);
    }
    if (summary.gpu) {
      const z = summary.gpu.zones || [];
      const items = z.length
        ? z.map(item => `<li>${escapeHtml(item.code || item.label || 'Zone')} <span class="small muted">×${item.count}</span></li>`).join('')
        : '<li class="muted">Geen zone-urba polygonen aangetroffen.</li>';
      parts.push(`<h3>PLU/SUP (GPU)</h3><div class="box"><ul>${items}</ul></div>`);
    }
    if (summary.dvf) {
      let inner = '<li class="muted">Geen samenvatting (gebruik Etalab/DVF-links).</li>';
      if (summary.dvf.summary?.total) {
        const t = summary.dvf.summary.total;
        inner = `
          <li>Totaal transacties: <strong>${escapeHtml(String(t.count))}</strong></li>
          <li>Mediaan prijs: <strong>${fmtMoney(t.median_price)}</strong></li>
          <li>Mediaan €/m²: <strong>${fmtMoney(t.median_eur_m2)}</strong></li>
        `;
      }
      parts.push(`<h3>DVF (verkoopprijzen)</h3><div class="box"><ul>${inner}</ul></div>`);
    }
    return parts.join('\n');
  }
  function buildPrintableReport(values, summary, overviewHtml) {
    const title = 'IMMODIAGNOSTIQUE – Rapport';
    const addr = buildFullAddress(values);
    const today = new Date().toLocaleDateString('nl-NL');
    const extract = (html, h3Text) => {
      const rx = new RegExp(`<h3[^>]*>${h3Text}<\/h3>[\\s\\S]*?(?=<h3|$)`, 'i');
      const m = (html || '').match(rx);
      return m ? m[0].replace(/^<h3[^>]*>[^<]*<\/h3>/i, '').trim() : '';
    };
    const swotSection = extract(overviewHtml, 'SWOT-matrix');
    const actions     = extract(overviewHtml, 'Actieplan');
    const comms       = extract(overviewHtml, 'Vragen & Communicatie');
    const omgeving    = renderOfficialSummaryToStatic(summary);
    const waarschuwing = `
      <p><strong>Waarschuwing:</strong> voorkom een overhaaste “coup de cœur”. Weeg rustig af, bepaal totale acquisitiekosten
      (inclusief makelaars- en notariskosten) en plan verbouwingskosten realistisch in. Tip: de koper kan een eigen notaris
      kiezen; de cumulatieve notariskosten blijven doorgaans gelijk.</p>
      <p class="small muted">Disclaimer: Deze analyse is indicatief en informatief. Raadpleeg notaris, makelaar en de officiële
      bronnen (Géorisques, DVF, Géoportail-Urbanisme). Aan deze tool kunnen geen rechten worden ontleend.</p>
    `;
    const style = `
      <style>
        :root { --brand:#800000; --ink:#222; --muted:#666; --ok:#0a7f00; --warn:#b00020; }
        body { font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:var(--ink); margin:2rem; }
        .container { max-width:780px; margin:0 auto; }
        h1{font-size:26px; margin:0 0 4px; color:var(--brand);}
        h2{font-size:18px; margin:20px 0 6px;}
        h3{font-size:16px; margin:16px 0 6px;}
        h4{font-size:14px; margin:10px 0 6px;}
        .muted{color:var(--muted);} .small{font-size:12px;}
        .ok{color:var(--ok);} .warn{color:var(--warn);}
        .box{border:1px solid #ddd; border-radius:6px; padding:10px 12px; margin:8px 0;}
        ul{margin:6px 0 6px 20px;}
        .badgelist{list-style:none; margin:0; padding:0;}
        .badge{display:inline-block; width:1.4em; text-align:center; margin-right:6px;}
        .hr{height:1px; background:#ddd; margin:24px 0;}
        .swot-grid{display:grid; grid-template-columns:1fr 1fr; gap:10px;}
        .swot-cell{border:1px solid #ddd; border-radius:6px; padding:10px 12px;}
        .swot-cell.ok h4{color:var(--ok);} .swot-cell.warn h4{color:var(--warn);}
        @media print { a { color: inherit; text-decoration: none; } }
      </style>
    `;
    return `
<!DOCTYPE html>
<html lang="nl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${style}</head>
<body><div class="container">
  <h1>IMMODIAGNOSTIQUE – Rapport</h1>
  <div class="small muted">Datum: ${escapeHtml(today)}</div>
  <div class="hr"></div>
  <h2>1. Vastgoeddossier</h2>
  <div class="box">
    <div><strong>Adres/advertentie:</strong> ${escapeHtml(addr)}</div>
    ${values.price ? `<div><strong>Vraagprijs:</strong> ${escapeHtml(values.price)}</div>` : ``}
    ${values.adLink ? `<div><strong>Advertentielink:</strong> <code>${escapeHtml(values.adLink)}</code></div>` : ``}
    <div class="small muted">Exact perceelnummer later bij de notaris opvragen.</div>
  </div>
  <h2>2. Omgevingsdossier (officiële bronnen)</h2>
  ${omgeving}
  <h2>3. Actieplan</h2>
  <div class="box">${actions || '<p class="muted">—</p>'}</div>
  <h3>Communicatie & Vragen</h3>
  <div class="box">${comms || '<p class="muted">—</p>'}</div>
  <div class="hr"></div>
  <h2>Bijlage A – SWOT-matrix</h2>
  <div class="box">${swotSection || '<p class="muted">—</p>'}</div>
  <div class="hr"></div>
  <h2>Waarschuwing & Disclaimer</h2>
  <div class="box">${waarschuwing}</div>
</div></body></html>`;
  }

  // Input
  function collectInput() {
    return {
      adLink:   sanitize(adLinkEl?.value),
      city:     sanitize(cityEl?.value),
      price:    sanitize(priceEl?.value),
      postcode: sanitize(postcodeEl?.value),
      street:   sanitize(streetEl?.value),
      number:   sanitize(numberEl?.value),
      adText:   sanitize(adTextEl?.value),
    };
  }

  // Orkestratie
  async function fetchSummarySequential(city, postcode) {
    const combined = { ok:true, input:{ city, postcode } };
    const comm = await fetchCommune(city, postcode);
    if (comm?.commune) {
      combined.commune = comm.commune; renderCommune(comm.commune);
      const insee = combined.commune.insee;
      const gr  = await fetchGeorisques(insee); if (gr)  { combined.georisques = gr; renderGeorisques(gr); }
      const gpu = await fetchGPU(insee);        if (gpu) { combined.gpu = gpu; renderGPU(gpu); }
      const gd  = await fetchGPUDoc(insee);     if (gd)  { combined.gpudoc = gd; renderGPUDoc(gd); }
      const dvf = await fetchDVF(insee);        if (dvf) { combined.dvf = dvf; renderDVF(dvf); }
      combined.meta = { insee, timestamp: new Date().toISOString() };
    } else {
      appendLog('ℹ Geen INSEE: alleen basisdossier zonder officiële bronnen');
    }
    window.__lastSummary = combined;
    return combined;
  }

  async function handleGenerate(thisRunId) {
    clearLog();
    showSpinner('Dossier wordt opgebouwd…');
    const values = collectInput();
    if (!values.city) { alert('Plaatsnaam is verplicht.'); cityEl?.focus(); hideSpinner(); return; }

    // Reset panels
    dossierPanel?.removeAttribute('hidden');
    overviewPanel?.setAttribute('hidden', '');
    letterPanel?.setAttribute('hidden', '');
    $('#official-data')?.replaceChildren();

    renderDossier(values);

    // 0) Advertentie-tekstanalyse vooraf (geen netwerk)
    const advertSignals = {};
    if (values.adText) {
      const lower = values.adText.toLowerCase();
      const kw = [];
      if (/\b(dpe|étiquette|classe)\b.*\b(a|b|c)\b/i.test(values.adText)) kw.push('dpe A–C');
      if (/\btriple vitrage\b|\bhr\+\+\b|\bdouble vitrage\b/i.test(values.adText)) kw.push('dubbel/triple glas');
      if (/\bisolati(e|on)|toit isolé|isolation\b/i.test(values.adText)) kw.push('isolatie');
      if (/\bpompe à chaleur\b|heat pump\b/i.test(values.adText)) kw.push('warmtepomp');
      if (/\bà\s*rénover\b|travaux|to renovate\b/i.test(values.adText)) kw.push('renovatie/werk');
      if (kw.length) advertSignals.keywords = kw;

      advertSignals.towns = extractNearbyTowns(values.adText);
      advertSignals.near_water = detectNearWater(values.adText);
      advertSignals.truncated = detectTruncated(values.adText);

      if (advertSignals.towns?.length) appendLog(`↯ Advertentie noemt nabij: ${advertSignals.towns.join(', ')}`);
      if (advertSignals.near_water) appendLog('↯ Tekst wijst op ligging nabij water');
      if (advertSignals.truncated) appendLog('↯ Tekst lijkt afgekapt (Lire plus/Lees meer?)');
    }

    // 1) Officiële bronnen
    const summary = await fetchSummarySequential(values.city, values.postcode);
    if (thisRunId !== runId) return; // geannuleerd

    // 2) Analyse (met signals incl. advertentie-heuristiek)
    showSpinner('Genereert AI-analyse…');
    overviewOut.innerHTML = `<div class="alert info">Analyse wordt gegenereerd…</div>`;
    overviewPanel?.removeAttribute('hidden');

    const signals = buildSignals(values, summary || {}, advertSignals);
    const dossierText = composeDossierText(values, summary || {}, advertSignals);

    try {
      const result = await postJson('/api/analyse', { dossier: dossierText, signals }, 'Analyseert (Gemini)…');
      if (thisRunId !== runId) return;
      renderOverview(result, values, advertSignals);
      ensureExportButtonOnce();
    } catch (err) {
      if (err?.name === 'AbortError') return;
      overviewOut.innerHTML = `<div class="alert error"><strong>Fout tijdens AI-analyse:</strong> ${escapeHtml(err.message)}</div>`;
    } finally {
      hideSpinner();
    }
  }

  // Annuleer-knop
  let cancelBtn = null;
  function ensureCancelButton() {
    if (cancelBtn) return;
    cancelBtn = document.createElement('button');
    cancelBtn.id = 'btn-cancel';
    cancelBtn.className = 'btn outline';
    cancelBtn.textContent = 'Annuleer';
    cancelBtn.addEventListener('click', () => {
      appendLog('Gebruiker annuleert de huidige run');
      hideSpinner();          // direct visueel weg
      resetControllers();     // abort alle fetches
      runId++;                // invalideer lopende chain
    });
    const actions = document.querySelector('.actions');
    if (actions) actions.appendChild(cancelBtn);
  }
  ensureCancelButton();

  // Events
  let running = false;
  btnGenerate?.addEventListener('click', async () => {
    if (running) return;
    try {
      running = true;
      runId++;
      resetControllers();
      btnGenerate.classList.add('is-loading'); btnGenerate.disabled = true;
      ensureCancelButton();
      await handleGenerate(runId);
    } finally {
      btnGenerate.classList.remove('is-loading'); btnGenerate.disabled = false;
      running = false;
    }
  });

  function getChannelFor(rec){
    const group = document.querySelector(`.radio-row[data-recipient="${rec}"]`);
    const checked = group?.querySelector('input[type="radio"]:checked');
    return checked?.value || 'email';
  }
  function getLanguageFor(rec){
    const sel = document.querySelector(`#lang-${rec}`);
    return sel?.value || 'nl';
  }
  function onCompose(role, rec){
    return async () => {
      const values = collectInput();
      if (!values.city) { alert('Plaatsnaam is verplicht.'); cityEl?.focus(); return; }
      const channel  = getChannelFor(rec);
      const language = getLanguageFor(rec);
      const summary  = window.__lastSummary || null;
      const dossierText = `Language: ${language}\nRecipient: ${rec}\n\n${composeDossierText(values, summary || {}, null)}`;

      try {
        letterOut.innerHTML = `<div class="alert info">Bericht wordt gegenereerd…</div>`;
        letterPanel?.removeAttribute('hidden');
        const result = await postJson('/api/compose', { role, dossier: dossierText, channel, language }, 'Stelt bericht op…');
        const txt = result?.output?.letter_text || '';
        const throttle = result?.throttleNotice;
        letterOut.innerHTML = `
          ${throttle ? `<div class="alert warn">Throttling door Gemini; backoff toegepast. (${escapeHtml(throttle)})</div>` : ''}
          <pre class="letter">${escapeHtml(txt)}</pre>
          <div class="small muted">Model: <code>${escapeHtml(result?.model || '')}</code></div>
        `;
        letterPanel.scrollIntoView({ behavior:'smooth', block:'start' });
      } catch (err) {
        letterOut.innerHTML = `<div class="alert error"><strong>Fout:</strong> ${escapeHtml(err.message)}</div>`;
      }
    };
  }
  btnNotary?.addEventListener('click', onCompose('notary-fr','notary'));
  btnAgent ?.addEventListener('click', onCompose('agent-nl','agent'));
  btnSeller?.addEventListener('click', onCompose('seller-mixed','seller'));

  // Defensieve logging
  window.addEventListener('error', (e) => appendLog(`JS-error: ${e.message || e.type}`));
  window.addEventListener('unhandledrejection', (e) => appendLog(`Promise-reject: ${(e.reason && e.reason.message) || String(e.reason)}`));
  window.addEventListener('beforeunload', () => { try { resetControllers(); } catch {} });
});
