// public/script.js
// Minimalistische pipeline: form -> /api/summary -> INSEE -> /api/dvf -> render
// Vereist in HTML: #dossier-form, #btn-generate, inputs (#ad-link,#city,#postcode,#street,#housenr,#price,#ad-text),
// en containers: #progress-log, #spinner, #results (DVF-blok wordt automatisch aangemaakt).

/* =============== kleine helpers =============== */
const $ = (sel) => document.querySelector(sel);
const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

function nowHHMMSS() {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

function appendLog(msg) {
  let log = $("#progress-log");
  if (!log) {
    log = document.createElement("div");
    log.id = "progress-log";
    document.body.appendChild(log);
  }
  const line = document.createElement("div");
  line.textContent = `${nowHHMMSS()} · ${msg}`;
  log.appendChild(line);
  // Houd het compact
  if (log.childNodes.length > 200) log.removeChild(log.firstChild);
}

function setSpinner(onOff, label) {
  const sp = $("#spinner");
  if (!sp) return;
  sp.style.display = onOff ? "flex" : "none";
  const lab = sp.querySelector(".spinner-label");
  if (lab && label) lab.textContent = label;
}

async function fetchJSON(url, opts) {
  const t0 = performance.now();
  const r = await fetch(url, opts);
  const ms = Math.round(performance.now() - t0);
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status} @ ${url} (${ms}ms): ${txt || "no body"}`);
  }
  const data = await r.json();
  return { data, ms };
}

/* =============== DVF =============== */
async function fetchDVF(insee) {
  const url = `/api/dvf?insee=${encodeURIComponent(insee)}`;
  appendLog("DVF: gegevens ophalen…");
  const { data, ms } = await fetchJSON(url);
  appendLog(`✔ DVF klaar (${ms}ms)`);
  console.info("[DVF]", insee, data);
  return data;
}

function ensureDVFBlock() {
  // Zorg voor een plek om DVF te tonen
  let results = $("#results");
  if (!results) {
    results = document.createElement("div");
    results.id = "results";
    document.body.appendChild(results);
  }
  let dvf = document.querySelector("#dvf-block");
  if (!dvf) {
    dvf = document.createElement("section");
    dvf.id = "dvf-block";
    dvf.innerHTML = `
      <h2 style="margin-top:1rem;">DVF – Verkoopprijzen (indicatief)</h2>
      <div class="dvf-meta" style="font-size:0.95rem;opacity:.85"></div>
      <div class="dvf-summary" style="margin-top:.25rem"></div>
      <div class="dvf-links" style="margin-top:.5rem"></div>
    `;
    results.appendChild(dvf);
  }
  return dvf;
}

function renderDVF(insee, dvf) {
  const dvfBlock = ensureDVFBlock();
  const meta = dvfBlock.querySelector(".dvf-meta");
  const sum = dvfBlock.querySelector(".dvf-summary");
  const links = dvfBlock.querySelector(".dvf-links");

  const badgeBase = `
    display:inline-block;padding:.15rem .45rem;border-radius:999px;
    font-size:.8rem;line-height:1;border:1px solid #ddd;margin-right:.35rem
  `;
  const badgeSource =
    dvf.source === "commune"
      ? `<span style="${badgeBase};background:#eaf8f0;border-color:#bfe3cc">bron: per-commune</span>`
      : `<span style="${badgeBase};background:#fff4e6;border-color:#ffd7a1">fallback: departement</span>`;

  meta.innerHTML = `
    INSEE <strong>${insee}</strong> ${badgeSource}
  `;

  if (dvf.summary && typeof dvf.summary === "object") {
    const t = dvf.summary.transactions ?? "—";
    const med = dvf.summary.median_eur_m2 != null ? `${dvf.summary.median_eur_m2} €/m²` : "—";
    sum.innerHTML = `
      <div style="display:flex;gap:1rem;flex-wrap:wrap;margin:.25rem 0;">
        <div><strong>Transacties:</strong> ${t}</div>
        <div><strong>Mediaan €/m² (ruw):</strong> ${med}</div>
      </div>
      <div style="font-size:.9rem;opacity:.8">Let op: ruwe schatting uit DVF, niet gecorrigeerd voor type/staat/oppervlakte.</div>
    `;
  } else {
    sum.innerHTML = `
      <div style="font-size:.95rem">Geen per-gemeente DVF-samenvatting beschikbaar. Gebruik de departementsbestanden of de Etalab-app.</div>
    `;
  }

  const a = dvf.links || {};
  links.innerHTML = `
    <div style="display:flex;gap:.5rem;flex-wrap:wrap">
      ${a.etalab_app ? `<a href="${a.etalab_app}" target="_blank" rel="noopener" class="btn-link">Etalab DVF-app</a>` : ""}
      ${a.commune_json ? `<a href="${a.commune_json}" target="_blank" rel="noopener" class="btn-link">Commune JSON</a>` : ""}
      ${a.dep_csv_gz ? `<a href="${a.dep_csv_gz}" target="_blank" rel="noopener" class="btn-link">Departement CSV (.gz)</a>` : ""}
      ${a.dep_parquet ? `<a href="${a.dep_parquet}" target="_blank" rel="noopener" class="btn-link">Departement Parquet</a>` : ""}
    </div>
  `;
}

/* =============== SUMMARY (INSEE) =============== */
async function fetchSummary(params) {
  const usp = new URLSearchParams(params);
  const url = `/api/summary?${usp.toString()}`;
  appendLog("Raadpleegt gemeente…");
  const { data, ms } = await fetchJSON(url);
  appendLog(`✔ Raadpleegt gemeente… (${ms}ms)`);
  return data;
}

/* =============== formulier =============== */
async function handleGenerate(ev) {
  ev.preventDefault();
  const form = $("#dossier-form");
  if (!form) return;

  // Lees velden
  const link = ($("#ad-link")?.value || "").trim();
  const city = ($("#city")?.value || "").trim();
  const postcode = ($("#postcode")?.value || "").trim();
  const street = ($("#street")?.value || "").trim();
  const housenr = ($("#housenr")?.value || "").trim();
  const price = ($("#price")?.value || "").trim();
  const adtext = ($("#ad-text")?.value || "").trim();

  // UI signalen
  $("#results")?.replaceChildren(); // leeg vorige resultaten
  setSpinner(true, "Dossier wordt opgebouwd…");
  $("#progress-log")?.replaceChildren();
  appendLog("Analyse start…");

  try {
    // 1) Summary → haal INSEE indien mogelijk
    const sum = await fetchSummary({
      city,
      postcode,
      // Minimale set; je kunt hier later street/housenr toevoegen als je strikter wil zoeken
    });

    const insee = sum?.commune?.insee || sum?.meta?.insee || "";
    if (!insee) {
      appendLog("ℹ Geen INSEE: voortzetting met basisdossier (zonder officiële bronnen).");
    }

    // 2) Als INSEE bekend → DVF ophalen en renderen
    if (insee) {
      const dvf = await fetchDVF(insee);
      renderDVF(insee, dvf);
    }

    appendLog("✔ Analyse gereed");
  } catch (err) {
    console.error(err);
    appendLog(`⚠ Fout: ${err.message || err}`);
    alert(`Er ging iets mis: ${err.message || err}`);
  } finally {
    setSpinner(false);
  }
}

/* =============== init =============== */
function ensureBasicUI() {
  // Zorg dat spinner/log er zijn (als de HTML ze niet bevat)
  if (!$("#spinner")) {
    const sp = document.createElement("div");
    sp.id = "spinner";
    sp.style.cssText = "display:none;align-items:center;gap:.5rem;margin:.5rem 0;";
    sp.innerHTML = `
      <div class="spinner-dot" aria-hidden="true"></div>
      <div class="spinner-label">Bezig…</div>
    `;
    document.body.prepend(sp);
  }
  if (!$("#progress-log")) {
    const log = document.createElement("div");
    log.id = "progress-log";
    log.style.cssText = "font-family:monospace;font-size:.9rem;opacity:.9;margin:.5rem 0;";
    document.body.appendChild(log);
  }
  if (!$("#results")) {
    const res = document.createElement("div");
    res.id = "results";
    document.body.appendChild(res);
  }
}

function bind() {
  ensureBasicUI();
  const form = $("#dossier-form");
  const btn = $("#btn-generate");
  if (form && btn) {
    on(form, "submit", handleGenerate);
    on(btn, "click", handleGenerate);
  }
  console.info("IMMODIAGNOSTIQUE ready.");
}

document.addEventListener("DOMContentLoaded", bind);

/* =============== mini-styles voor links (optioneel, inline) =============== */
// Als je geen CSS wilt aanpassen, geven we DVF-links toch een knopgevoel:
(function injectMiniStyles() {
  const css = `
    .btn-link {
      display:inline-block; text-decoration:none; padding:.35rem .6rem; border:1px solid #80000022; border-radius:8px;
    }
    .btn-link:hover { background:#800000; color:#fff; border-color:#800000; }
    .spinner-dot {
      width:14px;height:14px;border:2px solid #800000;border-top-color:transparent;border-radius:50%;
      animation:spin .9s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;
  const s = document.createElement("style");
  s.textContent = css;
  document.head.appendChild(s);
})();
