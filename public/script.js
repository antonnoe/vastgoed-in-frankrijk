// /public/script.js
// Immodiagnostique – zichtbare voortgang per stap (geen tijdschattingen)
// - Spinner toont nu: "Raadpleegt gemeente", "Raadpleegt Géorisques", "Raadpleegt GPU", "Raadpleegt GPU-documenten", "Raadpleegt DVF", "Genereert AI-analyse"
// - Samenvatting wordt incrementeel opgebouwd: resultaten renderen zodra een stap klaar is
// - Compose & Export komen pas na analyse beschikbaar

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

  // ===== Loader / voortgang =====
  function setSpinner(msg){
    if (!loader) return;
    loader.querySelector('.spinner-label').textContent = msg || 'Bezig…';
    loader.removeAttribute('hidden');
  }
  function hideSpinner(){
    loader?.setAttribute('hidden', '');
  }

  // ===== HTTP =====
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
    if (!res.ok || !data?.ok) return null;
    return data;
  }

  // ===== Rendering =====
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
    if (dossierPanel.hasAttribute('hidden')) dossierPanel.removeAttribute('hidden');
  }

  function appendOfficialSection(html) {
    const mount = $('#official-data');
    if (!mount) return;
    const div = document.createElement('div');
    div.innerHTML = html;
    mount.appendChild(div);
  }

  function renderCommune(c) {
    appendOfficialSection(`
      <section>
        <h3>Gegevens uit officiële bronnen</h3>
        <div class="box">
          <div><strong>Gemeente:</strong> ${escapeHtml(c.name || '')} (INSEE: <code>${escapeHtml(c.insee || '')}</code>)</div>
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
          <div class="small">
            <a href="${escapeAttr(gr.links?.commune)}" target="_blank" rel="noopener">Open Géorisques (commune)</a>
          </div>
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
          <div class="small">
            <a href="${escapeAttr(gpu.links?.gpu_site_commune)}" target="_blank" rel="noopener">Open GPU (gemeente)</a>
          </div>
        </div>
      </section>
    `);
  }

  function renderGPUDoc(gpudoc) {
    const docs = gpudoc.documents || [];
    const items = docs.length
      ? docs.map(d => {
          const t = [d.type, d.title].filter(Boolean).join(' — ');
          const date = d.date ? `<span class="small muted"> (${escapeHtml(d.date)})</span>` : '';
          return `<li><a href="${escapeAttr(d.url)}" target="_blank" rel="noopener">${escapeHtml(t || 'Document')}</a>${date}</li>`;
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
      const total = dvf.summary.total;
      inner = `
        <li>Totaal transacties (met waarde): <strong>${escapeHtml(String(total.count))}</strong></li>
        <li>Mediaan prijs: <strong>${fmtMoney(total.median_price)}</strong></li>
        <li>Mediaan €/m²: <strong>${fmtMoney(total.median_eur_m2)}</strong></li>
      `;
    }
    appendOfficialSection(`
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
        voor de koper risico’s kan inhouden: te snel en op emotie tot aankoop komen. Weeg rustig af, bepaal de totale
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
    if (overviewPanel.hasAttribute('hidden')) overviewPanel.removeAttribute('hidden');
    overviewPanel.scrollIntoView({ behavior:'smooth', block:'start' });
  }

  // ===== Data-opbouw (stapsgewijs) =====
  async function fetchCommune(city, postcode){
    const qs = new URLSearchParams(); if (city) qs.set('city', city); if (postcode) qs.set('postcode', postcode);
    return await getJson(`/api/commune?${qs.toString()}`);
  }
  async function fetchGeorisques(insee){ return await getJson(`/api/georisques?insee=${encodeURIComponent(insee)}`); }
  async function fetchGPU(insee){ return await getJson(`/api/gpu?insee=${encodeURIComponent(insee)}`); }
  async function fetchGPUDoc(insee){ return await getJson(`/api/gpu-doc?insee=${encodeURIComponent(insee)}`); }
  async function fetchDVF(insee){ return await getJson(`/api/dvf?insee=${encodeURIComponent(insee)}`); }

  async function fetchSummarySequential(city, postcode) {
    const combined = { ok:true, input:{ city, postcode } };

    setSpinner('Raadpleegt gemeente…');
    const comm = await fetchCommune(city, postcode);
    if (comm?.commune) {
      combined.commune = comm.commune;
      renderCommune(comm.commune);
    } else {
      appendOfficialSection(`<div class="alert error"><strong>Gemeente</strong> kon niet worden opgehaald.</div>`);
      return combined; // zonder INSEE heeft vervolg minder zin
    }

    const insee = combined.commune.insee;
    await sleep(100); // klein pauzetje voor duidelijke stapweergave

    setSpinner('Raadpleegt Géorisques…');
    const gr = await fetchGeorisques(insee);
    if (gr) { combined.georisques = gr; renderGeorisques(gr); }
    else { appendOfficialSection(`<div class="alert error"><strong>Géorisques</strong> niet beschikbaar.</div>`); }

    await sleep(100);
    setSpinner('Raadpleegt GPU (PLU/SUP)…');
    const gpu = await fetchGPU(insee);
    if (gpu) { combined.gpu = gpu; renderGPU(gpu); }
    else { appendOfficialSection(`<div class="alert error"><strong>GPU</strong> niet beschikbaar.</div>`); }

    await sleep(100);
    setSpinner('Raadpleegt GPU-documenten…');
    const gpud = await fetchGPUDoc(insee);
    if (gpud) { combined.gpudoc = gpud; renderGPUDoc(gpud); }
    else { appendOfficialSection(`<div class="alert error"><strong>GPU-documenten</strong> niet beschikbaar.</div>`); }

    await sleep(100);
    setSpinner('Raadpleegt DVF (verkoopprijzen)…');
    const dvf = await fetchDVF(insee);
    if (dvf) { combined.dvf = dvf; renderDVF(dvf); }
    else { appendOfficialSection(`<div class="alert error"><strong>DVF</strong> niet beschikbaar.</div>`); }

    combined.meta = { insee, timestamp: new Date().toISOString() };
    window.__lastSummary = combined;
    return combined;
  }

  // ===== Analyse & signalen =====
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

  // ===== Export (PDF/print) =====
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

  // ===== Genereren (eind-tot-eind) =====
  async function handleGenerate() {
    const values = {
      adLink:   sanitize(adLinkEl?.value),
      city:     sanitize(cityEl?.value),
      price:    sanitize(priceEl?.value),
      postcode: sanitize(postcodeEl?.value),
      street:   sanitize(streetEl?.value),
      number:   sanitize(numberEl?.value),
      adText:   sanitize(adTextEl?.value),
    };
    if (!values.city) { alert('Plaatsnaam is verplicht.'); cityEl?.focus(); return; }

    setSpinner('Dossier wordt opgebouwd…');
    renderDossier(values);
    const target = $('#official-data');
    if (target) target.innerHTML = '';

    // Stapsgewijs de officiële bronnen
    const summary = await fetchSummarySequential(values.city, values.postcode);

    // AI-analyse
    setSpinner('Genereert AI-analyse…');
    overviewOut.innerHTML = `<div class="alert info">Analyse wordt gegenereerd…</div>`;
    if (overviewPanel.hasAttribute('hidden')) overviewPanel.removeAttribute('hidden');

    const signals = buildSignals(values, summary || {});
    const dossierText = composeDossierText(values, summary || {});
    try {
      const result = await postJson('/api/analyse', { dossier: dossierText, signals });
      renderOverview(result);
      ensureExportButtonOnce();
    } catch (err) {
      overviewOut.innerHTML = `<div class="alert error"><strong>Fout:</strong> ${escapeHtml(err.message)}${err.detail ? `<div class="small muted">${escapeHtml(err.detail)}</div>`:''}</div>`;
    } finally {
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

  // ===== Compose (berichten) =====
  function getChannelFor(rec){ // rec: notary | agent | seller
    const group = document.querySelector(`.radio-row[data-recipient="${rec}"]`);
    const checked = group?.querySelector('input[type="radio"]:checked');
    return checked?.value || 'email';
  }
  function getLanguageFor(rec){
    const sel = document.querySelector(`#lang-${rec}`);
    return sel?.value || 'nl';
  }

  function onCompose(role, rec){ // rec: notary|agent|seller
    return async () => {
      const values = {
        adLink:   sanitize(adLinkEl?.value),
        city:     sanitize(cityEl?.value),
        price:    sanitize(priceEl?.value),
        postcode: sanitize(postcodeEl?.value),
        street:   sanitize(streetEl?.value),
        number:   sanitize(numberEl?.value),
        adText:   sanitize(adTextEl?.value),
      };
      if (!values.city) { alert('Plaatsnaam is verplicht.'); cityEl?.focus(); return; }

      const channel  = getChannelFor(rec);
      const language = getLanguageFor(rec);
      const summary  = window.__lastSummary || await fetchSummarySequential(values.city, values.postcode);
      const dossierText = `Language: ${language}\nRecipient: ${rec}\n\n` + composeDossierText(values, summary || {});

      try {
        letterOut.innerHTML = `<div class="alert info">Bericht wordt gegenereerd…</div>`;
        if (letterPanel.hasAttribute('hidden')) letterPanel.removeAttribute('hidden');
        const result = await postJson('/api/compose', { role, dossier: dossierText, channel, language });
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
        letterPanel.scrollIntoView({ behavior:'smooth', block:'start' });
      }
    };
  }
  btnNotary?.addEventListener('click', onCompose('notary-fr','notary'));
  btnAgent ?.addEventListener('click', onCompose('agent-nl','agent'));
  btnSeller?.addEventListener('click', onCompose('seller-mixed','seller'));
});
