// /public/script.js
// Client-UI voor Immodiagnostique.
// - Alle externe data gaat via eigen /api/* routes (nooit direct vanaf de browser).
// - Ondersteunt: dossier-UI, AI-analyse (/api/analyse), AI-berichten (/api/compose),
//   en officiële bronnen via één keten-call (/api/summary).
// - Dynamische CTA-teksten o.b.v. gekozen contactkanaal (email/pb/phone/letter).

(() => {
  // ---------- Elementen ----------
  const $ = (sel) => document.querySelector(sel);

  // Invoer
  const adLinkEl   = $('#adLink');
  const cityEl     = $('#city');
  const priceEl    = $('#price');        // verplicht
  const postcodeEl = $('#postcode');
  const streetEl   = $('#street');
  const numberEl   = $('#number');
  const adTextEl   = $('#adText');

  // Actieknoppen (bestaand)
  const btnGenerate   = $('#btn-generate');
  const btnMakePrompt = $('#btn-make-prompt');

  // Dynamisch toe te voegen knop: “Haal gegevens op”
  let btnFetch = $('#btn-fetch'); // mocht in HTML bestaan; anders maken we ‘m

  // Panels/uitvoer
  const dossierPanel = $('#dossier-panel');
  const dossierOut   = $('#dossier-output');

  const overviewPanel = $('#overview-panel');
  const overviewOut   = $('#overview-output');

  const letterPanel = $('#letter-panel');
  const letterOut   = $('#letter-output');

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

  function composeDossierText(values) {
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
    const flagHtml = mdListToHtml(out.red_flags);
    const actHtml  = mdListToHtml(out.actions);
    const qHtml    = mdListToHtml(out.questions);

    overviewOut.innerHTML = `
      ${throttleNotice ? `<div class="alert warn">Throttling door Gemini; backoff toegepast. (${escapeHtml(throttleNotice)})</div>` : ''}
      <div class="kv tiny muted">Model: <code>${escapeHtml(model || '')}</code> · ${meta?.timestamp ? new Date(meta.timestamp).toLocaleString() : ''}</div>
      <h3>1. Rode vlaggen</h3>
      ${flagHtml || '<p class="muted">—</p>'}
      <h3>2. Wat nu regelen</h3>
      ${actHtml || '<p class="muted">—</p>'}
      <h3>3. Vragen aan verkoper, notaris en makelaar</h3>
      ${qHtml || '<p class="muted">—</p>'}
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

    // Géorisques
    if (summary?.georisques) {
      const gr = summary.georisques;
      const items = (gr.summary || []).map(s => {
        const badge = s.present ? 'ja' : 'nee';
        return `<li><span class="${s.present ? 'ok' : 'muted'}">${escapeHtml(s.label)}</span> — ${badge}</li>`;
      }).join('') || '<li class="muted">Geen categorieën gevonden</li>';
      parts.push(`
        <section>
          <h4>Géorisques</h4>
          <div class="box">
            <ul>${items}</ul>
            <div class="tiny"><a href="${escapeAttr(gr.links?.commune)}" target="_blank" rel="noopener">Open Géorisques (commune)</a></div>
          </div>
        </section>
      `);
    }

    // GPU (zones)
    if (summary?.gpu) {
      const z = summary.gpu.zones || [];
      const items = z.length
        ? z.map(item => `<li>${escapeHtml(item.code || item.label || 'Zone')} — <span class="tiny muted">x${item.count}</span></li>`).join('')
        : '<li class="muted">Geen zone-urba polygonen gevonden</li>';
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
        : '<li class="muted">Geen documenten via API gevonden</li>';

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

  function escapeAttr(v) {
    return escapeHtml(String(v || ''));
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
    if (!values.price) { alert('Vraagprijs is verplicht.'); priceEl?.focus(); return; }
    renderDossier(values);
  }));

  btnMakePrompt?.addEventListener('click', withLock(btnMakePrompt, async () => {
    const values = collectInput();
    if (!values.city) { alert('Plaatsnaam is verplicht.'); cityEl?.focus(); return; }
    if (!values.price) { alert('Vraagprijs is verplicht.'); priceEl?.focus(); return; }

    const dossierText = composeDossierText(values);

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

  // ---------- Handlers: compose ----------
  function onCompose(role) {
    const btn = role === 'notary-fr' ? btnNotary : role === 'agent-nl' ? btnAgent : btnSeller;
    return withLock(btn, async () => {
      const values = collectInput();
      if (!values.city) { alert('Plaatsnaam is verplicht.'); cityEl?.focus(); return; }
      if (!values.price) { alert('Vraagprijs is verplicht.'); priceEl?.focus(); return; }

      const dossierText = composeDossierText(values);
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
  // Knop toevoegen als hij niet in de HTML staat
  (function ensureFetchButton() {
    if (!btnFetch) {
      btnFetch = document.createElement('button');
      btnFetch.id = 'btn-fetch';
      btnFetch.className = 'btn';
      btnFetch.textContent = 'Haal gegevens op';
      // Plaats ‘m logisch naast “Maak AI-prompt”
      const ref = btnMakePrompt || btnGenerate || document.body;
      ref.parentNode?.insertBefore(btnFetch, ref.nextSibling);
    }
    btnFetch.addEventListener('click', withLock(btnFetch, async () => {
      const values = collectInput();
      if (!values.city) { alert('Plaatsnaam is verplicht.'); cityEl?.focus(); return; }

      // Render (of update) basis-dossier zodat er een mountpunt is
      renderDossier(values);

      const target = $('#official-data');
      if (target) {
        target.innerHTML = `<div class="alert info">Officiële gegevens worden opgehaald…</div>`;
      }

      try {
        const qs = new URLSearchParams();
        if (values.city) qs.set('city', values.city);
        if (values.postcode) qs.set('postcode', values.postcode);
        const res = await fetch(`/api/summary?${qs.toString()}`, { headers: { 'Accept': 'application/json' } });
        const isJson = (res.headers.get('content-type') || '').includes('application/json');
        const data = isJson ? await res.json() : await res.text();

        if (!res.ok || !data?.ok) {
          const msg = isJson ? (data?.error || 'Kon officiële gegevens niet ophalen.') : `HTTP ${res.status}`;
          showError('dossier', msg, isJson ? JSON.stringify(data) : String(data));
          return;
        }
        renderOfficialSummary(data);
      } catch (err) {
        showError('dossier', err.message, err.stack);
      }
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
