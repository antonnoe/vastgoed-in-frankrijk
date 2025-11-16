/* public/script.js — IMMODIAGNOSTIQUE UI glue (compact, POST /api/summary + DVF fetch) */

/* ---------- DOM refs ---------- */
const ui = {
  form: document.getElementById('form'),
  city: document.getElementById('city'),
  postcode: document.getElementById('postcode'),
  price: document.getElementById('price'),
  street: document.getElementById('street'),
  housenr: document.getElementById('housenr'),
  advert: document.getElementById('advert'),
  link: document.getElementById('link'),

  btnGenerate: document.getElementById('btn-generate'),
  btnCancel: document.getElementById('btn-cancel'),
  spinner: document.getElementById('spinner'),
  spinnerLabel: document.getElementById('spinner-label'),
  progressLog: document.getElementById('progress-log'),

  // secties waar we output tonen
  outDossier: document.getElementById('out-dossier'),
  outEnv: document.getElementById('out-env'),
  outLinks: document.getElementById('out-links'),
};

/* ---------- helpers ---------- */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function setSpinner(on, label = '') {
  if (!ui.spinner) return;
  ui.spinner.style.display = on ? 'inline-block' : 'none';
  if (ui.spinnerLabel) ui.spinnerLabel.textContent = label || '';
}

function clearLog() {
  if (ui.progressLog) ui.progressLog.innerHTML = '';
}

function appendLog(msg) {
  if (!ui.progressLog) return;
  const li = document.createElement('div');
  li.textContent = `${new Date().toLocaleTimeString()} · ${msg}`;
  ui.progressLog.appendChild(li);
}

function getCityPostcode() {
  return {
    city: (ui.city?.value || '').trim(),
    postcode: (ui.postcode?.value || '').trim(),
  };
}

function renderDossier(summary, dvf) {
  if (!ui.outDossier) return;
  const insee = summary?.meta?.insee || summary?.commune?.insee || '(onbekend)';
  const name = summary?.commune?.name || (summary?.input?.city || '(n.v.t.)');
  const pc = (summary?.commune?.postcodes && summary.commune.postcodes[0]) || (summary?.input?.postcode || '');

  const dvfLine = dvf?.summary?.median_eur_m2
    ? `DVF mediaan (€/m²): ${dvf.summary.median_eur_m2}`
    : `DVF: ${dvf?.source === 'departement-fallback' ? 'geen gemeente-JSON, departement gebruikt' : 'n.v.t.'}`;

  ui.outDossier.innerHTML = `
    <h2>1. Vastgoeddossier</h2>
    <p><strong>Gemeente:</strong> ${name} (${pc}) — <strong>INSEE:</strong> ${insee}</p>
    <p>${dvfLine}</p>
  `;
}

function renderEnv(summary) {
  if (!ui.outEnv) return;
  const links = summary?.georisques?.links || {};
  const gpu = summary?.gpu?.links || {};
  ui.outEnv.innerHTML = `
    <h2>2. Omgevingsdossier</h2>
    <ul>
      <li>Géorisques (gemeente): ${links.commune ? `<a href="${links.commune}" target="_blank" rel="noopener">open</a>` : '—'}</li>
      <li>GPU (PLU/zonering): ${gpu.gpu_site_commune ? `<a href="${gpu.gpu_site_commune}" target="_blank" rel="noopener">open</a>` : '—'}</li>
    </ul>
  `;
}

function renderLinks(dvf) {
  if (!ui.outLinks) return;
  const l = dvf?.links || {};
  ui.outLinks.innerHTML = `
    <h2>Referenties</h2>
    <ul>
      <li>DVF (Etalab app): ${l.etalab_app ? `<a href="${l.etalab_app}" target="_blank" rel="noopener">open</a>` : '—'}</li>
      <li>Commune JSON: ${l.commune_json ? `<a href="${l.commune_json}" target="_blank" rel="noopener">${l.commune_json}</a>` : '—'}</li>
      <li>Departement CSV: ${l.dep_csv_gz ? `<a href="${l.dep_csv_gz}" target="_blank" rel="noopener">${l.dep_csv_gz}</a>` : '—'}</li>
      <li>Departement Parquet: ${l.dep_parquet ? `<a href="${l.dep_parquet}" target="_blank" rel="noopener">${l.dep_parquet}</a>` : '—'}</li>
    </ul>
  `;
}

/* ---------- hoofdactie ---------- */
let aborter = null;

async function runMakeDossier() {
  // reset UI
  setSpinner(true, 'Analyseert…');
  clearLog();
  ui.outDossier && (ui.outDossier.innerHTML = '');
  ui.outEnv && (ui.outEnv.innerHTML = '');
  ui.outLinks && (ui.outLinks.innerHTML = '');

  if (aborter) {
    try { aborter.abort(); } catch {}
  }
  aborter = new AbortController();

  try {
    appendLog('Dossier wordt opgebouwd…');
    await sleep(300); // klein effect

    // 1) SUMMARY (POST { city, postcode })
    const { city, postcode } = getCityPostcode();
    appendLog('Raadpleegt gemeente…');

    if (!city) throw new Error('Vul minstens de plaatsnaam in.');

    const rSum = await fetch('/api/summary', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ city, postcode }),
      signal: aborter.signal,
    });
    if (!rSum.ok) {
      const txt = await rSum.text();
      throw new Error(`HTTP ${rSum.status} @ /api/summary: ${txt}`);
    }
    const summary = await rSum.json();
    appendLog('✔ Raadpleegt gemeente…');

    const insee =
      summary?.meta?.insee ||
      summary?.commune?.insee ||
      null;

    // 2) DVF (alleen als INSEE)
    let dvf = null;
    if (insee) {
      appendLog('Controleert DVF (verkoopprijzen)…');
      const rDvf = await fetch(`/api/dvf?insee=${encodeURIComponent(insee)}`, {
        signal: aborter.signal,
      });
      if (!rDvf.ok) {
        const txt = await rDvf.text();
        throw new Error(`HTTP ${rDvf.status} @ /api/dvf: ${txt}`);
      }
      dvf = await rDvf.json();
      appendLog('✔ DVF opgehaald');
    } else {
      appendLog('ℹ Geen INSEE: DVF wordt overgeslagen');
    }

    // 3) Render
    renderDossier(summary, dvf);
    renderEnv(summary);
    renderLinks(dvf);

    appendLog('✔ Analyse gereed');
  } catch (err) {
    console.error(err);
    appendLog(`⛔ Fout: ${err.message}`);
    alert(`Er ging iets mis: ${err.message}`);
  } finally {
    setSpinner(false, '');
  }
}

/* ---------- annuleren ---------- */
function cancelRun() {
  if (aborter) {
    try { aborter.abort(); } catch {}
    appendLog('⏹ Afgebroken op verzoek');
    setSpinner(false, '');
  }
}

/* ---------- events ---------- */
function wire() {
  if (ui.btnGenerate) ui.btnGenerate.addEventListener('click', (e) => {
    e.preventDefault();
    runMakeDossier();
  });
  if (ui.btnCancel) ui.btnCancel.addEventListener('click', (e) => {
    e.preventDefault();
    cancelRun();
  });
}

document.addEventListener('DOMContentLoaded', wire);
