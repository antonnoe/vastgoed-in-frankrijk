// /public/script.js
// Immodiagnostique – functional + UX
// - Spinner i.p.v. progressbar
// - “Maak dossier” triggert: basis → /api/summary → /api/analyse; compose/PDF pas na afloop.
// - Contactkanaal/taal per ontvanger; we sturen {channel, language} mee naar /api/compose (safe: backend mag negeren).
// - Grotere inputs zijn in CSS geregeld.

window.addEventListener('DOMContentLoaded', () => {
  const $  = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // Invoer
  const adLinkEl   = $('#adLink');
  const cityEl     = $('#city');
  const priceEl    = $('#price');
  const postcodeEl = $('#postcode');
  const streetEl   = $('#street');
  const numberEl   = $('#number');
  const adTextEl   = $('#adText');

  // UI
  const btnPrimary   = $('#btn-generate');
  const loader       = $('#loader');
  const dossierPanel = $('#dossier-panel');
  const dossierOut   = $('#dossier-output');
  const overviewPanel= $('#overview-panel');
  const overviewOut  = $('#overview-output');
  const letterPanel  = $('#letter-panel');
  const letterOut    = $('#letter-output');

  // Compose
  const btnNotary = $('#btn-notary');
  const btnAgent  = $('#btn-agent');
  const btnSeller = $('#btn-seller');

  // compose-sectie pas na analyse tonen
  // (we detecteren op basis van buttons)
  function showCompose() {
    // sectie is in HTML niet hidden, maar knoppen staan eronder; geen extra nodig.
  }

  // Helpers
  const sanitize = (s) => String(s || '').trim();
  const escapeHtml = (str='') => str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);
  const escapeAttr = (v) => escapeHtml(String(v || ''));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function fmtMoney(n) {
    if (n == null || n === '') return '—';
    try{
      return new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(Number(n));
    }catch{ return String(n); }
  }

  function buildFullAddress({ number, street, postcode, city }) {
    const parts = [];
    if (sanitize(number)) parts.push(sanitize(number));
    if (sanitize(street)) parts.push(sanitize(street));
    if (sanitize(postcode)) parts.push(sanitize(postcode));
    if (sanitize(city)) parts.push(sanitize(city));
    return parts.join(' ') || '—';
  }

  function getChannelFor(rec){ // rec: notary | agent | seller
    const group = document.querySelector(`.radio-row[data-recipient="${rec}"]`);
    const checked = group?.querySelector('input[type="radio"]:checked');
    return checked?.value || 'email';
  }
  function getLanguageFor(rec){
    const sel = $(`#lang-${rec}`);
    return sel?.value || 'nl';
  }

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

  function smoothReveal(panel) {
    if (panel && panel.hasAttribute('hidden')) panel.removeAttribute('hidden');
    panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showSpinner(msg){
    if (!loader) return;
    loader.querySelector('.spinner-label').textContent = msg || 'Bezig…';
    loader.removeAttribute('hidden');
  }
  function hideSpinner(){
    loader?.setAttribute('hidden', '');
  }

  async function postJson(url, payload) {
    const res = await fetch(url, {
      method:'POST',
      headers: { 'Content-Type':'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    });
    const ct = res.headers.get('content-type') || '';
    const isJson = ct.includes('application/json');
    const data = isJson ? await res.json() : await res.text();
    if (!res.ok) {
      if (res.status === 429) throw new Error('429: Gesmoord door rate-limit. Server past backoff toe; probeer zo meteen opnieuw.');
      const msg = (isJson && (data.error || data.message)) || `HTTP ${res.status}`;
      const e = new Error(msg); e.detail = isJson ? JSON.stringify(data) : String(data); throw e;
    }
    return data;
  }

  async function getJson(url) {
    const res = await fetch(url, { headers: { 'Accept':'application/json' } });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : null;
    return res.ok && data?.ok ? data : null;
  }

  // Render basis
  function renderDossier(values) {
    const { adLink, city, price } = values;
    const fullAddr = buildFullAddress(values);
    dossierOut.innerHTML = `
      <ol class="checklist">
        <li>
          <strong>1. Officieel adres / advertentie</strong>
          <div class="box">
            <div><em>Invoer:</em><br>${escapeHtml(fullAddr)}</div>
            ${price ? `<div class="note">Vraagprijs: <strong>${escapeHtml(price)}</strong></div>` : ''}
            <div class="note">Exact perceel later opvragen bij notaris.</div>
            ${adLink ? `<div class="note">Advertentielink: <code>${escapeHtml(adLink)}</code></div>` : ''}
          </div>
        </li>
        <li>
          <strong>2. Risico's (Géorisques)</strong>
          <div class="box">
            Controleer risico's voor: <code>${escapeHtml(city || '—')}</code><br>
            <span class="note">ERP (≤ 6 maanden) vereist als adres bekend is.</span>
          </div>
        </li>
        <li>
          <strong>3. Verkoopprijzen (DVF)</strong>
          <div class="box">
            DVF is op gemeenteniveau (gemeente: <code>${escapeHtml(city || '—')}</code>).
          </div>
        </li>
        <li>
          <strong>4. Bestemmingsplan (PLU)</strong>
          <div class="box">
            Noteer zone & beperkingen via Géoportail Urbanisme (PLU/SUP).
          </div>
        </li>
      </ol>
      <div id="official-data"></div>
    `;
    smoothReveal(dossierPanel);
  }

  function renderOfficialSummary(summary) {
    const mount = $('#official-data');
    if (!mount) return;
    const parts = [];

    if (summary?.commune) {
      const c = summary.commune;
      parts.push(`
        <section>
          <h3>Gegevens uit officiële bronnen</h3>
          <div class="box">
            <div><strong>Gemeente:</strong> ${escapeHtml(c.name || '')} (INSEE: <code>${escapeHtml(c.insee || '')}</code>)</div>
            <div class="small muted">Departement: ${escapeHtml(c.department?.name || '')} (${escapeHtml(c.department?.code || '')})</div>
          </div>
        </section>
      `);
    }

    if (summary?.georisques) {
      const gr = summary.georisques;
      const items = (gr.summary || []).map(s => {
        const badge = s.present ? '✅' : '—';
        const cls = s.present ? 'ok' : 'muted';
        return `<li><span class="badge ${cls}">${badge}</span> ${escapeHtml(s.label)}</li>`;
      }).join('') || '<li class="muted">Geen categorieën gevonden</li>';
      parts.push(`
        <section>
          <h4>Géorisques</h4>
          <div class="box">
            <ul class="badgelist">${items}</ul>
            <div class="small"><a href="${escapeAttr(gr.links?.commune)}" target="_blank" rel="noopener">Open Géorisques (commune)</a></div>
          </div>
        </section>
      `);
    }

    if (summary?.gpu) {
      const z = summary.gpu.zones || [];
      const items = z.length
        ? z.map(item => `<li>${escapeHtml(item.code || item.label || 'Zone')} <span class="small muted">×${item.count}</span></li>`).join('')
        : '<li class="muted">Geen zone-urba polygonen aangetroffen (mogelijk RNU of alleen documenten).</li>';
      parts.push(`
        <section>
          <h4>Géoportail Urbanisme (PLU/SUP)</h4>
          <div class="box">
            <ul>${items}</ul>
            <div class="small"><a href="${escapeAttr(summary.gpu.links?.gpu_site_commune)}" target="_blank" rel="noopener">Open GPU (gemeente)</a></div>
          </div>
        </section>
      `);
    }

    if (summary?.gpudoc) {
      const docs = summary.gpudoc.documents || [];
      const items = docs.length
        ? docs.map(d => {
            const t = [d.type, d.title].filter(Boolean).join(' — ');
            const date = d.date ? `<span class="small muted"> (${escapeHtml(d.date)})</span>` : '';
            return `<li><a href="${escapeAttr(d.url)}" target="_blank" rel="noopener">${escapeHtml(t || 'Document')}</a>${date}</li>`;
          }).join('')
        : '<li class="muted">Geen documenten via API gevonden.</li>';
      parts.push(`
        <section>
          <h4>Documenten (PLU/SUP)</h4>
          <div class="box">
            <ul>${items}</ul>
            <div class="small"><a href="${escapeAttr(summary.gpudoc.links?.gpu_recherche)}" target="_blank" rel="noopener">Zoek in GPU</a></div>
          </div>
        </section>
      `);
    }

    if (summary?.dvf) {
      const dvf = summary.dvf;
      let inner = '<li class="muted">Geen samenvatting beschikbaar (gebruik links)</li>';
      if (dvf.summary?.total) {
        const total = dvf.summary.total;
        inner = `
          <li>Totaal transacties (met waarde): <strong>${escapeHtml(String(total.count))}</strong></li>
          <li>Mediaan prijs: <strong>${fmtMoney(total.median_price)}</strong></li>
          <li>Mediaan €/m²: <strong>${fmtMoney(total.median_eur_m2)}</strong></li>
        `;
      }
      parts.push(`
        <section>
          <h4>DVF (verkoopprijzen)</h4>
          <div class="box">
            <ul>${inner}</ul>
            <div class="small">
              <a href="${escapeAttr(dvf.links?.etalab_app)}" target="_blank" rel="noopener">Open Etalab DVF</a>
              ${dvf.links?.data_gouv_dep_csv ? ` · <a href="${escapeAttr(dvf.links.data_gouv_dep_csv)}" target="_blank" rel="noopener">Departement CSV</a>` : ''}
            </div>
          </div>
        </section>
      `);
    }

    $('#official-data').innerHTML = parts.join('\n');
  }

  function buildSignals(values, summary) {
    const s = {};
    if (values.price && !Number.isNaN(Number(values.price))) s.price = Number(values.price);

    if (summary?.dvf?.summary?.total?.median_price) {
      s.dvf = { median_price: Number(summary.dvf.summary.total.median_price) };
    }

    if (summary?.georisques?.summary) {
      const flags = {};
      for (const item of summary.georisques.summary) flags[item.key] = !!item.present;
      s.georisques = flags;
    }

    if (values.adText) {
      const lower = values.adText.toLowerCase();
      const kw = [];
      const pushIf = (re, label) => { if (re.test(lower)) kw.push(label); };
      pushIf(/\b(dpe|étiquette|classe)\b.*\b(a|b|c)\b/, 'dpe A–C');
      pushIf(/\btriple vitrage\b|\bhr\+\+\b|\bdouble vitrage\b/, 'dubbel/triple glas');
      pushIf(/\bisolati(e|on)|toit isolé|isolation\b/, 'isolatie');
      pushIf(/\bpompe à chaleur\b|heat pump\b/, 'warmtepomp');
      pushIf(/\bà rénover\b|travaux|to renovate\b/, 'renovatie/werk');
      if (kw.length) s.dpe = { hints: kw };
      s.advertentie = { keywords: kw };
    }
    return s;
  }

  function composeDossierText(values, summary) {
    const { adLink, city, price, postcode, street, number, adText } = values;
    const fullAddr = buildFullAddress({ number, street, postcode, city });
    const route = (street || number || postcode) ? 'Route B (adres bekend)' : 'Route A (geen adres)';
    const lines = [];
    lines.push(`[${route}]`);
    lines.push("");
    lines.push("1) Officieel adres / advertentie");
    lines.push(`Invoer: ${fullAddr}`);
    if (price) lines.push(`Vraagprijs: ${price}`);
    if (adLink) lines.push(`Advertentielink: ${adLink}`);
    lines.push("Exact perceelnummer later via notaris opvragen.");
    lines.push("");

    if (summary?.commune) lines.push(`Gemeente: ${summary.commune.name} (INSEE ${summary.commune.insee}, dep. ${summary.commune.department?.code || '-'})`);
    if (summary?.georisques) {
      const hits = (summary.georisques.summary || []).filter(s => s.present).map(s => s.label);
      lines.push(`Géorisques: ${hits.length ? hits.join(', ') : 'geen expliciete categorieën gevonden'}`);
    }
    if (summary?.gpu) {
      const z = summary.gpu.zones || [];
      lines.push(`PLU (zone-urba): ${z.length ? `${z.length} zones` : 'geen polygonen gevonden'}`);
    }
    if (summary?.dvf?.summary?.total) {
      const tot = summary.dvf.summary.total;
      lines.push(`DVF (indicatief): transacties=${tot.count}, mediaan prijs≈${fmtMoney(tot.median_price)}, mediaan €/m²≈${fmtMoney(tot.median_eur_m2)}`);
    }
    lines.push("");
    lines.push("2) Risico's (Géorisques)");
    lines.push(`Controleer risico's voor: ${city || '—'}. ERP nodig (≤ 6 maanden) indien adres bekend.`);
    lines.push("");
    lines.push("3) Verkoopprijzen (DVF)");
    lines.push(`DVF is op gemeenteniveau (gemeente: ${city || '—'}).`);
    lines.push("");
    lines.push("4) Bestemmingsplan (PLU)");
    lines.push("Noteer zone en beperkingen via Géoportail Urbanisme (PLU/SUP).");
    lines.push("");
    if (adText) {
      lines.push("Advertentietekst (volledig):");
      lines.push(adText);
    }
    return lines.join("\n");
  }

  function renderSWOT(swot) {
    const s = swot || { sterke_punten:[], mogelijke_zorgpunten:[], mogelijke_kansen:[], mogelijke_bedreigingen:[] };
    const box = (title, items, extra='') => `
      <div class="swot-cell ${extra}">
        <h4>${title}</h4>
        ${items?.length ? `<ul>${items.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : '<p class="muted">—</p>'}
      </div>
    `;
    return `
      <section>
        <h3>SWOT-matrix</h3>
        <div class="swot-grid">
          ${box('Sterke punten', s.sterke_punten, 'ok')}
          ${box('Mogelijke zorgpunten', s.mogelijke_zorgpunten, 'warn')}
          ${box('Mogelijke kansen', s.mogelijke_kansen)}
          ${box('Mogelijke bedreigingen', s.mogelijke_bedreigingen, 'warn')}
        </div>
      </section>
    `;
  }

  function renderOverview(result) {
    const out = result?.output || {};
    const model = result?.model;
    const throttle = result?.throttleNotice;

    const warningBlock = `
      <div class="alert warn small">
        <strong>Let op:</strong> voorkom een overhaaste “coup de cœur”, een term die makelaars graag gebruiken maar die
        voor de koper risico’s kan inhouden: te snel en op emotie tot een aankoop komen. Weeg rustig af, bepaal de totale
        acquisitiekosten (incl. makelaar en notaris), en plan verbouwingskosten realistisch in. Tip: de koper kan een eigen
        notaris kiezen; de cumulatieve notariskosten blijven doorgaans gelijk.
      </div>
    `;

    const vragen = [
      ...(out.communicatie?.verkoper || []),
      ...(out.communicatie?.notaris || []),
      ...(out.communicatie?.makelaar || []),
    ];

    overviewOut.innerHTML = `
      ${throttle ? `<div class="alert warn">Throttling door Gemini; backoff toegepast. (${escapeHtml(throttle)})</div>` : ''}
      <div class="small muted">Model: <code>${escapeHtml(model || '')}</code> · ${new Date().toLocaleString()}</div>
      ${renderSWOT(out.swot)}
      <h3>Actieplan</h3>
      ${out.actieplan?.length ? `<ul>${out.actieplan.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul>` : '<p class="muted">—</p>'}
      <h3>Vragen & Communicatie</h3>
      ${vragen.length ? `<ul>${vragen.map(v => `<li>${escapeHtml(v)}</li>`).join('')}</ul>` : '<p class="muted">—</p>'}
      ${warningBlock}
    `;
    smoothReveal(overviewPanel);
  }

  async function fetchSummary(city, postcode) {
    const qs = new URLSearchParams();
    if (city) qs.set('city', city);
    if (postcode) qs.set('postcode', postcode);
    return await getJson(`/api/summary?${qs.toString()}`);
  }

  async function handleGenerate() {
    const values = collectInput();
    if (!values.city) { alert('Plaatsnaam is verplicht.'); cityEl?.focus(); return; }

    showSpinner('Dossier wordt opgebouwd…');
    renderDossier(values);

    // Officiële data
    const target = $('#official-data');
    if (target) target.innerHTML = `<div class="alert info">Officiële gegevens worden opgehaald…</div>`;
    const summary = await fetchSummary(values.city, values.postcode);
    if (summary) {
      renderOfficialSummary(summary);
    } else {
      if (target) target.innerHTML = `<div class="alert error"><strong>Fout:</strong> Officiële gegevens konden niet worden opgehaald.</div>`;
    }

    // Analyse
    overviewOut.innerHTML = `<div class="alert info">Analyse wordt gegenereerd…</div>`;
    smoothReveal(overviewPanel);

    const signals = buildSignals(values, summary || {});
    const dossierText = composeDossierText(values, summary || {});
    try {
      const result = await postJson('/api/analyse', { dossier: dossierText, signals });
      renderOverview(result);

      // Zet compose knoppen & export vrij
      ensureExportButtonOnce();
      hideSpinner();
    } catch (err) {
      overviewOut.innerHTML = `<div class="alert error"><strong>Fout:</strong> ${escapeHtml(err.message)}${err.detail ? `<div class="small muted">${escapeHtml(err.detail)}</div>`:''}</div>`;
      hideSpinner();
    }
  }

  // Lock tegen dubbelklikken
  let running = false;
  btnPrimary?.addEventListener('click', async () => {
    if (running) return;
    try {
      running = true;
      btnPrimary.classList.add('is-loading'); btnPrimary.disabled = true;
      await handleGenerate();
    } finally {
      btnPrimary.classList.remove('is-loading'); btnPrimary.disabled = false;
      running = false;
    }
  });

  // Compose (berichten)
  function onCompose(role, rec){ // rec: notary|agent|seller
    return async () => {
      const values = collectInput();
      if (!values.city) { alert('Plaatsnaam is verplicht.'); cityEl?.focus(); return; }

      const channel  = getChannelFor(rec);
      const language = getLanguageFor(rec);
      const summary  = window.__lastSummary || await fetchSummary(values.city, values.postcode);
      const dossierText = `Language: ${language}\nRecipient: ${rec}\n\n` + composeDossierText(values, summary || {});

      try {
        letterOut.innerHTML = `<div class="alert info">Bericht wordt gegenereerd…</div>`;
        const result = await postJson('/api/compose', { role, dossier: dossierText, channel, language });
        const txt = result?.output?.letter_text || '';
        const throttle = result?.throttleNotice;
        letterOut.innerHTML = `
          ${throttle ? `<div class="alert warn">Throttling door Gemini; backoff toegepast. (${escapeHtml(throttle)})</div>` : ''}
          <pre class="letter">${escapeHtml(txt)}</pre>
          <div class="small muted">Model: <code>${escapeHtml(result?.model || '')}</code></div>
        `;
        smoothReveal(letterPanel);
      } catch (err) {
        letterOut.innerHTML = `<div class="alert error"><strong>Fout:</strong> ${escapeHtml(err.message)}</div>`;
        smoothReveal(letterPanel);
      }
    };
  }
  btnNotary?.addEventListener('click', onCompose('notary-fr','notary'));
  btnAgent ?.addEventListener('click', onCompose('agent-nl','agent'));
  btnSeller?.addEventListener('click', onCompose('seller-mixed','seller'));

  // Export (PDF/print) – verschijnt na analyse
  let btnExport = null;
  function ensureExportButtonOnce() {
    if (btnExport) return;
    btnExport = document.createElement('button');
    btnExport.id = 'btn-export';
    btnExport.className = 'btn';
    btnExport.textContent = 'Exporteer rapport (PDF/print)';
    const actions = document.querySelector('.actions');
    if (actions) {
      actions.insertAdjacentElement('afterend', btnExport);
    } else {
      document.body.appendChild(btnExport);
    }
    btnExport.addEventListener('click', () => {
      const values = collectInput();
      const summary = window.__lastSummary || null;
      const html = buildPrintableReport(values, summary, overviewOut.innerHTML || '');
      const w = window.open('', '_blank');
      if (!w) return alert('Pop-up geblokkeerd: sta pop-ups toe voor export.');
      w.document.open(); w.document.write(html); w.document.close(); w.focus(); w.print();
    });
  }

  function extractSection(html, headingRegex) {
    if (!html) return '';
    const idx = html.search(headingRegex);
    if (idx < 0) return '';
    const after = html.slice(idx);
    const next = after.indexOf('<h3');
    const chunk = next > 0 ? after.slice(0, next) : after;
    return chunk.replace(/^[\s\S]*?<\/h3>/i, '').trim();
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
        const badge = s.present ? '✅' : '—'; const cls = s.present ? 'ok' : 'muted';
        return `<li><span class="badge ${cls}">${badge}</span> ${escapeHtml(s.label)}</li>`;
      }).join('') || '<li class="muted">Geen categorieën gevonden</li>';
      parts.push(`<h3>Géorisques</h3><div class="box"><ul class="badgelist">${items}</ul></div>`);
    }
    if (summary.gpu) {
      const z = summary.gpu.zones || [];
      const items = z.length
        ? z.map(item => `<li>${escapeHtml(item.code || item.label || 'Zone')} <span class="small muted">×${item.count}</span></li>`).join('')
        : '<li class="muted">Geen zone-urba polygonen aangetroffen (mogelijk RNU of alleen documenten).</li>';
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

    const swotSection = extractSection(overviewHtml, /SWOT-matrix/i);
    const actions     = extractSection(overviewHtml, /Actieplan/i);
    const comms       = extractSection(overviewHtml, /Vragen & Communicatie/i);
    const omgeving    = renderOfficialSummaryToStatic(summary);

    const waarschuwing = `
      <p><strong>Waarschuwing:</strong> voorkom een overhaaste “coup de cœur”, een term die makelaars graag gebruiken maar
      die voor de koper risico’s kan inhouden: te snel en op emotie tot een aankoop komen. Weeg rustig af, bepaal de totale
      acquisitiekosten (inclusief makelaars- en notariskosten) en plan verbouwingskosten realistisch in. Tip: de koper kan een
      eigen notaris kiezen; de cumulatieve notariskosten blijven doorgaans gelijk.</p>
      <p class="small muted">Disclaimer: Deze analyse is indicatief en informatief. Raadpleeg notaris, makelaar en de officiële
      bronnen (Géorisques, DVF, Géoportail-Urbanisme). Aan deze tool kunnen geen rechten worden ontleend.</p>
    `;

    const style = `
      <style>
        :root { --brand:#800000; --ink:#222; --muted:#666; --ok:#0a7f00; --warn:#b00020; }
        body { font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: var(--ink); margin: 2rem; }
        .container { max-width: 780px; margin: 0 auto; }
        h1 { font-size: 26px; margin: 0 0 4px; color: var(--brand); }
        h2 { font-size: 18px; margin: 20px 0 6px; }
        h3 { font-size: 16px; margin: 16px 0 6px; }
        h4 { font-size: 14px; margin: 10px 0 6px; }
        .muted { color: var(--muted); }
        .small { font-size: 12px; }
        .ok { color: var(--ok); }
        .warn { color: var(--warn); }
        .box { border: 1px solid #ddd; border-radius: 6px; padding: 10px 12px; margin: 8px 0; }
        ul { margin: 6px 0 6px 20px; }
        .badgelist { list-style: none; margin: 0; padding: 0; }
        .badge { display: inline-block; width: 1.4em; text-align: center; margin-right: 6px; }
        .hr { height: 1px; background: #ddd; margin: 24px 0; }
        .swot-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .swot-cell { border: 1px solid #ddd; border-radius: 6px; padding: 10px 12px; }
        .swot-cell.ok h4 { color: var(--ok); }
        .swot-cell.warn h4 { color: var(--warn); }
        @media print { a { color: inherit; text-decoration: none; } .hr { break-after: page; height:0; border:none; } }
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
  <div class="box">
    ${swotSection || '<p class="muted">—</p>'}
  </div>

  <div class="hr"></div>

  <h2>Waarschuwing & Disclaimer</h2>
  <div class="box">${waarschuwing}</div>
</div></body></html>`;
  }
});
// /public/script.js
// Immodiagnostique – UX-polish + PDF: waarschuwingstekst bijgewerkt (geen “coup de cœur”-paragraaf uit de UI)
// - PDF bevat aangepaste waarschuwing (neutraler en met uitleg), UI bevat alleen korte disclaimer.

window.addEventListener('DOMContentLoaded', () => {
  const $  = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // Invoer
  const adLinkEl   = $('#adLink');
  const cityEl     = $('#city');
  const priceEl    = $('#price');
  const postcodeEl = $('#postcode');
  const streetEl   = $('#street');
  const numberEl   = $('#number');
  const adTextEl   = $('#adText');

  // Knoppen/panels
  const btnPrimary = $('#btn-generate');
  const composeSection = document.querySelector('.compose');
  const btnNotary = $('#btn-notary');
  const btnAgent  = $('#btn-agent');
  const btnSeller = $('#btn-seller');

  const dossierPanel  = $('#dossier-panel');
  const dossierOut    = $('#dossier-output');
  const overviewPanel = $('#overview-panel');
  const overviewOut   = $('#overview-output');
  const letterPanel   = $('#letter-panel');
  const letterOut     = $('#letter-output');

  // Disclaimer op pagina laten staan (korte versie); geen extra blokken nodig

  // Compose pas tonen na analyse
  if (composeSection) composeSection.setAttribute('hidden', '');

  // Styling injectie (knoppen/progress etc.)
  if (!document.querySelector('style[data-ux]')) {
    const style = document.createElement('style');
    style.setAttribute('data-ux','1');
    style.textContent = `
      :root { --brand: #800000; --ink:#222; --muted:#666; --ok:#0a7f00; --warn:#b00020; }
      .btn{ background: var(--brand); color:#fff; border:0; border-radius:8px; padding:10px 14px; cursor:pointer; font-weight:700; }
      .btn.is-loading{ opacity:.75; pointer-events:none; }
      .btn.btn-primary{ padding:12px 18px; font-size:15px; }
      .compose-row .btn{ padding:8px 10px; font-weight:600; }
      .progress { height: 10px; background:#eee; border-radius:999px; overflow:hidden; margin:10px 0; }
      .progress-bar { height:100%; width:0%; background: var(--brand); transition: width .4s ease; }
      .progress-wrap { display:none; }
      .progress-wrap.active { display:block; }
      .progress-label { font-size:12px; color: var(--muted); margin-top:4px; }
      .swot-grid { display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
      .swot-cell { border:1px solid #e6e6e6; border-radius:8px; padding:10px 12px; }
      .swot-cell.ok h4{ color:#0a7f00; }
      .swot-cell.warn h4{ color:#b00020; }
      .badgelist { list-style:none; margin:0; padding:0; }
      .badge { display:inline-block; width:1.4em; text-align:center; margin-right:6px; }
      .muted { color:#666; } .tiny { font-size:12px; }
      .spacer-lg{ height:16px; }
      .alert.info{ border:1px solid #cfe3ff; background:#f4f8ff; padding:8px 10px; border-radius:6px; }
      .alert.warn{ border:1px solid #ffe0a3; background:#fff8e6; padding:8px 10px; border-radius:6px; }
      .alert.error{ border:1px solid #f3b5b5; background:#fff5f5; padding:8px 10px; border-radius:6px; }
      .letter{ white-space: pre-wrap; }
    `;
    document.head.appendChild(style);
  }

  // Voortgangsbalk
  const progressWrap = document.createElement('div');
  progressWrap.className = 'progress-wrap';
  progressWrap.innerHTML = `
    <div class="progress"><div class="progress-bar" id="progress-bar" style="width:0%"></div></div>
    <div class="progress-label" id="progress-label">Starten…</div>
  `;
  const actionsSection = document.querySelector('.actions');
  if (actionsSection) {
    actionsSection.insertAdjacentElement('afterend', progressWrap);
    const spacer = document.createElement('div');
    spacer.className = 'spacer-lg';
    progressWrap.insertAdjacentElement('afterend', spacer);
  }
  const progressBar   = $('#progress-bar');
  const progressLabel = $('#progress-label');
  function setProgress(pct, label){
    if (progressBar) progressBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (progressLabel) progressLabel.textContent = label || '';
  }
  function showProgress(){ progressWrap.classList.add('active'); setProgress(5, 'Bezig met starten…'); }
  function hideProgress(){ progressWrap.classList.remove('active'); }

  // Utils
  const sanitize = (s) => String(s || '').trim();
  const getChannel = () => (document.querySelector('input[name="channel"]:checked')?.value) || 'email';
  const escapeHtml = (str='') => str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);
  const escapeAttr = (v) => escapeHtml(String(v || ''));
  const fmtMoney = (n) => (n==null||n==='') ? '—' : new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(Number(n));

  function buildFullAddress({ number, street, postcode, city }) {
    const parts = [];
    if (sanitize(number)) parts.push(sanitize(number));
    if (sanitize(street)) parts.push(sanitize(street));
    if (sanitize(postcode)) parts.push(sanitize(postcode));
    if (sanitize(city)) parts.push(sanitize(city));
    return parts.join(' ') || '—';
  }

  function collectInput() {
    return {
      adLink:   sanitize(adLinkEl?.value),
      city:     sanitize(cityEl?.value),
      price:    sanitize(priceEl?.value),
      postcode: sanitize(postcodeEl?.value),
      street:   sanitize(streetEl?.value),
      number:   sanitize(numberEl?.value),
      adText:   sanitize(adTextEl?.value),
      channel:  getChannel(),
    };
  }

  function smoothReveal(panel) {
    if (panel && panel.hasAttribute('hidden')) panel.removeAttribute('hidden');
    panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Render basis-dossier
  function renderDossier(values) {
    const { adLink, city, price } = values;
    const fullAddr = buildFullAddress(values);

    $('#dossier-output').innerHTML = `
      <ol class="checklist">
        <li>
          <strong>1. Officieel adres / advertentie</strong>
          <div class="box">
            <div><em>Invoer:</em><br>${escapeHtml(fullAddr)}</div>
            ${price ? `<div class="note">Vraagprijs: <strong>${escapeHtml(price)}</strong></div>` : ''}
            <div class="note">Exact perceel later opvragen bij notaris.</div>
            ${adLink ? `<div class="note">Advertentielink: <code>${escapeHtml(adLink)}</code></div>` : ''}
          </div>
        </li>
        <li>
          <strong>2. Risico's (Géorisques)</strong>
          <div class="box">
            Controleer risico's voor: <code>${escapeHtml(city || '—')}</code><br>
            <span class="note">ERP (≤ 6 maanden) vereist als adres bekend is.</span>
          </div>
        </li>
        <li>
          <strong>3. Verkoopprijzen (DVF)</strong>
          <div class="box">
            DVF is op gemeenteniveau (gemeente: <code>${escapeHtml(city || '—')}</code>).
          </div>
        </li>
        <li>
          <strong>4. Bestemmingsplan (PLU)</strong>
          <div class="box">
            Noteer zone & beperkingen via Géoportail Urbanisme (PLU/SUP).
          </div>
        </li>
      </ol>
      <div id="official-data"></div>
    `;
    smoothReveal(dossierPanel);
  }

  async function fetchSummary(city, postcode) {
    try {
      const qs = new URLSearchParams();
      if (city) qs.set('city', city);
      if (postcode) qs.set('postcode', postcode);
      const res = await fetch(`/api/summary?${qs.toString()}`, { headers: { 'Accept': 'application/json' } });
      const data = (res.headers.get('content-type')||'').includes('application/json') ? await res.json() : null;
      if (!res.ok || !data?.ok) return null;
      renderOfficialSummary(data);
      window.__lastSummary = data;
      return data;
    } catch { return null; }
  }

  function renderOfficialSummary(summary) {
    const mount = $('#official-data');
    if (!mount) return;

    const parts = [];

    if (summary?.commune) {
      const c = summary.commune;
      parts.push(`
        <section>
          <h3>Gegevens uit officiële bronnen</h3>
          <div class="box">
            <div><strong>Gemeente:</strong> ${escapeHtml(c.name || '')} (INSEE: <code>${escapeHtml(c.insee || '')}</code>)</div>
            <div class="tiny muted">Departement: ${escapeHtml(c.department?.name || '')} (${escapeHtml(c.department?.code || '')})</div>
          </div>
        </section>
      `);
    }

    if (summary?.georisques) {
      const gr = summary.georisques;
      const items = (gr.summary || []).map(s => {
        const badge = s.present ? '✅' : '—';
        const cls = s.present ? 'ok' : 'muted';
        return `<li><span class="badge ${cls}">${badge}</span> ${escapeHtml(s.label)}</li>`;
      }).join('') || '<li class="muted">Geen categorieën gevonden</li>';
      parts.push(`
        <section>
          <h4>Géorisques</h4>
          <div class="box">
            <ul class="badgelist">${items}</ul>
            <div class="tiny"><a href="${escapeAttr(gr.links?.commune)}" target="_blank" rel="noopener">Open Géorisques (commune)</a></div>
          </div>
        </section>
      `);
    }

    if (summary?.gpu) {
      const z = summary.gpu.zones || [];
      const items = z.length
        ? z.map(item => `<li>${escapeHtml(item.code || item.label || 'Zone')} <span class="tiny muted">×${item.count}</span></li>`).join('')
        : '<li class="muted">Geen zone-urba polygonen aangetroffen (mogelijk RNU of alleen documenten).</li>';
      parts.push(`
        <section>
          <h4>Géoportail Urbanisme (PLU/SUP)</h4>
          <div class="box">
            <ul>${items}</ul>
            <div class="tiny">
              <a href="${escapeAttr(summary.gpu.links?.gpu_site_commune)}" target="_blank" rel="noopener">Open GPU (gemeente)</a>
            </div>
          </div>
        </section>
      `);
    }

    if (summary?.gpudoc) {
      const docs = summary.gpudoc.documents || [];
      const items = docs.length
        ? docs.map(d => {
            const t = [d.type, d.title].filter(Boolean).join(' — ');
            const date = d.date ? `<span class="tiny muted"> (${escapeHtml(d.date)})</span>` : '';
            return `<li><a href="${escapeAttr(d.url)}" target="_blank" rel="noopener">${escapeHtml(t || 'Document')}</a>${date}</li>`;
          }).join('')
        : '<li class="muted">Geen documenten via API gevonden.</li>';

      parts.push(`
        <section>
          <h4>Documenten (PLU/SUP)</h4>
          <div class="box">
            <ul>${items}</ul>
            <div class="tiny">
              <a href="${escapeAttr(summary.gpudoc.links?.gpu_recherche)}" target="_blank" rel="noopener">Zoek in GPU</a>
            </div>
          </div>
        </section>
      `);
    }

    if (summary?.dvf) {
      const dvf = summary.dvf;
      let inner = '<li class="muted">Geen samenvatting beschikbaar (gebruik links)</li>';
      if (dvf.summary?.total) {
        const total = dvf.summary.total;
        inner = `
          <li>Totaal transacties (met waarde): <strong>${escapeHtml(String(total.count))}</strong></li>
          <li>Mediaan prijs: <strong>${fmtMoney(total.median_price)}</strong></li>
          <li>Mediaan €/m²: <strong>${fmtMoney(total.median_eur_m2)}</strong></li>
        `;
      }
      parts.push(`
        <section>
          <h4>DVF (verkoopprijzen)</h4>
        <div class="box">
          <ul>${inner}</ul>
          <div class="tiny">
            <a href="${escapeAttr(dvf.links?.etalab_app)}" target="_blank" rel="noopener">Open Etalab DVF</a>
            ${dvf.links?.data_gouv_dep_csv ? ` · <a href="${escapeAttr(dvf.links.data_gouv_dep_csv)}" target="_blank" rel="noopener">Departement CSV</a>` : ''}
          </div>
        </div>
      </section>`);
    }

    mount.innerHTML = parts.join('\n');
  }

  function buildSignals(values, summary) {
    const s = {};
    if (values.price && !Number.isNaN(Number(values.price))) s.price = Number(values.price);
    if (summary?.dvf?.summary?.total?.median_price) s.dvf = { median_price: Number(summary.dvf.summary.total.median_price) };
    if (summary?.georisques?.summary) {
      const flags = {};
      for (const item of summary.georisques.summary) flags[item.key] = !!item.present;
      s.georisques = flags;
    }
    if (values.adText) {
      const lower = values.adText.toLowerCase();
      const kw = [];
      const pushIf = (re, label) => { if (re.test(lower)) kw.push(label); };
      pushIf(/\b(dpe|étiquette|classe)\b.*\b(a|b|c)\b/, 'dpe A–C');
      pushIf(/\btriple vitrage\b|\bhr\+\+\b|\bdouble vitrage\b/, 'dubbel/triple glas');
      pushIf(/\bisolati(e|on)|toit isolé|isolation\b/, 'isolatie');
      pushIf(/\bpompe à chaleur\b|heat pump\b/, 'warmtepomp');
      pushIf(/\bà rénover\b|travaux|to renovate\b/, 'renovatie/werk');
      if (kw.length) s.dpe = { hints: kw };
      s.advertentie = { keywords: kw };
    }
    return s;
  }

  async function postJson(url, payload) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) {
      if (res.status === 429) throw new Error('429: Gesmoord door rate-limit. Server past backoff toe; probeer het zo meteen opnieuw.');
      const msg = (ct.includes('application/json') && (data.error || data.message)) || `HTTP ${res.status}`;
      const e = new Error(msg); e.detail = ct.includes('application/json') ? JSON.stringify(data) : String(data); throw e;
    }
    return data;
  }

  function withLock(el, fn) {
    const busy = new Set();
    return async (...args) => {
      const id = el?.id || 'primary';
      if (busy.has(id)) return;
      try {
        busy.add(id);
        if (el) { el.disabled = true; el.classList.add('is-loading'); }
        return await fn(...args);
      } finally {
        if (el) { el.disabled = false; el.classList.remove('is-loading'); }
        busy.delete(id);
      }
    };
  }

  function renderSWOT(swot) {
    const s = swot || { sterke_punten:[], mogelijke_zorgpunten:[], mogelijke_kansen:[], mogelijke_bedreigingen:[] };
    const box = (title, items, extraClass='') => `
      <div class="swot-cell ${extraClass}">
        <h4>${title}</h4>
        ${items?.length ? `<ul>${items.map(li => `<li>${escapeHtml(li)}</li>`).join('')}</ul>` : '<p class="muted">—</p>'}
      </div>
    `;
    return `
      <section>
        <h3>SWOT-matrix</h3>
        <div class="swot-grid">
          ${box('Sterke punten', s.sterke_punten, 'ok')}
          ${box('Mogelijke zorgpunten', s.mogelijke_zorgpunten, 'warn')}
          ${box('Mogelijke kansen', s.mogelijke_kansen)}
          ${box('Mogelijke bedreigingen', s.mogelijke_bedreigingen, 'warn')}
        </div>
      </section>
    `;
  }

  function renderOverview(result) {
    const out = result?.output || {};
    const model = result?.model;
    const throttle = result?.throttleNotice;

    // Voeg de gevraagde (neutrale) waarschuwing toe in de analyseweergave
    const warningBlock = `
      <div class="alert warn tiny">
        <strong>Let op:</strong> voorkom een overhaaste “coup de cœur”, een term die makelaars graag gebruiken maar
        die voor de koper risico’s kan inhouden: te snel en op emotie tot aankoop komen. Weeg rustig af, bepaal de
        totale acquisitiekosten (incl. makelaar en notaris), en plan verbouwingskosten realistisch in. Tip: de koper kan
        een eigen notaris kiezen; de cumulatieve notariskosten blijven doorgaans gelijk.
      </div>
    `;

    const vragen = [
      ...(out.communicatie?.verkoper || []),
      ...(out.communicatie?.notaris || []),
      ...(out.communicatie?.makelaar || []),
    ];

    overviewOut.innerHTML = `
      ${throttle ? `<div class="alert warn">Throttling door Gemini; backoff toegepast. (${escapeHtml(throttle)})</div>` : ''}
      <div class="kv tiny muted">Model: <code>${escapeHtml(model || '')}</code> · ${new Date().toLocaleString()}</div>

      ${renderSWOT(out.swot)}

      <h3>Actieplan</h3>
      ${out.actieplan?.length ? `<ul>${out.actieplan.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul>` : '<p class="muted">—</p>'}

      <h3>Vragen & Communicatie</h3>
      ${vragen.length ? `<ul>${vragen.map(v => `<li>${escapeHtml(v)}</li>`).join('')}</ul>` : '<p class="muted">—</p>'}

      ${warningBlock}
    `;
    smoothReveal(overviewPanel);
  }

  // Compose
  function getChannel(){ return (document.querySelector('input[name="channel"]:checked')?.value) || 'email'; }
  function updateCTALabelsForChannel() {
    const channel = getChannel();
    const word = channel === 'letter' ? 'brief' : channel === 'phone' ? 'belscript' : 'bericht';
    if (btnNotary) btnNotary.textContent = word === 'belscript' ? 'Maak belscript voor notaris (FR)' : `Maak ${word} voor notaris (FR)`;
    if (btnAgent)  btnAgent.textContent  = word === 'belscript' ? 'Maak belscript voor makelaar (NL)' : `Maak ${word} voor makelaar (NL)`;
    if (btnSeller) btnSeller.textContent = word === 'belscript' ? 'Maak belscript voor verkoper (FR/NL)' : `Maak ${word} aan verkoper (FR/NL)`;
  }
  $$('.channel input[name="channel"]').forEach(r => r.addEventListener('change', updateCTALabelsForChannel));
  updateCTALabelsForChannel();

  function onCompose(role) {
    const btn = role === 'notary-fr' ? btnNotary : role === 'agent-nl' ? btnAgent : btnSeller;
    return withLock(btn, async () => {
      const values = collectInput();
      if (!values.city) { alert('Plaatsnaam is verplicht.'); cityEl?.focus(); return; }
      const summary = window.__lastSummary || await fetchSummary(values.city, values.postcode);
      const dossierText = composeDossierText(values, summary);

      try {
        letterOut.innerHTML = `<div class="alert info">Bericht wordt gegenereerd…</div>`;
        const result = await postJson('/api/compose', { role, dossier: dossierText, channel: values.channel });
        const txt = result?.output?.letter_text || '';
        const throttle = result?.throttleNotice;
        letterOut.innerHTML = `
          ${throttle ? `<div class="alert warn">Throttling door Gemini; backoff toegepast. (${escapeHtml(throttle)})</div>` : ''}
          <pre class="letter">${escapeHtml(txt)}</pre>
          <div class="kv tiny muted">Model: <code>${escapeHtml(result?.model || '')}</code></div>
        `;
        smoothReveal(letterPanel);
      } catch (err) {
        letterOut.innerHTML = `<div class="alert error"><strong>Fout:</strong> ${escapeHtml(err.message)}</div>`;
        smoothReveal(letterPanel);
      }
    });
  }
  btnNotary?.addEventListener('click', onCompose('notary-fr'));
  btnAgent?.addEventListener('click', onCompose('agent-nl'));
  btnSeller?.addEventListener('click', onCompose('seller-mixed'));

  function composeDossierText(values, summary) {
    const { adLink, city, price, postcode, street, number, adText } = values;
    const fullAddr = buildFullAddress({ number, street, postcode, city });
    const route = (street || number || postcode) ? 'Route B (adres bekend)' : 'Route A (geen adres)';
    const lines = [];
    lines.push(`[${route}]`);
    lines.push("");
    lines.push("1) Officieel adres / advertentie");
    lines.push(`Invoer: ${fullAddr}`);
    if (price) lines.push(`Vraagprijs: ${price}`);
    if (adLink) lines.push(`Advertentielink: ${adLink}`);
    lines.push("Exact perceelnummer later via notaris opvragen.");
    lines.push("");

    if (summary?.commune) lines.push(`Gemeente: ${summary.commune.name} (INSEE ${summary.commune.insee}, dep. ${summary.commune.department?.code || '-'})`);
    if (summary?.georisques) {
      const hits = (summary.georisques.summary || []).filter(s => s.present).map(s => s.label);
      lines.push(`Géorisques: ${hits.length ? hits.join(', ') : 'geen expliciete categorieën gevonden'}`);
    }
    if (summary?.gpu) {
      const z = summary.gpu.zones || [];
      lines.push(`PLU (zone-urba): ${z.length ? `${z.length} zones` : 'geen polygonen gevonden'}`);
    }
    if (summary?.dvf?.summary?.total) {
      const tot = summary.dvf.summary.total;
      lines.push(`DVF (indicatief): transacties=${tot.count}, mediaan prijs≈${fmtMoney(tot.median_price)}, mediaan €/m²≈${fmtMoney(tot.median_eur_m2)}`);
    }
    lines.push("");
    lines.push("2) Risico's (Géorisques)");
    lines.push(`Controleer risico's voor: ${city || '—'}. ERP nodig (≤ 6 maanden) indien adres bekend.`);
    lines.push("");
    lines.push("3) Verkoopprijzen (DVF)");
    lines.push(`DVF is op gemeenteniveau (gemeente: ${city || '—'}).`);
    lines.push("");
    lines.push("4) Bestemmingsplan (PLU)");
    lines.push("Noteer zone en beperkingen via Géoportail Urbanisme (PLU/SUP).");
    lines.push("");
    if (adText) {
      lines.push("Advertentietekst (volledig):");
      lines.push(adText);
    }
    return lines.join("\n");
  }

  // Primaire CTA
  btnPrimary?.addEventListener('click', withLock(btnPrimary, async () => {
    const values = collectInput();
    if (!values.city) { alert('Plaatsnaam is verplicht.'); cityEl?.focus(); return; }

    showProgress(); setProgress(10, 'Basis wordt opgebouwd…');
    renderDossier(values);

    const target = $('#official-data');
    if (target) target.innerHTML = `<div class="alert info">Officiële gegevens worden opgehaald…</div>`;
    setProgress(45, 'Officiële gegevens ophalen…');
    const summary = await fetchSummary(values.city, values.postcode);

    setProgress(70, 'Analyse genereren…');
    overviewOut.innerHTML = `<div class="alert info">Analyse wordt gegenereerd…</div>`;
    smoothReveal(overviewPanel);

    const signals = buildSignals(values, summary);
    const dossierText = composeDossierText(values, summary);

    try {
      const result = await postJson('/api/analyse', { dossier: dossierText, signals });
      renderOverview(result);
      setProgress(100, 'Gereed');

      if (composeSection) composeSection.removeAttribute('hidden');
      ensureExportButtonOnce();
    } catch (err) {
      overviewOut.innerHTML = `<div class="alert error"><strong>Fout:</strong> ${escapeHtml(err.message)}${err.detail ? `<div class="tiny muted">${escapeHtml(err.detail)}</div>` : ''}</div>`;
    } finally {
      setTimeout(() => hideProgress(), 600);
    }
  }));

  // Export
  let btnExport = null;
  function ensureExportButtonOnce() {
    if (btnExport) return;
    btnExport = document.createElement('button');
    btnExport.id = 'btn-export';
    btnExport.className = 'btn';
    btnExport.textContent = 'Exporteer rapport (PDF/print)';
    const actions = document.querySelector('.actions');
    if (actions) {
      const spacer = document.createElement('div'); spacer.className = 'spacer-lg';
      actions.insertAdjacentElement('afterend', spacer);
      spacer.insertAdjacentElement('afterend', btnExport);
    } else {
      document.body.appendChild(btnExport);
    }
    btnExport.addEventListener('click', () => {
      const values = collectInput();
      const summary = window.__lastSummary || null;
      const overviewHtml = overviewOut.innerHTML || '';
      const html = buildPrintableReport(values, summary, overviewHtml);
      const w = window.open('', '_blank');
      if (!w) return alert('Pop-up geblokkeerd: sta pop-ups tijdelijk toe voor export.');
      w.document.open(); w.document.write(html); w.document.close(); w.focus(); w.print();
    });
  }

  function extractSection(html, headingRegex) {
    if (!html) return '';
    const idx = html.search(headingRegex);
    if (idx < 0) return '';
    const after = html.slice(idx);
    const next = after.indexOf('<h3');
    const chunk = next > 0 ? after.slice(0, next) : after;
    return chunk.replace(/^[\s\S]*?<\/h3>/i, '').trim();
  }

  function renderOfficialSummaryToStatic(summary) {
    if (!summary) return `<div class="box"><p class="muted">Geen officiële gegevens opgehaald.</p></div>`;
    const parts = [];
    if (summary.commune) {
      parts.push(`
        <h3>Gemeente</h3>
        <div class="box">
          <div><strong>${escapeHtml(summary.commune.name)}</strong> (INSEE ${escapeHtml(summary.commune.insee)})</div>
          <div class="tiny muted">Departement: ${escapeHtml(summary.commune.department?.name || '')} (${escapeHtml(summary.commune.department?.code || '')})</div>
        </div>
      `);
    }
    if (summary.georisques) {
      const items = (summary.georisques.summary || []).map(s => {
        const badge = s.present ? '✅' : '—'; const cls = s.present ? 'ok' : 'muted';
        return `<li><span class="badge ${cls}">${badge}</span> ${escapeHtml(s.label)}</li>`;
      }).join('') || '<li class="muted">Geen categorieën gevonden</li>';
      parts.push(`<h3>Géorisques</h3><div class="box"><ul class="badgelist">${items}</ul></div>`);
    }
    if (summary.gpu) {
      const z = summary.gpu.zones || [];
      const items = z.length
        ? z.map(item => `<li>${escapeHtml(item.code || item.label || 'Zone')} <span class="tiny muted">×${item.count}</span></li>`).join('')
        : '<li class="muted">Geen zone-urba polygonen aangetroffen (mogelijk RNU of alleen documenten).</li>';
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

    const swotSection = extractSection(overviewHtml, /SWOT-matrix/i);
    const actions     = extractSection(overviewHtml, /Actieplan/i);
    const comms       = extractSection(overviewHtml, /Vragen & Communicatie/i);
    const omgeving    = renderOfficialSummaryToStatic(summary);

    // Bijgewerkte waarschuwingstekst (géén oude coup-de-cœur-paragraaf)
    const waarschuwing = `
      <p><strong>Waarschuwing:</strong> voorkom een overhaaste “coup de cœur”, een term die makelaars graag gebruiken maar
      die voor de koper risico’s kan inhouden: te snel en op emotie tot een aankoop komen. Weeg rustig af, bepaal de totale
      acquisitiekosten (inclusief makelaars- en notariskosten) en plan verbouwingskosten realistisch in. Tip: de koper kan een
      eigen notaris kiezen; de cumulatieve notariskosten blijven doorgaans gelijk.</p>
      <p class="tiny muted">Disclaimer: Deze analyse is indicatief en informatief. Raadpleeg notaris, makelaar en de officiële
      bronnen (Géorisques, DVF, Géoportail-Urbanisme). Aan deze tool kunnen geen rechten worden ontleend.</p>
    `;

    const style = `
      <style>
        :root { --brand:#800000; --ink:#222; --muted:#666; --ok:#0a7f00; --warn:#b00020; }
        body { font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: var(--ink); margin: 2rem; }
        .container { max-width: 780px; margin: 0 auto; }
        h1 { font-size: 26px; margin: 0 0 4px; color: var(--brand); }
        h2 { font-size: 18px; margin: 20px 0 6px; }
        h3 { font-size: 16px; margin: 16px 0 6px; }
        h4 { font-size: 14px; margin: 10px 0 6px; }
        .muted { color: var(--muted); }
        .tiny { font-size: 12px; }
        .ok { color: var(--ok); }
        .warn { color: var(--warn); }
        .box { border: 1px solid #ddd; border-radius: 6px; padding: 10px 12px; margin: 8px 0; }
        ul { margin: 6px 0 6px 20px; }
        .badgelist { list-style: none; margin: 0; padding: 0; }
        .badgelist li { margin: 2px 0; }
        .badge { display: inline-block; width: 1.4em; text-align: center; margin-right: 6px; }
        .hr { height: 1px; background: #ddd; margin: 24px 0; }
        .swot-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .swot-cell { border: 1px solid #ddd; border-radius: 6px; padding: 10px 12px; }
        .swot-cell.ok h4 { color: var(--ok); }
        .swot-cell.warn h4 { color: var(--warn); }
        @media print { a { color: inherit; text-decoration: none; } .hr { break-after: page; height:0; border:none; } }
      </style>
    `;

    return `
<!DOCTYPE html>
<html lang="nl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${style}</head>
<body><div class="container">
  <h1>IMMODIAGNOSTIQUE – Rapport</h1>
  <div class="tiny muted">Datum: ${escapeHtml(today)}</div>
  <div class="hr"></div>

  <h2>1. Vastgoeddossier</h2>
  <div class="box">
    <div><strong>Adres/advertentie:</strong> ${escapeHtml(addr)}</div>
    ${values.price ? `<div><strong>Vraagprijs:</strong> ${escapeHtml(values.price)}</div>` : ``}
    ${values.adLink ? `<div><strong>Advertentielink:</strong> <code>${escapeHtml(values.adLink)}</code></div>` : ``}
    <div class="tiny muted">Exact perceelnummer later bij de notaris opvragen.</div>
  </div>

  <h2>2. Omgevingsdossier (officiële bronnen)</h2>
  ${omgeving}

  <h2>3. Actieplan</h2>
  <div class="box">${actions || '<p class="muted">—</p>'}</div>

  <h3>Communicatie & Vragen</h3>
  <div class="box">${comms || '<p class="muted">—</p>'}</div>

  <div class="hr"></div>

  <h2>Bijlage A – SWOT-matrix</h2>
  <div class="box">
    ${swotSection || '<p class="muted">—</p>'}
  </div>

  <div class="hr"></div>

  <h2>Waarschuwing & Disclaimer</h2>
  <div class="box">${waarschuwing}</div>
</div></body></html>`;
  }
});
