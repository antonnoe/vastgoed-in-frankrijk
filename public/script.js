// /public/script.js
// Client-UI voor Immodiagnostique.
// - Geen externe fetches vanuit de browser: alleen naar eigen /api/*.
// - Werkt ook zonder advertentiegegevens; "Plaatsnaam" is nu de enige hard requirement.
// - /api/summary wordt gebruikt voor promptverrijking en voor het "Officiële gegevens"-blok.
// - Export: print-vriendelijke HTML (H1/H2, nette tekst), via window.print().

(() => {
  // ---------- Elementen ----------
  const $ = (sel) => document.querySelector(sel);

  // Invoer
  const adLinkEl   = $('#adLink');
  const cityEl     = $('#city');
  const priceEl    = $('#price');        // optioneel (was verplicht)
  const postcodeEl = $('#postcode');
  const streetEl   = $('#street');
  const numberEl   = $('#number');
  const adTextEl   = $('#adText');

  // Actieknoppen
  const btnGenerate   = $('#btn-generate');
  const btnMakePrompt = $('#btn-make-prompt');

  // Dynamisch toegevoegde knoppen
  let btnFetch  = $('#btn-fetch');  // “Haal gegevens op” (bestaat mogelijk al)
  let btnExport = $('#btn-export'); // “Exporteer rapport (PDF/print)”

  // Panels/uitvoer
  const dossierPanel   = $('#dossier-panel');
  const dossierOut     = $('#dossier-output');
  const overviewPanel  = $('#overview-panel');
  const overviewOut    = $('#overview-output');
  const letterPanel    = $('#letter-panel');
  const letterOut      = $('#letter-output');

  // Compose CTA’s
  const btnNotary = $('#btn-notary');
  const btnAgent  = $('#btn-agent');
  const btnSeller = $('#btn-seller');

  // ---------- Helpers ----------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const getChannel = () => (document.querySelector('input[name="channel"]:checked')?.value) || 'email';
  const sanitize = (s) => String(s || '').trim();

  function smoothReveal(panel) {
    if (panel && panel.hasAttribute('hidden')) panel.removeAttribute('hidden');
    panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function escapeHtml(str = '') {
    return str.replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }
  function escapeAttr(v) { return escapeHtml(String(v || '')); }

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

  function composeDossierText(values, summaryData) {
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

    // Verrijking uit summary (compact)
    if (summaryData?.commune) {
      lines.push(`Gemeente: ${summaryData.commune.name} (INSEE ${summaryData.commune.insee}, dep. ${summaryData.commune.department?.code || '-'})`);
    }
    if (summaryData?.georisques) {
      const hits = (summaryData.georisques.summary || []).filter(s => s.present).map(s => s.label);
      lines.push(`Géorisques: ${hits.length ? hits.join(', ') : 'geen expliciete categorieën gevonden'}`);
    }
    if (summaryData?.gpu) {
      const z = summaryData.gpu.zones || [];
      lines.push(`PLU (zone-urba): ${z.length ? `${z.length} zones` : 'geen polygonen gevonden'}`);
    }
    if (summaryData?.dvf?.summary?.total) {
      const tot = summaryData.dvf.summary.total;
      lines.push(`DVF (indicatief): transacties=${tot.count}, mediaan prijs≈${fmtMoney(tot.median_price)}, mediaan €/m²≈${fmtMoney(tot.median_eur_m2)}`);
    }

    lines.push("");
    lines.push("2) Risico's (Géorisques)");
    lines.push(`Controleer risico's voor: ${city || '—'}.`);
    lines.push("ERP nodig (≤ 6 maanden) indien adres bekend.");
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

  // ---------- Rendering ----------
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

  function renderOverviewFromApi(out, meta, model, throttleNotice) {
    const zwakHtml  = mdListToHtml(out.red_flags);   // "Rode vlaggen" → "ZWAKTEN"
    const actHtml   = mdListToHtml(out.actions);
    const vrgHtml   = mdListToHtml(out.questions);

    overviewOut.innerHTML = `
      ${throttleNotice ? `<div class="alert warn">Throttling door Gemini; backoff toegepast. (${escapeHtml(throttleNotice)})</div>` : ''}
      <div class="kv tiny muted">Model: <code>${escapeHtml(model || '')}</code> · ${meta?.timestamp ? new Date(meta.timestamp).toLocaleString() : ''}</div>

      <h3>SWOT – STERKTEN</h3>
      <p class="muted">Niet automatisch vastgesteld. Vul aan op basis van advertentietekst, ligging, staat en voorzieningen.</p>

      <h3>SWOT – <span class="zwak">ZWAKTEN</span></h3>
      ${zwakHtml || '<p class="muted">—</p>'}

      <h3>Vragen & Communicatie</h3>
      ${vrgHtml || '<p class="muted">—</p>'}

      <h3>Actieplan</h3>
      ${actHtml || '<p class="muted">—</p>'}
    `;
    smoothReveal(overviewPanel);
  }

  function renderLetter(result) {
    const txt = result?.output?.letter_text || '';
    const valid = result?.output?.valid;
    const model = result?.model;
    const throttleNotice = result?.throttleNotice;

    letterOut.innerHTML = `
      ${throttleNotice ? `<div class="alert warn">Throttling door Gemini; backoff toegepast. (${escapeHtml(throttleNotice)})</div>` : ''}
      <pre class="letter">${escapeHtml(txt)}</pre>
      <div class="kv tiny muted">Model: <code>${escapeHtml(model || '')}</code>${valid === false ? ' · <span class="warn">validatie: onzeker</span>' : ''}</div>
    `;
    smoothReveal(letterPanel);
  }

  function renderOfficialSummary(summary) {
    const mount = $('#official-data');
    if (!mount) return;

    const parts = [];

    // Commune/INSEE
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

    // Géorisques → badges
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

    // GPU (zones)
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

    // GPU documenten
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

    // DVF
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
        </section>
      `);
    }

    // Export mount
    parts.push(`<div id="export-hint" class="tiny muted">Gebruik “Exporteer rapport” voor een net PDF/print-overzicht.</div>`);

    mount.innerHTML = parts.join('\n');
  }

  function fmtMoney(n) {
    if (n == null) return '—';
    try {
      return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
    } catch { return String(n); }
  }

  function mdListToHtml(text = '') {
    const lines = text.split(/\r?\n/).map(l => l.trim());
    const items = lines.filter(l => /^[-*]\s+/.test(l)).map(l => l.replace(/^[-*]\s+/, ''));
    if (!items.length) return text ? `<p>${escapeHtml(text)}</p>` : '';
    return `<ul>${items.map(li => `<li>${escapeHtml(li)}</li>`).join('')}</ul>`;
  }

  // ---------- Dynamische CTA-teksten ----------
  function updateCTALabels() {
    const channel = getChannel(); // email | pb | phone | letter
    const word =
      channel === 'letter' ? 'brief' :
      channel === 'phone'  ? 'belscript' :
      'bericht';

    if (btnNotary) {
      btnNotary.textContent =
        word === 'belscript'
          ? 'Maak belscript voor notaris (FR)'
          : `Maak ${word} voor notaris (FR)`;
    }
    if (btnAgent) {
      btnAgent.textContent =
        word === 'belscript'
          ? 'Maak belscript voor makelaar (NL)'
          : `Maak ${word} voor makelaar (NL)`;
    }
    if (btnSeller) {
      btnSeller.textContent =
        word === 'belscript'
          ? 'Maak belscript voor verkoper (FR/NL)'
          : `Maak ${word} aan verkoper (FR/NL)`;
    }
  }
  document.querySelectorAll('input[name="channel"]').forEach(r =>
    r.addEventListener('change', updateCTALabels)
  );
  updateCTALabels();

  // ---------- Networking ----------
  const busy = new Set();

  async function postJson(url, payload) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    });

    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const data = isJson ? await res.json() : await res.text();

    if (!res.ok) {
      if (res.status === 429) {
        throw new Error('429: Gesmoord door rate-limit. Server past backoff toe; probeer het zo meteen opnieuw.');
      }
      const msg = (isJson && data && (data.error || data.message)) || `HTTP ${res.status}`;
      const detail = isJson ? JSON.stringify(data) : String(data);
      const e = new Error(msg);
      e.detail = detail;
      e.status = res.status;
      throw e;
    }
    return data;
  }

  function withLock(el, fn) {
    return async (...args) => {
      const id = el?.id || Math.random().toString(36).slice(2);
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

  // ---------- Handlers: dossier/analyse ----------
  btnGenerate?.addEventListener('click', withLock(btnGenerate, async () => {
    const values = collectInput();
    if (!values.city) { alert('Plaatsnaam is verplicht.'); cityEl?.focus(); return; }
    renderDossier(values);
  }));

  btnMakePrompt?.addEventListener('click', withLock(btnMakePrompt, async () => {
    const values = collectInput();
    if (!values.city) { alert('Plaatsnaam is verplicht.'); cityEl?.focus(); return; }

    // Haal officiële samenvatting ter verrijking
    const summary = await fetchSummary(values.city, values.postcode);

    const dossierText = composeDossierText(values, summary);

    try {
      overviewOut.innerHTML = `<div class="alert info">Analyse wordt gegenereerd…</div>`;
      smoothReveal(overviewPanel);

      const result = await postJson('/api/analyse', { dossier: dossierText });

      if (!result?.ok) {
        showError('overview', result?.message || 'Analyse is mislukt.', result && JSON.stringify(result));
        return;
      }
      renderOverviewFromApi(result.output, result.meta, result.model, result.throttleNotice);
    } catch (err) {
      showError('overview', err.message, err.detail);
    }
  }));

  async function fetchSummary(city, postcode) {
    try {
      const qs = new URLSearchParams();
      if (city) qs.set('city', city);
      if (postcode) qs.set('postcode', postcode);
      const res = await fetch(`/api/summary?${qs.toString()}`, { headers: { 'Accept': 'application/json' } });
      const isJson = (res.headers.get('content-type') || '').includes('application/json');
      const data = isJson ? await res.json() : null;
      if (!res.ok || !data?.ok) return null;
      // Render (of update) officiële gegevens in dossierpaneel
      renderOfficialSummary(data);
      return data;
    } catch {
      return null;
    }
  }

  // ---------- Handlers: compose ----------
  function onCompose(role) {
    const btn = role === 'notary-fr' ? btnNotary : role === 'agent-nl' ? btnAgent : btnSeller;
    return withLock(btn, async () => {
      const values = collectInput();
      if (!values.city) { alert('Plaatsnaam is verplicht.'); cityEl?.focus(); return; }

      const summary = await fetchSummary(values.city, values.postcode);
      const dossierText = composeDossierText(values, summary);
      const channel = values.channel;

      try {
        letterOut.innerHTML = `<div class="alert info">Bericht wordt gegenereerd…</div>`;
        smoothReveal(letterPanel);

        const result = await postJson('/api/compose', { role, dossier: dossierText, channel });

        if (!result?.ok) {
          showError('letter', result?.message || 'Genereren van bericht is mislukt.', result && JSON.stringify(result));
          return;
        }
        renderLetter(result);
      } catch (err) {
        showError('letter', err.message, err.detail);
      }
    });
  }
  btnNotary?.addEventListener('click', onCompose('notary-fr'));
  btnAgent?.addEventListener('click', onCompose('agent-nl'));
  btnSeller?.addEventListener('click', onCompose('seller-mixed'));

  // ---------- Handler: officiële bronnen via /api/summary ----------
  (function ensureFetchButton() {
    if (!btnFetch) {
      btnFetch = document.createElement('button');
      btnFetch.id = 'btn-fetch';
      btnFetch.className = 'btn';
      btnFetch.textContent = 'Haal gegevens op';
      const ref = btnMakePrompt || btnGenerate || document.body;
      ref.parentNode?.insertBefore(btnFetch, ref.nextSibling);
    }
    btnFetch.addEventListener('click', withLock(btnFetch, async () => {
      const values = collectInput();
      if (!values.city) { alert('Plaatsnaam is verplicht.'); cityEl?.focus(); return; }

      // Basis-dossier tonen zodat er een mountpunt is
      renderDossier(values);

      const target = $('#official-data');
      if (target) {
        target.innerHTML = `<div class="alert info">Officiële gegevens worden opgehaald…</div>`;
      }

      await fetchSummary(values.city, values.postcode);
    }));
  })();

  // ---------- Export: rapport (PDF/print) ----------
  (function ensureExportButton() {
    if (!btnExport) {
      btnExport = document.createElement('button');
      btnExport.id = 'btn-export';
      btnExport.className = 'btn';
      btnExport.textContent = 'Exporteer rapport (PDF/print)';
      const ref = (btnFetch || btnMakePrompt || btnGenerate || document.body);
      ref.parentNode?.insertBefore(btnExport, ref.nextSibling);
    }
    btnExport.addEventListener('click', () => {
      const values = collectInput();
      const summary = window.__lastSummary || null; // gevuld door fetchSummary
      const overviewHtml = overviewOut.innerHTML || '';
      const letterHtml = letterOut.innerHTML || '';

      const html = buildPrintableReport(values, summary, overviewHtml, letterHtml);
      const w = window.open('', '_blank');
      if (!w) return alert('Pop-up geblokkeerd: sta pop-ups tijdelijk toe voor export.');
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.focus();
      // Automatisch printen; gebruiker kan "Opslaan als PDF" kiezen
      w.print();
    });
  })();

  function buildPrintableReport(values, summary, overviewHtml, letterHtml) {
    const title = 'IMMODIAGNOSTIQUE – Rapport';
    const addr = buildFullAddress(values);
    const today = new Date().toLocaleDateString('nl-NL');

    // Extract “ZWAKTEN” lijst uit overviewHtml (rudimentair, maar werkt omdat we de structuur kennen)
    const zwakten = extractSectionHtml(overviewHtml, /SWOT – <span class="zwak">ZWAKTEN<\/span>/i);
    const vragen  = extractSectionAfterHeading(overviewHtml, /Vragen & Communicatie/i);
    const acties  = extractSectionAfterHeading(overviewHtml, /Actieplan/i);

    // Omgevingsdossier – korte synthese van summary
    const omgeving = renderOfficialSummaryToStatic(summary);

    // Waarschuwing + disclaimer
    const waarschuwing = `
      <p><strong>Waarschuwing:</strong> laat u niet meeslepen door een “coup de cœur”. Weeg rustig af. Stel de totale acquisitiekosten <strong>volledig</strong> vast (inclusief eventuele makelaarskosten en notariskosten) en plan verbouwingskosten realistisch in.</p>
      <p class="tiny muted">Tip: als koper kunt u <em>zelf</em> een notaris inschakelen; de cumulatieve notariskosten blijven in de praktijk gelijk.</p>
      <p class="tiny muted">Disclaimer: Deze analyse is indicatief en informatief. Raadpleeg notaris, makelaar en de officiële bronnen (Géorisques, DVF, Géoportail-Urbanisme). Aan deze tool kunnen geen rechten worden ontleend.</p>
    `;

    const style = `
      <style>
        :root { --brand:#800000; --ink:#222; --muted:#666; --ok:#0a7f00; --warn:#b00020; max-width: 100%; }
        body { font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: var(--ink); margin: 2rem; }
        .container { max-width: 780px; margin: 0 auto; }
        h1 { font-size: 26px; margin: 0 0 4px; color: var(--brand); }
        h2 { font-size: 18px; margin: 20px 0 6px; }
        h3 { font-size: 16px; margin: 16px 0 6px; }
        h4 { font-size: 14px; margin: 10px 0 6px; }
        .muted { color: var(--muted); }
        .tiny { font-size: 12px; }
        .zwak { color: var(--warn); }
        .ok { color: var(--ok); }
        .box { border: 1px solid #ddd; border-radius: 6px; padding: 10px 12px; margin: 8px 0; }
        ul { margin: 6px 0 6px 20px; }
        .badgelist { list-style: none; margin-left: 0; padding-left: 0; }
        .badgelist li { margin: 2px 0; }
        .badge { display: inline-block; width: 1.4em; text-align: center; margin-right: 6px; }
        code { background: #f6f6f6; padding: 0 3px; border-radius: 3px; }
        .hr { height: 1px; background: #ddd; margin: 24px 0; }
        @media print {
          .hr { break-after: page; height: 0; border: none; }
          a { color: inherit; text-decoration: none; }
        }
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

  <h3>SWOT – STERKTEN</h3>
  <div class="box"><p class="muted">Nog in te vullen (op basis van advertentie/bezichtiging/omgeving).</p></div>

  <h3>SWOT – <span class="zwak">ZWAKTEN</span></h3>
  <div class="box">${zwakten || '<p class="muted">—</p>'}</div>

  <div class="hr"></div>

  <h2>2. Omgevingsdossier (ook SWOT)</h2>
  ${omgeving}

  <div class="hr"></div>

  <h2>3. Actieplan</h2>
  <div class="box">${acties || '<p class="muted">—</p>'}</div>

  <h3>Communicatie & Vragen</h3>
  <div class="box">
    ${vragen || '<p class="muted">—</p>'}
    <p class="tiny muted">Gebruik de sjablonen in de app voor verkoper/makelaar/notaris (kanaal: e-mail, PB/DM, of belscript).</p>
  </div>

  <div class="hr"></div>

  <h2>Waarschuwing & Disclaimer</h2>
  <div class="box">${waarschuwing}</div>
</div></body></html>`;
  }

  // Zeer simpele extractors op basis van headings die we zelf renderen
  function extractSectionHtml(html, headingRegex) {
    if (!html) return '';
    // Zoek <h3>SWOT – <span class="zwak">ZWAKTEN</span></h3> en pak erna tot volgende <h3>
    const idx = html.search(headingRegex);
    if (idx < 0) return '';
    const after = html.slice(idx);
    const next = after.indexOf('<h3');
    const chunk = next > 0 ? after.slice(0, next) : after;
    // strip de heading zelf
    return chunk.replace(/^[\s\S]*?<\/h3>/i, '');
  }
  function extractSectionAfterHeading(html, headingRegex) {
    if (!html) return '';
    const idx = html.search(headingRegex);
    if (idx < 0) return '';
    const after = html.slice(idx);
    const next = after.indexOf('<h3');
    const chunk = next > 0 ? after.slice(0, next) : after;
    return chunk.replace(/^[\s\S]*?<\/h3>/i, '');
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
    // Géorisques badges
    if (summary.georisques) {
      const items = (summary.georisques.summary || []).map(s => {
        const badge = s.present ? '✅' : '—'; const cls = s.present ? 'ok' : 'muted';
        return `<li><span class="badge ${cls}">${badge}</span> ${escapeHtml(s.label)}</li>`;
      }).join('') || '<li class="muted">Geen categorieën gevonden</li>';
      parts.push(`
        <h3>Géorisques</h3>
        <div class="box"><ul class="badgelist">${items}</ul></div>
      `);
    }
    // GPU zones
    if (summary.gpu) {
      const z = summary.gpu.zones || [];
      const items = z.length
        ? z.map(item => `<li>${escapeHtml(item.code || item.label || 'Zone')} <span class="tiny muted">×${item.count}</span></li>`).join('')
        : '<li class="muted">Geen zone-urba polygonen aangetroffen (mogelijk RNU of alleen documenten).</li>';
      parts.push(`
        <h3>PLU/SUP (GPU)</h3>
        <div class="box"><ul>${items}</ul></div>
      `);
    }
    // DVF
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
      parts.push(`
        <h3>DVF (verkoopprijzen)</h3>
        <div class="box"><ul>${inner}</ul></div>
      `);
    }
    return parts.join('\n');
  }

  // ---------- Officiële bronnen knop ----------
  (function ensureFetchButton() {
    if (!btnFetch) {
      btnFetch = document.createElement('button');
      btnFetch.id = 'btn-fetch';
      btnFetch.className = 'btn';
      btnFetch.textContent = 'Haal gegevens op';
      const ref = btnMakePrompt || btnGenerate || document.body;
      ref.parentNode?.insertBefore(btnFetch, ref.nextSibling);
    }
    btnFetch.addEventListener('click', withLock(btnFetch, async () => {
      const values = collectInput();
      if (!values.city) { alert('Plaatsnaam is verplicht.'); cityEl?.focus(); return; }
      renderDossier(values);
      const target = $('#official-data');
      if (target) target.innerHTML = `<div class="alert info">Officiële gegevens worden opgehaald…</div>`;
      const data = await fetchSummary(values.city, values.postcode);
      window.__lastSummary = data || null;
    }));
  })();

  // ---------- Fouten ----------
  function showError(panel, message, detail) {
    const html = `
      <div class="alert error">
        <strong>Fout:</strong> ${escapeHtml(message || 'Onbekende fout')}
        ${detail ? `<div class="tiny muted">${escapeHtml(detail)}</div>` : ''}
      </div>
    `;
    if (panel === 'overview') {
      overviewOut.innerHTML = html;
      smoothReveal(overviewPanel);
    } else if (panel === 'letter') {
      letterOut.innerHTML = html;
      smoothReveal(letterPanel);
    } else {
      dossierOut.innerHTML = html;
      smoothReveal(dossierPanel);
    }
  }
})();
