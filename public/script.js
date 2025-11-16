/* public/script.js
 * IMMODIAGNOSTIQUE – UI-logica met voortgangspijplijn, DVF-fallback en rapport-rendering
 * Vereist: index.html zoals in jouw huidige /public en een werkende /api/commune, /api/dvf, /api/analyse
 */

/* ============== Helpers ============== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const nowHHMMSS = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
};

const fetchJSON = async (url, opts) => {
  const r = await fetch(url, { ...opts, headers: { accept: "application/json", ...(opts && opts.headers) } });
  const txt = await r.text();
  let json;
  try { json = txt ? JSON.parse(txt) : null; } catch { json = { ok: false, error: "Invalid JSON", raw: txt }; }
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status} @ ${url}`);
    err.http = r.status;
    err.payload = json || txt;
    throw err;
  }
  return json;
};

const fact = (k, v) => `<div class="fact"><span class="k">${k}:</span> <span class="v">${v}</span></div>`;
const euro = (n) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const stripUrl = (u) => {
  try { const x = new URL(u); x.search = ""; x.hash = ""; return x.toString(); } catch { return u; }
};

/* ============== Voortgang UI ============== */
const spinner = $("#progress-spinner");
const spinnerLabel = $("#spinner-label");
const pipe = $("#progress-pipeline");
const logBox = $("#progress-log");

const setSpinner = (on, label = "") => {
  spinner.setAttribute("aria-hidden", on ? "false" : "true");
  spinner.style.visibility = on ? "visible" : "hidden";
  spinnerLabel.textContent = label || (on ? "Bezig…" : "Klaar.");
};

const setStep = (name, state, metaText = "") => {
  const li = pipe.querySelector(`.pipe-step[data-step="${name}"]`);
  if (!li) return;
  li.setAttribute("data-state", state); // idle | active | done | error | skipped
  const meta = li.querySelector(".pipe-meta");
  if (metaText) meta.textContent = metaText;
};

const logLine = (msg) => {
  const p = document.createElement("div");
  p.textContent = `${nowHHMMSS} · ${msg}`;
  logBox.appendChild(p);
  logBox.scrollTop = logBox.scrollHeight;
};

const resetPipeline = () => {
  setSpinner(false, "Wachten op start…");
  $$("#progress-pipeline .pipe-step").forEach((li) => {
    li.setAttribute("data-state", "idle");
    const meta = li.querySelector(".pipe-meta");
    if (meta) meta.textContent = "";
  });
  logBox.innerHTML = "";
  logLine("Wachten op start…");
};

/* ============== Render ============== */
const envBadges = (geoSummary) => {
  // geoSummary: array van {key,label,present:boolean}
  if (!Array.isArray(geoSummary)) return "";
  return geoSummary.map(s => {
    const mark = s.present ? "✅" : "—";
    return `<span class="badge">${mark} ${s.label}</span>`;
  }).join("");
};

const swotList = (ul, items) => {
  ul.innerHTML = "";
  if (!Array.isArray(items) || !items.length) {
    ul.innerHTML = "<li>—</li>";
    return;
  }
  items.forEach(t => {
    const li = document.createElement("li");
    li.textContent = t.replace(/^•\s*/, "");
    ul.appendChild(li);
  });
};

const renderReport = ({ input, commune, dvf, georisques, analysis }) => {
  const result = $("#result");
  const keyfacts = $("#keyfacts");
  const envRow = $("#env-badges");
  const envLinks = $("#env-links");
  const actieplanList = $("#actieplan-list");

  // 1) Key facts
  const facts = [];
  const placeStr = [input.postcode, input.city].filter(Boolean).join(" ");
  if (placeStr) facts.push(fact("Invoer", placeStr));
  if (Number.isFinite(input.price)) facts.push(fact("Vraagprijs", `${euro(input.price)} (facultatief maar aanbevolen)`));
  if (Number.isFinite(input.livingArea)) facts.push(fact("Woonoppervlakte", `${input.livingArea} m²`));
  facts.push(fact("Exact perceel", "later opvragen bij notaris"));

  if (commune?.name || commune?.insee) {
    if (commune?.name) facts.push(fact("Gemeente", commune.name));
    if (commune?.insee) facts.push(fact("INSEE", commune.insee));
  }

  // DVF: status + Etalab-link (altijd), en als aanwezig een indicatieve €/m²
  if (dvf) {
    const dep = dvf.dep || commune?.department?.code;
    if (dvf.source === "departement-fallback") {
      facts.push(fact("DVF status", `Geen commune-bestand, fallback op departement ${dep || "—"}.`));
    } else if (dvf.source === "commune" && dvf.summary?.median_eur_m2) {
      facts.push(fact("DVF mediaan", `${euro(dvf.summary.median_eur_m2)}/m² (indicatief)`));
      if (Number.isFinite(input.price) && Number.isFinite(input.livingArea) && input.livingArea > 0) {
        const askPerM2 = Math.round(input.price / input.livingArea);
        facts.push(fact("Vraagprijs per m²", `${euro(askPerM2)}/m² (ruw)`));
      }
    }
    const etalab = dvf?.links?.etalab_app;
    if (etalab) {
      facts.push(fact("DVF (Etalab)", `<a href="${etalab}" target="_blank" rel="noopener">${etalab}</a>`));
    }
  }

  // Link naar advertentie (gekuist)
  if (input.advertLink) {
    const short = stripUrl(input.advertLink);
    facts.push(
      fact(
        "Advertentielink",
        `<a href="${short}" target="_blank" rel="noopener">${short}</a> 
         <button class="link-mini" data-action="copy-full-link" data-url="${input.advertLink}">Kopieer volledige link</button>`
      )
    );
  }

  keyfacts.innerHTML = facts.join("");

  // 2) Omgevingsdossier – badges + links
  envRow.innerHTML = georisques?.summary ? envBadges(georisques.summary) : "";
  const linksOut = [];
  if (commune?.insee) {
    linksOut.push(`<a href="https://www.geoportail-urbanisme.gouv.fr/recherche?insee=${commune.insee}" target="_blank" rel="noopener">Géoportail Urbanisme</a>`);
    linksOut.push(`<a href="https://www.georisques.gouv.fr/commune/${commune.insee}" target="_blank" rel="noopener">Géorisques – gemeente</a>`);
  }
  envLinks.innerHTML = linksOut.join(" · ");

  // 3) Actieplan (uit analyse of fallback)
  actieplanList.innerHTML = "";
  const ap = Array.isArray(analysis?.output?.actieplan) ? analysis.output.actieplan :
    [
      "ERP (État des Risques et Pollutions) opvragen zodra exact adres bekend is.",
      "PLU-zonering en SUP controleren via Géoportail Urbanisme.",
      "Kadastrale referenties en perceelgrenzen bij de notaris bevestigen.",
      "Recente DVF-transacties in de directe omgeving vergelijken.",
      "Staat van installaties (elektra/gas/riolering) laten inspecteren.",
    ];
  ap.forEach(t => {
    const li = document.createElement("li");
    li.textContent = t.replace(/^•\s*/, "");
    actieplanList.appendChild(li);
  });

  // 4) SWOT
  swotList($("#swot-sterke"), analysis?.output?.swot?.sterke_punten);
  swotList($("#swot-zorg"), analysis?.output?.swot?.mogelijke_zorgpunten);
  swotList($("#swot-kansen"), analysis?.output?.swot?.mogelijke_kansen);
  swotList($("#swot-bedreigingen"), analysis?.output?.swot?.mogelijke_bedreigingen);

  // 5) Toon resultaat + contact
  result.hidden = false;
  $("#contact").hidden = false;
};

/* ============== Main flow ============== */
const btnGenerate = $("#btn-generate");
const btnCancel = $("#btn-cancel");
const btnExport = $("#btn-export");
const form = $("#dossier-form");

let aborter = null;

const start = async () => {
  // Reset UI
  $("#result").hidden = true;
  $("#contact").hidden = true;
  resetPipeline();
  setSpinner(true, "Dossier wordt opgebouwd…");
  btnGenerate.disabled = true;
  btnCancel.hidden = false;
  btnExport.hidden = true;

  // Lees invoer
  const city = $("#city").value.trim();
  const postcode = $("#postcode").value.trim();
  const priceVal = $("#price").value.trim();
  const areaVal = $("#living-area") ? $("#living-area").value.trim() : "";
  const street = $("#street").value.trim();
  const housenr = $("#housenr").value.trim();
  const adText = $("#ad-text").value.trim();
  const advertLink = $("#advert-link").value.trim();

  if (!city) {
    setSpinner(false, "Wachten op invoer");
    logLine("Fout: Plaatsnaam is verplicht.");
    alert("Plaatsnaam is verplicht.");
    btnGenerate.disabled = false;
    btnCancel.hidden = true;
    return;
  }

  const input = {
    city,
    postcode,
    price: priceVal ? Number(priceVal) : undefined,
    livingArea: areaVal ? Number(areaVal) : undefined,
    street,
    housenr,
    advertLink: advertLink || "",
  };

  aborter = new AbortController();
  const signal = aborter.signal;

  try {
    /* Stap 1 — Commune */
    setStep("commune", "active");
    logLine("Raadpleegt gemeente…");
    const qs = new URLSearchParams();
    qs.set("city", city);
    if (postcode) qs.set("postcode", postcode);
    const commune = await fetchJSON(`/api/commune?${qs}`, { signal });
    if (!commune?.commune?.insee) throw new Error("Geen INSEE gevonden");
    setStep("commune", "done", "✔");
    logLine("✔ Raadpleegt gemeente…");

    /* Stap 2 — DVF */
    setStep("dvf", "active");
    logLine("Controleert DVF (verkoopprijzen)…");
    const dvf = await fetchJSON(`/api/dvf?insee=${commune.commune.insee}`, { signal });
    setStep("dvf", "done", dvf?.source || "✔");
    logLine("✔ DVF opgehaald");

    /* (Optioneel) GPU / GPU-docs / Géorisques: we linken in het rapport; stappen markeren als 'skipped' als we ze niet live ophalen */
    setStep("gpu", "skipped", "bekijk link in Omgevingsdossier");
    setStep("gpudoc", "skipped", "bekijk link in Omgevingsdossier");
    setStep("georisques", "skipped", "bekijk link in Omgevingsdossier");

    /* Stap 3 — Analyse (Gemini) */
    setStep("ai", "active");
    logLine("Genereert AI-analyse…");

    const signals = {};
    if (Number.isFinite(input.price)) signals.price = input.price;
    if (Number.isFinite(input.livingArea)) signals.living_area_m2 = input.livingArea;

    if (adText) {
      const kws = [];
      const addIf = (re, label) => { if (re.test(adText.toLowerCase())) kws.push(label); };
      addIf(/double\s+vitrage|dubbel\s+glas/, "double vitrage");
      addIf(/\b(isolatie|isolation)\b/, "isolatie");
      addIf(/travaux|renov/i, "travaux à prévoir");
      signals.advertentie = { keywords: kws };
    }

    const dossierLines = [];
    dossierLines.push(`${postcode ? postcode + " " : ""}${city}`);
    if (street || housenr) dossierLines.push([street, housenr].filter(Boolean).join(" "));
    if (advertLink) dossierLines.push(`Advertentie: ${advertLink}`);
    if (adText) dossierLines.push(`Excerpt advertentie: ${adText.slice(0, 400)}${adText.length > 400 ? "..." : ""}`);

    const analyse = await fetchJSON("/api/analyse", {
      method: "POST",
      body: JSON.stringify({ dossier: dossierLines.join(" — "), signals }),
      headers: { "content-type": "application/json" },
      signal
    });

    setStep("ai", "done", analyse?.model || "✔");
    logLine("✔ Analyse gereed");

    /* Stap 4 — Render */
    setSpinner(false, "Klaar.");
    btnExport.hidden = false;
    renderReport({
      input,
      commune: commune.commune,
      dvf,
      georisques: { summary: [] }, // badges leeg (we verwijzen via links)
      analysis: analyse
    });
  } catch (err) {
    setSpinner(false, "Fout");
    setStep("ai", "error");
    logLine(`Fout: ${err.message || err}`);
    alert(`Er ging iets mis: ${err.message || err}`);
  } finally {
    btnGenerate.disabled = false;
    btnCancel.hidden = true;
  }
};

/* ============== Events ============== */
document.addEventListener("DOMContentLoaded", () => {
  // Woonoppervlakte veld toevoegen als het nog niet bestaat (compat met oudere index)
  if (!$("#living-area")) {
    const fld = document.createElement("div");
    fld.className = "field";
    fld.innerHTML = `
      <label for="living-area">Woonoppervlakte (m²) <span class="muted">(optioneel)</span></label>
      <input id="living-area" name="living-area" type="number" inputmode="numeric" placeholder="Bijv: 120" min="1" step="1"/>
    `;
    const grid = $(".grid");
    if (grid) {
      // plaats na Vraagprijs
      const priceField = $("#price")?.closest(".field");
      if (priceField && priceField.nextSibling) grid.insertBefore(fld, priceField.nextSibling);
      else grid.appendChild(fld);
    }
  }

  resetPipeline();

  btnGenerate?.addEventListener("click", start);

  btnCancel?.addEventListener("click", () => {
    if (aborter) aborter.abort();
    setSpinner(false, "Afgebroken");
    logLine("Gebruiker annuleert de huidige run");
    $$("#progress-pipeline .pipe-step[data-state='active']").forEach(li => li.setAttribute("data-state", "error"));
    btnGenerate.disabled = false;
    btnCancel.hidden = true;
  });

  btnExport?.addEventListener("click", () => {
    window.print();
  });

  // Copy volledige advertentielink
  document.body.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-action='copy-full-link']");
    if (!b) return;
    const url = b.getAttribute("data-url") || "";
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      b.textContent = "Gekopieerd!";
      setTimeout(() => (b.textContent = "Kopieer volledige link"), 1200);
    });
  });
});
