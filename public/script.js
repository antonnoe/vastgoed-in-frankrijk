/* public/script.js
 * IMMODIAGNOSTIQUE – UI controller
 * - Bouwt query uit velden
 * - Haalt /api/summary op
 * - Haalt daarna /api/dvf op met gevonden INSEE (géén 400 meer op postcode)
 * - Schrijft voortgangsregels en beheert spinner
 */

/* ---------- DOM helpers ---------- */
const qs  = (sel, p = document) => p.querySelector(sel);
const qsa = (sel, p = document) => [...p.querySelectorAll(sel)];

/* Verwachte elementen (houd id’s gelijk aan index.html) */
const ui = {
  // Inputs
  link:      qs('#input-link'),
  city:      qs('#input-city'),
  postcode:  qs('#input-postcode'),
  street:    qs('#input-street'),
  housenr:   qs('#input-housenr'),
  price:     qs('#input-price'),
  adtext:    qs('#input-adtext'),

  // Acties
  btnGenerate: qs('#btn-generate'),
  btnCancel:   qs('#btn-cancel'),

  // Status/voortgang
  spinner:     qs('#spinner'),
  spinnerLbl:  qs('#spinner-label'),
  progress:    qs('#progress-log'),

  // Uitvoerblokken
  dossier:    qs('#dossier-out'),
  env:        qs('#env-out'),
  dvf:        qs('#dvf-out'),
};

/* ---------- State ---------- */
let aborter = null;

/* ---------- UI helpers ---------- */
function setSpinner(on, label = '') {
  if (!ui.spinner) return;
  ui.spinner.style.display = on ? 'inline-block' : 'none';
  if (ui.spinnerLbl) ui.spinnerLbl.textContent = on ? (label || 'Bezig…') : '';
}

function resetLog() {
  if (ui.progress) ui.progress.innerHTML = '';
}
function appendLog(msg) {
  if (!ui.progress) return;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2,'0');
  const mm = String(now.getMinutes()).padStart(2,'0');
  const ss = String(now.getSeconds()).padStart(2,'0');
  const line = document.createElement('div');
  line.textContent = `${hh}:${mm}:${ss} · ${msg}`;
  ui.progress.appendChild(line);
}

/* ---------- Helpers ---------- */
function buildSummaryQuery() {
  const params = new URLSearchParams();
  // Alleen meest informatieve velden meesturen; UI mag starten met plaatsnaam
  const city = (ui.city?.value || '').trim();
  const postcode = (ui.postcode?.value || '').trim();
  if (city) params.set('city', city);
  if (postcode) params.set('postcode', postcode);
  // street/housenr zijn optioneel
  const street = (ui.street?.value || '').trim();
  const housenr = (ui.housenr?.value || '').trim();
  if (street) params.set('street', street);
  if (housenr) params.set('housenr', housenr);
  return params.toString();
}

function sanitizeUrlDisplay(u) {
  try {
    const url = new URL(u);
    // Toon verkorte variant zonder tracking
    return `${url.origin}${url.pathname}`;
  } catch {
    return u;
  }
}

/* ---------- Renderers ---------- */
function renderDossierSummary(summary, formEcho) {
  if (!ui.dossier) return;
  const linkClean = formEcho.link ? sanitizeUrlDisplay(formEcho.link) : '';
  const addrHint = [
    formEcho.city || '',
    formEcho.postcode || '',
    formEcho.street || '',
    formEcho.housenr || '',
  ].filter(Boolean).join(' ');
  const priceLine = formEcho.price ? `Vraagprijs: ${formEcho.price} (facultatief maar aanbevolen)` : '';

  ui.dossier.innerHTML = `
    <h3>1. Vastgoeddossier</h3>
    <p><strong>Officieel adres / advertentie</strong></p>
    <p><em>Invoer:</em><br>${addrHint || '—'}<br>${priceLine || ''}</p>
    ${linkClean ? `<p>Advertentielink: <a href="${formEcho.link}" target="_blank" rel="noopener">${linkClean}</a></p>` : ''}
    <p><em>Exact perceelnummer later bij de notaris opvragen.</em></p>

    <h3>2. Omgevingsdossier</h3>
    ${renderEnvBadges(summary)}
  `;
}

function renderEnvBadges(summary) {
  const geo = summary?.georisques?.summary || [];
  const items = [
    { key: 'flood',       label: 'Overstroming' },
    { key: 'coastal',     label: 'Kust' },
    { key: 'industrial',  label: 'Industrieel' },
    { key: 'seismic',     label: 'Seismisch' },
    { key: 'radon',       label: 'Radon' },
    { key: 'clay',        label: 'Klei/krimp' },
    { key: 'forestfire',  label: 'Bosbrand' },
  ];
  const map = Object.fromEntries(geo.map(g => [g.key, !!g.present]));
  const badges = items.map(it => {
    const ok = map[it.key] === false; // present:false => groen vinkje
    const sym = ok ? '✅' : '—';
    return `<span class="badge">${sym} ${it.label}</span>`;
  }).join(' ');
  const links = summary?.georisques?.links || {};
  const gpu = summary?.gpu?.links || {};
  const dvf = summary?.dvf?.links || {};
  return `
    <div class="badges">${badges}</div>
    <p class="refs">
      <a href="${gpu.gpu_site_commune || '#'}" target="_blank" rel="noopener">Géoportail Urbanisme</a> ·
      <a href="${links.commune || links.search || '#'}" target="_blank" rel="noopener">Géorisques – gemeente</a> ·
      <a href="${dvf.etalab_app || '#'}" target="_blank" rel="noopener">DVF – Etalab</a>
    </p>
  `;
}

function renderDVFBlock(dvf) {
  if (!ui.dvf) return;
  const sum = dvf.summary;
  ui.dvf.innerHTML = `
    <h3>DVF – Verkoopprijzen</h3>
    <p><strong>Bron:</strong> ${dvf.source}</p>
    ${
      sum
        ? `<p>Transacties: ${sum.transactions}<br>Medián €/m²: ${sum.median_eur_m2 ?? '—'}</p>`
        : `<p>Geen gemeentebestand gevonden; gebruik departementsbestanden of Etalab-app.</p>`
    }
    <p class="refs">
      <a href="${dvf.links.etalab_app}" target="_blank" rel="noopener">DVF Etalab</a> ·
      <a href="${dvf.links.dep_parquet}" target="_blank" rel="noopener">Departement (Parquet)</a> ·
      <a href="${dvf.links.dep_csv_gz}" target="_blank" rel="noopener">Departement (CSV.gz)</a>
    </p>
  `;
}

/* ---------- Main flow ---------- */
async function runMakeDossier() {
  // Nieuwe run → maak aborter en reset UI
  if (aborter) aborter.abort();
  aborter = new AbortController();
  resetLog();
  setSpinner(true, 'Dossier wordt opgebouwd…');
  appendLog('Raadpleegt gemeente…');

  // Echo van formulier
  const formEcho = {
    link: (ui.link?.value || '').trim(),
    city: (ui.city?.value || '').trim(),
    postcode: (ui.postcode?.value || '').trim(),
    street: (ui.street?.value || '').trim(),
    housenr: (ui.housenr?.value || '').trim(),
    price: (ui.price?.value || '').trim(),
    adtext: (ui.adtext?.value || '').trim(),
  };

  // 1) SUMMARY
  const q = buildSummaryQuery();
  const sumUrl = `/api/summary?${q}`;
  let summary;
  try {
    const r = await fetch(sumUrl, { signal: aborter.signal });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`HTTP ${r.status} @ /api/summary?${q}: ${txt}`);
    }
    summary = await r.json();
    appendLog('✔ Raadpleegt gemeente…');
  } catch (err) {
    setSpinner(false, '');
    console.error(err);
    alert(`Er ging iets mis: ${err.message}`);
    return;
  }

  // Render basis + env
  renderDossierSummary(summary, formEcho);

  // 2) INSEE → DVF
  const insee = summary?.commune?.insee || summary?.meta?.insee || '';
  if (!insee) {
    appendLog('ℹ Geen INSEE: slaat DVF over');
    if (ui.dvf) ui.dvf.innerHTML = `<h3>DVF – Verkoopprijzen</h3><p>Niet beschikbaar zonder INSEE (alleen plaats/postcode ingevoerd).</p>`;
    setSpinner(false, '');
    return;
  }

  appendLog(`DVF ophalen voor INSEE ${insee}…`);
  try {
    const dvfRes = await fetch(`/api/dvf?insee=${insee}`, { signal: aborter.signal });
    if (!dvfRes.ok) {
      const txt = await dvfRes.text();
      appendLog(`⚠ DVF fout: ${txt}`);
      if (ui.dvf) ui.dvf.innerHTML = `<h3>DVF – Verkoopprijzen</h3><p>DVF kon niet worden geladen.</p>`;
    } else {
      const dvf = await dvfRes.json();
      renderDVFBlock(dvf);
      appendLog('✔ DVF gereed');
    }
  } catch (err) {
    appendLog(`⚠ DVF fout: ${err.message}`);
    if (ui.dvf) ui.dvf.innerHTML = `<h3>DVF – Verkoopprijzen</h3><p>DVF kon niet worden geladen.</p>`;
  }

  // Klaar
  setSpinner(false, '');
  appendLog('✔ Analyse gereed');
}

/* ---------- Events ---------- */
function wireEvents() {
  if (ui.btnGenerate) {
    ui.btnGenerate.addEventListener('click', (ev) => {
      ev.preventDefault();
      runMakeDossier();
    });
  }
  if (ui.btnCancel) {
    ui.btnCancel.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (aborter) {
        aborter.abort();
        appendLog('⏹ Afgebroken door gebruiker');
        setSpinner(false, '');
      }
    });
  }
}

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded', () => {
  wireEvents();
  // Initial UI state
  setSpinner(false, '');
});
