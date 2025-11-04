// /public/script.js
// UI-orchestratie met voortgang + integratie van address-verify, envinfo en compose.
// Belangrijkste wijzigingen in deze versie:
//  - Adresvalidatie (server-side) vóór de pijplijn
//  - Omgevingsdossier gevuld met "onze" data uit /api/envinfo
//  - Notaris & Makelaar: alleen FR; Verkoper: FR/NL/EN/DE
//  - Badges zijn niet-klikbaar (heldere legenda); “coup de cœur” tekst verwijderd

(() => {
  "use strict";

  // Helpers
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const els = {
    form: $("#dossier-form"),
    btnGenerate: $("#btn-generate"),
    btnCancel: $("#btn-cancel"),
    btnExport: $("#btn-export"),

    advertLink: $("#advert-link"),
    city: $("#city"),
    price: $("#price"),
    postcode: $("#postcode"),
    street: $("#street"),
    housenr: $("#housenr"),
    adText: $("#ad-text"),

    spinner: $("#progress-spinner"),
    spinnerLabel: $("#spinner-label"),
    pipeline: $("#progress-pipeline"),
    log: $("#progress-log"),

    result: $("#result"),
    keyfacts: $("#keyfacts"),

    envBadges: $("#env-badges"),
    envLinks: $("#env-links"),
    envSummary: $("#env-summary"),        // nieuw: korte QoL samenvatting
    envLegend: $("#env-legend"),          // legenda

    actList: $("#actieplan-list"),
    swot: {
      sterke: $("#swot-sterke"),
      zorg: $("#swot-zorg"),
      kansen: $("#swot-kansen"),
      bedreigingen: $("#swot-bdreigingen") || $("#swot-bedreigingen")
    },

    contact: $("#contact"),
    btnComposeNotary: $("#btn-compose-notary"),
    btnComposeAgent: $("#btn-compose-agent"),
    btnComposeSeller: $("#btn-compose-seller"),
    composeOutput: $("#compose-output"),
    composeText: $("#compose-text"),

    // statusregels voor adrescontrole
    addrStatus: $("#addr-status")
  };

  let runId = 0;
  let abortControllers = [];
  const slowDemo = new URLSearchParams(location.search).get("demo") === "slow";
  const MIN_STEP_MS = slowDemo ? 800 : 0;

  function newAbort() {
    const c = new AbortController();
    abortControllers.push(c);
    return c;
  }
  function abortAll() {
    abortControllers.forEach(c => { try { c.abort(); } catch {} });
    abortControllers = [];
  }

  function pushLog(t, cls = "") {
    const line = document.createElement("div");
    if (cls) line.className = cls;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    line.textContent = `${hh}:${mm}:${ss} · ${t}`;
    els.log.appendChild(line);
    els.log.scrollTop = els.log.scrollHeight;
  }
  function setSpinnerLabel(t) { els.spinnerLabel.textContent = t; }
  function startSpinner(t = "Dossier wordt opgebouwd…") { els.spinner?.classList.remove("hidden"); setSpinnerLabel(t); }
  function stopSpinner() { els.spinner?.classList.add("hidden"); setSpinnerLabel("Klaar."); }
  function setStepState(key, state, meta = "") {
    const li = $(`.pipe-step[data-step="${key}"]`, els.pipeline);
    if (!li) return;
    li.setAttribute("data-state", state);
    const m = $(`#step-${key}-meta`);
    if (m) m.textContent = meta || "";
  }
  function resetPipeline() {
    $$(".pipe-step", els.pipeline).forEach(li => { li.setAttribute("data-state", "idle"); });
    $$("#progress-pipeline small[id^='step-'][id$='-meta']").forEach(s => s.textContent = "");
    els.log.innerHTML = "";
    startSpinner("Wachten op start…");
  }
  function show(el){ el.hidden = false; }
  function hide(el){ el.hidden = true; }
  function smoothScrollIntoView(el){ try { el.scrollIntoView({ behavior:"smooth", block:"start"});} catch {} }

  function fmtMoney(n) {
    if (typeof n !== "number" || isNaN(n)) return String(n ?? "");
    return n.toLocaleString("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  }
  function cleanUrl(raw) {
    try { const u = new URL(raw); return `${u.origin}${u.pathname}`; } catch { return raw || ""; }
  }
  async function fetchJSON(url, opts={}, tag="fetch") {
    const c = newAbort();
    const r = await fetch(url, { ...opts, signal: c.signal });
    if (!r.ok) {
      const txt = await r.text().catch(()=> "");
      throw new Error(`HTTP ${r.status} @ ${url} – ${txt.slice(0,500)}`);
    }
    return r.json();
  }
  function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

  function buildDossierText() {
    const parts = [];
    const city = els.city.value.trim();
    const postcode = els.postcode.value.trim();
    const street = els.street.value.trim();
    const housenr = els.housenr.value.trim();
    const price = els.price.value.trim();
    const advert = els.advertLink.value.trim();
    const addr = [housenr, street, postcode, city].filter(Boolean).join(" ");
    if (addr) parts.push(`Adres/advertentie: ${addr}`);
    if (price) parts.push(`Vraagprijs: ${price}`);
    if (advert) parts.push(`Advertentie: ${advert}`);
    const adText = els.adText.value.trim();
    if (adText) parts.push(`Advertentietekst: ${adText.slice(0, 2000)}`);
    if (!addr && !advert && !adText && city) parts.push(`Plaats: ${city}`);
    parts.push(`Exact perceelnummer later bij de notaris opvragen.`);
    return parts.join("\n");
  }

  function extractSignals(summary) {
    const sig = {};
    const priceN = Number(els.price.value);
    if (!isNaN(priceN)) sig.price = priceN;

    if (summary?.dvf) {
      sig.dvf = {};
      if (typeof summary.dvf.median_price === "number") sig.dvf.median_price = summary.dvf.median_price;
    }

    if (summary?.georisques?.summary) {
      const map = {};
      summary.georisques.summary.forEach(it => { map[it.key] = !!it.present; });
      sig.georisques = {
        flood: !!map.flood, seismic: !!map.seismic, industrial: !!map.industrial,
        coastal: !!map.coastal, radon: !!map.radon
      };
    }

    const adText = (els.adText.value || "").toLowerCase();
    const kw = [];
    ["travaux","travaux à prévoir","isolation","double vitrage","à rénover","to renovate"].forEach(k => { if (adText.includes(k)) kw.push(k); });
    const towns = [];
    ["-sur-mer","montreuil","berck","nice","lyon","paris","bordeaux","nantes","lille"].forEach(h => { if (adText.includes(h)) towns.push(h); });
    const near_water = /(mer|plage|rivière|canal|fleuve|étang|port)\b/i.test(adText);

    sig.advertentie = { keywords: kw, towns, near_water, truncated: /lire plus|lees meer|read more/i.test(adText) };
    return sig;
  }

  // ---- Address verify (voor de pijplijn) ----
  async function verifyAddress() {
    const city = els.city.value.trim();
    const postcode = els.postcode.value.trim();
    const street = els.street.value.trim();
    const housenr = els.housenr.value.trim();

    if (!city && !street && !housenr) {
      els.addrStatus.textContent = "Adresstatus: alleen plaats bekend.";
      return { best: null, note: "only-city" };
    }

    const qs = new URLSearchParams();
    if (street) qs.set("street", street);
    if (housenr) qs.set("housenr", housenr);
    if (postcode) qs.set("postcode", postcode);
    if (city) qs.set("city", city);
    qs.set("limit", "5");

    try {
      const t0 = performance.now();
      const j = await fetchJSON(`/api/address-verify?${qs.toString()}`, {}, "address-verify");
      const dt = Math.max(MIN_STEP_MS - (performance.now() - t0), 0);
      if (dt) await sleep(dt);

      const best = j?.bestHit || null;
      if (!best) {
        els.addrStatus.textContent = "Adresstatus: geen match gevonden.";
        return { best: null, note: "no-match" };
      }
      els.addrStatus.textContent = `Adresstatus: beste match “${best.label}” (score ${best.score ?? "?"}).`;
      return { best, note: j?.mismatchHints?.length ? j.mismatchHints.join("; ") : "" };
    } catch (e) {
      els.addrStatus.textContent = "Adresstatus: kon niet verifiëren.";
      return { best: null, note: "error" };
    }
  }

  // ---- Pijplijnstappen (bestaand) ----
  async function stepCommune(ctx) {
    setSpinnerLabel("Dossier wordt opgebouwd…");
    setStepState("commune", "active", "");
    pushLog("Raadpleegt gemeente…");
    const qs = new URLSearchParams();
    if (ctx.input.city) qs.set("city", ctx.input.city);
    if (ctx.input.postcode) qs.set("postcode", ctx.input.postcode);
    const url = `/api/commune?${qs.toString()}`;
    const t0 = performance.now();
    const json = await fetchJSON(url, {}, "commune");
    const dt = Math.max(MIN_STEP_MS - (performance.now() - t0), 0);
    if (dt) await sleep(dt);
    setStepState("commune", "done", json?.commune ? `INSEE: ${json.commune.insee}` : "—");
    pushLog("✔ Raadpleegt gemeente…", "ok");
    return { insee: json?.commune?.insee, commune: json?.commune };
  }
  async function stepGPU(ctx) {
    setStepState("gpu", "active");
    if (!ctx.insee) { setStepState("gpu","done","Geen INSEE → overgeslagen"); pushLog("ℹ Geen INSEE: slaat GPU over","warn"); return { gpu:null }; }
    pushLog("Raadpleegt GPU (zonering)...");
    const t0 = performance.now();
    const json = await fetchJSON(`/api/gpu?insee=${encodeURIComponent(ctx.insee)}`, {}, "gpu");
    const dt = Math.max(MIN_STEP_MS - (performance.now() - t0), 0);
    if (dt) await sleep(dt);
    setStepState("gpu", "done", (json?.zones?.length || 0) + " zone(s)");
    pushLog("✔ GPU gereed","ok");
    return { gpu: json };
  }
  async function stepGPUDoc(ctx) {
    setStepState("gpudoc", "active");
    if (!ctx.insee) { setStepState("gpudoc","done","Geen INSEE → overgeslagen"); pushLog("ℹ Geen INSEE: slaat GPU-docs over","warn"); return { gpudoc:null }; }
    pushLog("Haalt GPU-documenten op...");
    const t0 = performance.now();
    const json = await fetchJSON(`/api/gpu-doc?insee=${encodeURIComponent(ctx.insee)}`, {}, "gpudoc");
    const dt = Math.max(MIN_STEP_MS - (performance.now() - t0), 0);
    if (dt) await sleep(dt);
    setStepState("gpudoc","done", (json?.documents?.length || 0)+" document(en)");
    pushLog("✔ GPU-documenten gereed","ok");
    return { gpudoc: json };
  }
  async function stepDVF(ctx) {
    setStepState("dvf", "active");
    if (!ctx.insee) { setStepState("dvf","done","Geen INSEE → overgeslagen"); pushLog("ℹ Geen INSEE: slaat DVF over","warn"); return { dvf:null }; }
    pushLog("Controleert DVF (verkoopprijzen)...");
    const t0 = performance.now();
    const json = await fetchJSON(`/api/dvf?insee=${encodeURIComponent(ctx.insee)}`, {}, "dvf");
    const dt = Math.max(MIN_STEP_MS - (performance.now() - t0), 0);
    if (dt) await sleep(dt);
    const note = json?.summary ? "Samenvatting aanwezig" : (json?.note || "—");
    setStepState("dvf", "done", note);
    pushLog("✔ DVF gecontroleerd","ok");
    return { dvf: json };
  }
  async function stepGeorisques(ctx) {
    setStepState("georisques", "active");
    if (!ctx.insee) { setStepState("georisques","done","Geen INSEE → overgeslagen"); pushLog("ℹ Geen INSEE: slaat Géorisques over","warn"); return { georisques:null }; }
    pushLog("Checkt Géorisques (risico’s)...");
    const t0 = performance.now();
    const json = await fetchJSON(`/api/georisques?insee=${encodeURIComponent(ctx.insee)}`, {}, "georisques");
    const dt = Math.max(MIN_STEP_MS - (performance.now() - t0), 0);
    if (dt) await sleep(dt);
    const count = Array.isArray(json?.summary) ? json.summary.length : 0;
    setStepState("georisques", "done", `${count} categorieën`);
    pushLog("✔ Géorisques gecheckt","ok");
    return { georisques: json };
  }

  async function stepEnvInfo(ctx) {
    // nieuw: Omgevingsdossier uit eigen endpoint
    setStepState("envinfo", "active");
    if (!ctx.insee) {
      setStepState("envinfo", "done", "Geen INSEE → beperkte context");
      pushLog("ℹ Geen INSEE: omgevingsdata beperkt.", "warn");
      return { envinfo: null };
    }
    pushLog("Verzamelt omgevingsinfo…");
    const t0 = performance.now();
    const json = await fetchJSON(`/api/envinfo?insee=${encodeURIComponent(ctx.insee)}`, {}, "envinfo");
    const dt = Math.max(MIN_STEP_MS - (performance.now() - t0), 0);
    if (dt) await sleep(dt);
    setStepState("envinfo", "done", json?.commune?.population ? `${json.commune.population} inwoners` : "—");
    pushLog("✔ Omgevingsinfo gereed", "ok");
    return { envinfo: json };
  }

  async function stepAI(ctx) {
    setStepState("ai", "active");
    setSpinnerLabel("Analyseert (Gemini)…");
    pushLog("Genereert AI-analyse…");
    const dossier = buildDossierText();
    const signals = extractSignals(ctx.summary);
    const t0 = performance.now();
    const json = await fetchJSON("/api/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dossier, signals })
    }, "analyse");
    const dt = Math.max(MIN_STEP_MS - (performance.now() - t0), 0);
    if (dt) await sleep(dt);
    setStepState("ai", "done", json?.model || "—");
    pushLog("✔ Analyse gereed", "ok");
    stopSpinner();
    return { analysis: json };
  }

  // --- Rendering ---
  function renderKeyFacts() {
    const rows = [];
    const addr = [els.housenr.value.trim(), els.street.value.trim(), els.postcode.value.trim(), els.city.value.trim()]
      .filter(Boolean).join(" ");
    rows.push(["Invoer:", addr || "—"]);
    const priceV = els.price.value.trim();
    rows.push(["Vraagprijs:", priceV ? `${fmtMoney(Number(priceV) || priceV)} (facultatief maar aanbevolen)` : "—"]);
    rows.push(["Exact perceel:", "later opvragen bij notaris"]);
    const raw = els.advertLink.value.trim();
    if (raw) {
      const short = cleanUrl(raw);
      const v = document.createElement("span");
      const a = document.createElement("a");
      a.href = raw; a.target = "_blank"; a.rel = "noopener";
      a.textContent = short;
      const btn = document.createElement("button");
      btn.className = "link-mini";
      btn.textContent = "Kopieer volledige link";
      btn.dataset.full = raw;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        navigator.clipboard.writeText(btn.dataset.full || raw).then(() => {
          btn.textContent = "Gekopieerd!";
          setTimeout(() => (btn.textContent = "Kopieer volledige link"), 1400);
        }).catch(()=>{});
      });
      v.appendChild(a); v.appendChild(document.createTextNode(" ")); v.appendChild(btn);
      rows.push(["Advertentielink:", v]);
    }

    els.keyfacts.innerHTML = "";
    rows.forEach(([k, v]) => {
      const wrap = document.createElement("div"); wrap.className = "fact";
      const kEl = document.createElement("span"); kEl.className = "k"; kEl.textContent = k;
      const vEl = document.createElement("span"); vEl.className = "v";
      if (v instanceof HTMLElement) vEl.appendChild(v); else vEl.textContent = v;
      const grid = document.createElement("div"); grid.style.display = "contents";
      const c1 = document.createElement("div"), c2 = document.createElement("div");
      c1.appendChild(kEl); c2.appendChild(vEl); wrap.appendChild(c1); wrap.appendChild(c2);
      els.keyfacts.appendChild(wrap);
    });
  }

  function renderEnv(summary, envinfo) {
    // Legenda
    if (els.envLegend) els.envLegend.textContent = "Legenda: ✅ geen aanwijzing • ⚠ risico aanwezig • — onbekend";
    // Badges (Géorisques)
    els.envBadges.innerHTML = "";
    const s = summary?.georisques?.summary || [];
    const map = { flood:"Overstroming", coastal:"Kust", industrial:"Industrieel", seismic:"Seismisch", radon:"Radon", clay:"Klei/krimp", forestfire:"Bosbrand" };
    ["flood","coastal","industrial","seismic","radon","clay","forestfire"].forEach(key => {
      const it = s.find(x => x.key === key);
      const badge = document.createElement("span");
      badge.className = "badge"; badge.style.cursor = "default";
      const label = map[key] || key;
      if (!it) { badge.classList.add("badge-na"); badge.textContent = `— ${label}`; }
      else if (it.present === true) { badge.classList.add("badge-danger"); badge.textContent = `⚠ ${label}`; }
      else if (it.present === false) { badge.classList.add("badge-ok"); badge.textContent = `✅ ${label}`; }
      else { badge.classList.add("badge-na"); badge.textContent = `— ${label}`; }
      els.envBadges.appendChild(badge);
    });

    // Links
    els.envLinks.innerHTML = "";
    const links = [];
    if (envinfo?.links?.geoportail) links.push({ href: envinfo.links.geoportail, text: "Géoportail Urbanisme" });
    if (envinfo?.links?.georisques) links.push({ href: envinfo.links.georisques, text: "Géorisques – gemeente" });
    if (summary?.dvf?.links?.etalab_app || envinfo?.links?.dvf_app) {
      links.push({ href: (summary?.dvf?.links?.etalab_app || envinfo?.links?.dvf_app), text: "DVF – Etalab" });
    }
    links.forEach(l => {
      const a = document.createElement("a");
      a.href = l.href; a.target = "_blank"; a.rel = "noopener"; a.textContent = l.text;
      els.envLinks.appendChild(a);
    });

    // Korte samenvatting
    const parts = [];
    if (envinfo?.commune?.population) parts.push(`${envinfo.commune.population.toLocaleString("nl-NL")} inwoners`);
    if (Array.isArray(envinfo?.around?.heritage) && envinfo.around.heritage.length) parts.push(`${envinfo.around.heritage.length} monumenten ≤10 km`);
    if (envinfo?.around?.coast_km != null) parts.push(`kust op ${envinfo.around.coast_km} km`);
    if (envinfo?.around?.ski?.name) parts.push(`skigebied: ${envinfo.around.ski.name} (${envinfo.around.ski.km} km)`);
    els.envSummary.textContent = parts.length ? parts.join(" • ") : "—";
  }

  function renderActieplan(list) {
    els.actList.innerHTML = "";
    const lines = (Array.isArray(list) ? list : String(list || "").split("\n")).map(s => s.trim()).filter(Boolean);
    lines.forEach(line => { const li=document.createElement("li"); li.textContent = line.replace(/^[-•]\s*/,"• "); els.actList.appendChild(li); });
  }
  function renderSWOT(swot) {
    const fill = (el, arr) => {
      el.innerHTML = "";
      (Array.isArray(arr) ? arr : []).forEach(t => { const li=document.createElement("li"); li.textContent=String(t).replace(/^[-•]\s*/,"• "); el.appendChild(li); });
    };
    fill(els.swot.sterke, swot?.sterke_punten || []);
    fill(els.swot.zorg, swot?.mogelijke_zorgpunten || []);
    fill(els.swot.kansen, swot?.mogelijke_kansen || []);
    fill(els.swot.bedreigingen, swot?.mogelijke_bedreigingen || []);
  }

  // Compose
  function updateComposeButtonsText() {
    const mapping = {
      notary: { role: "notary-fr", noun: "notaris" },
      agent:  { role: "agent-nl",  noun: "makelaar" },
      seller: { role: "seller-mixed", noun: "verkoper" }
    };
    [{who:"notary",el:els.btnComposeNotary},{who:"agent",el:els.btnComposeAgent},{who:"seller",el:els.btnComposeSeller}]
      .forEach(({who,el}) => {
        const channel = $(`input[name="channel-${who}"]:checked`)?.value || "email";
        const kind = channel === "letter" ? "brief" : "bericht";
        // taal is visueel; serverrol blijft vast (FR voor notaris/makelaar, mixed voor verkoper)
        el.textContent = `Maak ${kind} voor ${mapping[who].noun}`;
      });
  }
  async function composeMessage(who) {
    const channel = $(`input[name="channel-${who}"]:checked`)?.value || "email";
    const dossier = buildDossierText();
    const role = (who === "notary") ? "notary-fr" : (who === "agent") ? "agent-nl" : "seller-mixed";
    els.composeText.textContent = "";
    show(els.composeOutput);
    try {
      const json = await fetchJSON("/api/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, dossier, channel })
      }, "compose");
      els.composeText.textContent = json?.output?.letter_text || "(Geen tekst ontvangen.)";
    } catch (e) {
      els.composeText.textContent = String(e.message || e);
    }
  }

  // Main
  async function runMakeDossier() {
    runId += 1;
    const myRun = runId;
    abortAll();
    resetPipeline();
    show(els.btnCancel); hide(els.btnExport); hide(els.result); hide(els.contact); els.composeOutput.hidden = true;
    startSpinner("Dossier wordt opgebouwd…");

    const input = { city: els.city.value.trim(), postcode: els.postcode.value.trim() };
    if (!input.city) { setSpinnerLabel("Plaatsnaam is verplicht."); pushLog("Plaatsnaam ontbreekt.", "err"); hide(els.btnCancel); stopSpinner(); return; }

    try {
      // 0) Adresvalidatie
      setStepState("addr", "active");
      pushLog("Verifieert adres…");
      const ver = await verifyAddress();
      setStepState("addr", "done", ver?.best ? "match" : "—");

      // 1) Commune
      const c = await stepCommune({ input }); if (myRun !== runId) return;

      // 2) GPU
      const g = await stepGPU({ insee: c.insee }); if (myRun !== runId) return;

      // 3) GPU-doc
      const gd = await stepGPUDoc({ insee: c.insee }); if (myRun !== runId) return;

      // 4) DVF
      const d = await stepDVF({ insee: c.insee }); if (myRun !== runId) return;

      // 5) Géorisques
      const gr = await stepGeorisques({ insee: c.insee }); if (myRun !== runId) return;

      // 6) Omgeving
      const ev = await stepEnvInfo({ insee: c.insee }); if (myRun !== runId) return;

      const summary = { commune: c.commune || null, insee: c.insee || null, gpu: g.gpu || null, gpudoc: gd.gpudoc || null, dvf: d.dvf || null, georisques: gr.georisques || null };

      // 7) AI
      const a = await stepAI({ summary }); if (myRun !== runId) return;

      // Render
      renderKeyFacts();
      renderEnv(summary, ev.envinfo);
      renderActieplan(a.analysis?.output?.actieplan || []);
      renderSWOT(a.analysis?.output?.swot || {});
      show(els.result); show(els.btnExport);
      smoothScrollIntoView(els.result);
      setTimeout(() => { show(els.contact); els.contact.classList.add("reveal"); smoothScrollIntoView(els.contact); }, 450);

    } catch (e) {
      const active = $(".pipe-step[data-state='active']"); if (active) active.setAttribute("data-state", "error");
      pushLog(String(e.message || e), "err"); setSpinnerLabel("Fout bij opbouwen.");
    } finally {
      hide(els.btnCancel); stopSpinner(); abortControllers = [];
    }
  }

  // Events
  els.btnGenerate?.addEventListener("click", runMakeDossier);
  els.btnCancel?.addEventListener("click", () => { pushLog("Gebruiker annuleert de huidige run"); abortAll(); setSpinnerLabel("Geannuleerd."); hide(els.btnCancel); stopSpinner(); });
  els.btnExport?.addEventListener("click", () => { window.print(); setTimeout(() => smoothScrollIntoView(els.contact), 250); });
  els.btnComposeNotary?.addEventListener("click", () => composeMessage("notary"));
  els.btnComposeAgent?.addEventListener("click", () => composeMessage("agent"));
  els.btnComposeSeller?.addEventListener("click", () => composeMessage("seller"));

  // Taal/kanaal-opties: Notaris/Makelaar alleen FR; Verkoper FR/NL/EN/DE — UI radios verwacht aanwezig te zijn
  ["notary","agent","seller"].forEach(w => {
    $$(`input[name="channel-${w}"], input[name="lang-${w}"]`).forEach(r => r.addEventListener("change", updateComposeButtonsText));
  });
  updateComposeButtonsText();
  resetPipeline();
})();
