// /public/script.js
// IMMODIAGNOSTIQUE front-end orchestration
// - Alle externe calls lopen via /api/*
// - Showpiece voortgang met pipeline + “slow demo” (?demo=slow)
// - Contactkanaal + taal per ontvanger; knoptekst past zich aan
// - Resultaatpaneel met nette URL-weergave en “Exporteer rapport”

(() => {
  "use strict";

  // ---------- DOM helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const els = {
    form: $("#dossier-form"),
    btnGenerate: $("#btn-generate"),
    btnCancel: $("#btn-cancel"),
    btnExport: $("#btn-export"),
    // inputs
    advertLink: $("#advert-link"),
    city: $("#city"),
    price: $("#price"),
    postcode: $("#postcode"),
    street: $("#street"),
    housenr: $("#housenr"),
    adText: $("#ad-text"),
    // progress
    spinner: $("#progress-spinner"),
    spinnerLabel: $("#spinner-label"),
    pipeline: $("#progress-pipeline"),
    log: $("#progress-log"),
    // result
    result: $("#result"),
    keyfacts: $("#keyfacts"),
    envBadges: $("#env-badges"),
    envLinks: $("#env-links"),
    actList: $("#actieplan-list"),
    swot: {
      sterke: $("#swot-sterke"),
      zorg: $("#swot-zorg"),
      kansen: $("#swot-kansen"),
      bedreigingen: $("#swot-bedreigingen")
    },
    coupWarning: $("#coup-warning"),
    // contact
    contact: $("#contact"),
    btnComposeNotary: $("#btn-compose-notary"),
    btnComposeAgent: $("#btn-compose-agent"),
    btnComposeSeller: $("#btn-compose-seller"),
    composeOutput: $("#compose-output"),
    composeText: $("#compose-text")
  };

  // ---------- State ----------
  let runId = 0;
  let abortControllers = [];
  let slowDemo = new URLSearchParams(location.search).get("demo") === "slow";
  const MIN_STEP_MS = slowDemo ? 800 : 0; // UI-only ‘slow’ show; backend blijft snel

  // ---------- Utilities ----------
  function cleanUrl(raw) {
    try {
      const u = new URL(raw);
      return `${u.origin}${u.pathname}`;
    } catch {
      return raw || "";
    }
  }

  function fmtMoney(n) {
    if (typeof n !== "number" || isNaN(n)) return String(n ?? "");
    return n.toLocaleString("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  }

  function sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

  function pushLog(text, cls = "") {
    const line = document.createElement("div");
    if (cls) line.className = cls;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    line.textContent = `${hh}:${mm}:${ss} · ${text}`;
    els.log.appendChild(line);
    els.log.scrollTop = els.log.scrollHeight;
  }

  function setSpinnerLabel(text) {
    els.spinnerLabel.textContent = text;
  }

  function setStepState(stepKey, state, metaText = "") {
    const li = $(`.pipe-step[data-step="${stepKey}"]`, els.pipeline);
    if (!li) return;
    li.setAttribute("data-state", state);
    const meta = $(`#step-${stepKey}-meta`);
    if (metaText) meta.textContent = metaText;
  }

  function resetPipeline() {
    $$(".pipe-step", els.pipeline).forEach(li => {
      li.setAttribute("data-state", "idle");
      const key = li.getAttribute("data-step");
      const meta = $(`#step-${key}-meta`);
      if (meta) meta.textContent = "";
    });
    els.log.innerHTML = "";
    setSpinnerLabel("Wachten op start…");
  }

  function show(el) { el.hidden = false; }
  function hide(el) { el.hidden = true; }

  function smoothScrollIntoView(el) {
    try { el.scrollIntoView({ behavior: "smooth", block: "start" }); } catch {}
  }

  function newAbort() {
    const c = new AbortController();
    abortControllers.push(c);
    return c;
  }

  function abortAll() {
    abortControllers.forEach(c => { try { c.abort(); } catch {} });
    abortControllers = [];
  }

  // ---------- Data wiring ----------
  async function fetchJSON(url, opts = {}, stepKeyForError) {
    const ctrl = newAbort();
    const options = { ...opts, signal: ctrl.signal };
    let res;
    try {
      res = await fetch(url, options);
    } catch (e) {
      throw new Error(`Netwerkfout (${stepKeyForError || "fetch"}): ${e.message}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} op ${url} – ${text}`.slice(0, 500));
    }
    return res.json();
  }

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

    if (!addr && !advert && !adText) {
      // minimale context
      if (city) parts.push(`Plaats: ${city}`);
    }
    parts.push(`Exact perceelnummer later bij de notaris opvragen.`);
    return parts.join("\n");
  }

  function extractSignals(summary) {
    // Minimalistische signalen op basis van summary-API en UI
    const sig = {};
    const priceN = Number(els.price.value);
    if (!isNaN(priceN)) sig.price = priceN;

    // DVF (onze /api/dvf geeft vaak summary=null; we geven alleen placeholder)
    if (summary?.dvf) {
      sig.dvf = {};
      if (typeof summary.dvf.median_price === "number") {
        sig.dvf.median_price = summary.dvf.median_price;
      }
    }

    // Géorisques
    if (summary?.georisques?.summary) {
      const map = {};
      summary.georisques.summary.forEach(it => {
        // it.present === true betekent risico aanwezig; false = geen risico
        map[it.key] = !!it.present;
      });
      sig.georisques = {
        flood: !!map.flood,
        seismic: !!map.seismic,
        industrial: !!map.industrial,
        coastal: !!map.coastal,
        radon: !!map.radon
      };
    }

    // Advertentie: simpele keywords
    const adText = (els.adText.value || "").toLowerCase();
    const kw = [];
    ["travaux", "travaux à prévoir", "isolation", "double vitrage", "à rénover", "to renovate"].forEach(k => {
      if (adText.includes(k)) kw.push(k);
    });

    // towns uit advertentietekst heuristiek (zeer lichtgewicht, helpt de AI iets)
    const towns = [];
    const townHints = ["-sur-mer", "montreuil", "berck", "nice", "lyon", "paris", "bordeaux", "nantes", "lille"];
    townHints.forEach(h => {
      if (adText.includes(h)) towns.push(h);
    });

    const near_water = /(mer|plage|rivière|canal|fleuve|étang|port)\b/i.test(adText);
    sig.advertentie = {
      keywords: kw,
      towns,
      near_water,
      truncated: /lire plus|lees meer|read more/i.test(adText)
    };

    return sig;
  }

  // ---------- Pipeline steps ----------
  async function stepCommune(ctx) {
    const { city, postcode } = ctx.input;
    setSpinnerLabel("Dossier wordt opgebouwd…");
    setStepState("commune", "active", "");
    pushLog("Raadpleegt gemeente…");
    const qs = new URLSearchParams();
    if (city) qs.set("city", city);
    if (postcode) qs.set("postcode", postcode);
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
    pushLog("Raadpleegt GPU (zonering)...");
    if (!ctx.insee) {
      setStepState("gpu", "done", "Geen INSEE → overgeslagen");
      pushLog("ℹ Geen INSEE: slaat GPU over", "warn");
      return { gpu: null };
    }
    const url = `/api/gpu?insee=${encodeURIComponent(ctx.insee)}`;
    const t0 = performance.now();
    const json = await fetchJSON(url, {}, "gpu");
    const dt = Math.max(MIN_STEP_MS - (performance.now() - t0), 0);
    if (dt) await sleep(dt);
    setStepState("gpu", "done", (json?.zones?.length || 0) + " zone(s)");
    pushLog("✔ GPU gereed", "ok");
    return { gpu: json };
  }

  async function stepGPUDoc(ctx) {
    setStepState("gpudoc", "active");
    pushLog("Haalt GPU-documenten op...");
    if (!ctx.insee) {
      setStepState("gpudoc", "done", "Geen INSEE → overgeslagen");
      pushLog("ℹ Geen INSEE: slaat GPU-docs over", "warn");
      return { gpudoc: null };
    }
    const url = `/api/gpu-doc?insee=${encodeURIComponent(ctx.insee)}`;
    const t0 = performance.now();
    const json = await fetchJSON(url, {}, "gpudoc");
    const dt = Math.max(MIN_STEP_MS - (performance.now() - t0), 0);
    if (dt) await sleep(dt);
    setStepState("gpudoc", "done", (json?.documents?.length || 0) + " document(en)");
    pushLog("✔ GPU-documenten gereed", "ok");
    return { gpudoc: json };
  }

  async function stepDVF(ctx) {
    setStepState("dvf", "active");
    pushLog("Controleert DVF (verkoopprijzen)...");
    if (!ctx.insee) {
      setStepState("dvf", "done", "Geen INSEE → overgeslagen");
      pushLog("ℹ Geen INSEE: slaat DVF over", "warn");
      return { dvf: null };
    }
    const url = `/api/dvf?insee=${encodeURIComponent(ctx.insee)}`;
    const t0 = performance.now();
    const json = await fetchJSON(url, {}, "dvf");
    const dt = Math.max(MIN_STEP_MS - (performance.now() - t0), 0);
    if (dt) await sleep(dt);
    const note = json?.summary ? "Samenvatting aanwezig" : (json?.note || "—");
    setStepState("dvf", "done", note);
    pushLog("✔ DVF gecontroleerd", "ok");
    return { dvf: json };
  }

  async function stepGeorisques(ctx) {
    setStepState("georisques", "active");
    pushLog("Checkt Géorisques (risico’s)...");
    if (!ctx.insee) {
      setStepState("georisques", "done", "Geen INSEE → overgeslagen");
      pushLog("ℹ Geen INSEE: slaat Géorisques over", "warn");
      return { georisques: null };
    }
    const url = `/api/georisques?insee=${encodeURIComponent(ctx.insee)}`;
    const t0 = performance.now();
    const json = await fetchJSON(url, {}, "georisques");
    const dt = Math.max(MIN_STEP_MS - (performance.now() - t0), 0);
    if (dt) await sleep(dt);
    const count = Array.isArray(json?.summary) ? json.summary.length : 0;
    setStepState("georisques", "done", `${count} categorieën`);
    pushLog("✔ Géorisques gecheckt", "ok");
    return { georisques: json };
  }

  async function stepAI(ctx) {
    setStepState("ai", "active");
    setSpinnerLabel("Analyseert (Gemini)…");
    pushLog("Genereert AI-analyse…");

    const dossier = buildDossierText();
    const signals = extractSignals(ctx.summary);

    const t0 = performance.now();
    const body = JSON.stringify({ dossier, signals });
    const json = await fetchJSON("/api/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    }, "analyse");
    const dt = Math.max(MIN_STEP_MS - (performance.now() - t0), 0);
    if (dt) await sleep(dt);

    setStepState("ai", "done", json?.model || "—");
    pushLog("✔ Analyse gereed", "ok");
    setSpinnerLabel("Klaar.");

    return { analysis: json };
  }

  // ---------- Rendering ----------
  function renderKeyFacts(ctx) {
    const rows = [];
    const addrParts = [
      els.housenr.value.trim(),
      els.street.value.trim(),
      els.postcode.value.trim(),
      els.city.value.trim()
    ].filter(Boolean).join(" ");
    rows.push([ "Invoer:", addrParts || "—" ]);

    const priceV = els.price.value.trim();
    rows.push([ "Vraagprijs:", priceV ? `${fmtMoney(Number(priceV) || priceV)} (facultatief maar aanbevolen)` : "—" ]);

    rows.push([ "Exact perceel:", "later opvragen bij notaris" ]);

    const raw = els.advertLink.value.trim();
    if (raw) {
      const short = cleanUrl(raw);
      const v = document.createElement("span");
      const a = document.createElement("a");
      a.href = raw;
      a.target = "_blank";
      a.rel = "noopener";
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
        }).catch(() => {});
      });
      v.appendChild(a);
      v.appendChild(document.createTextNode(" "));
      v.appendChild(btn);
      rows.push([ "Advertentielink:", v ]);
    }

    els.keyfacts.innerHTML = "";
    rows.forEach(([k, v]) => {
      const wrap = document.createElement("div");
      wrap.className = "fact";
      const kk = document.createElement("span");
      kk.className = "k";
      kk.textContent = k;
      const vv = document.createElement("span");
      vv.className = "v";
      if (v instanceof HTMLElement) {
        vv.appendChild(v);
      } else {
        vv.textContent = v;
      }
      // grid layout: two columns
      const grid = document.createElement("div");
      grid.style.display = "contents"; // preserve grid from parent
      const kCell = document.createElement("div");
      const vCell = document.createElement("div");
      kCell.appendChild(kk);
      vCell.appendChild(vv);
      wrap.appendChild(kCell);
      wrap.appendChild(vCell);
      els.keyfacts.appendChild(wrap);
    });
  }

  function renderEnv(summary, meta) {
    // Badges op basis van georisques.summary
    els.envBadges.innerHTML = "";
    const s = summary?.georisques?.summary || [];
    const map = {
      flood: "Overstroming",
      clay: "Klei/krimp",
      seismic: "Seismisch",
      radon: "Radon",
      industrial: "Industrieel",
      coastal: "Kust",
      forestfire: "Bosbrand"
    };
    const keyOrder = ["flood","coastal","industrial","seismic","radon","clay","forestfire"];
    keyOrder.forEach(key => {
      const it = s.find(x => x.key === key);
      const badge = document.createElement("span");
      badge.className = "badge";
      const label = map[key] || key;
      if (!it) {
        badge.classList.add("badge-na");
        badge.textContent = `— ${label}`;
      } else if (it.present === true) {
        badge.classList.add("badge-danger");
        badge.textContent = `⚠ ${label}`;
      } else if (it.present === false) {
        badge.classList.add("badge-ok");
        badge.textContent = `✅ ${label}`;
      } else {
        badge.classList.add("badge-na");
        badge.textContent = `— ${label}`;
      }
      els.envBadges.appendChild(badge);
    });

    // Links
    els.envLinks.innerHTML = "";
    const links = [];
    if (summary?.gpu?.links?.gpu_site_commune) {
      links.push({ href: summary.gpu.links.gpu_site_commune, text: "Géoportail Urbanisme" });
    }
    if (summary?.georisques?.links?.commune) {
      links.push({ href: summary.georisques.links.commune, text: "Géorisques – gemeente" });
    }
    if (summary?.dvf?.links?.etalab_app) {
      links.push({ href: summary.dvf.links.etalab_app, text: "DVF – Etalab" });
    }
    links.forEach(l => {
      const a = document.createElement("a");
      a.href = l.href;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = l.text;
      els.envLinks.appendChild(a);
    });
  }

  function renderActieplan(list) {
    els.actList.innerHTML = "";
    const lines = (Array.isArray(list) ? list : String(list || "").split("\n"))
      .map(s => s.trim()).filter(Boolean);
    lines.forEach(line => {
      const li = document.createElement("li");
      li.textContent = line.replace(/^[-•]\s*/, "• ");
      els.actList.appendChild(li);
    });
  }

  function renderSWOT(swot) {
    const fill = (el, arr) => {
      el.innerHTML = "";
      (Array.isArray(arr) ? arr : []).forEach(item => {
        const li = document.createElement("li");
        li.textContent = String(item).replace(/^[-•]\s*/, "• ");
        el.appendChild(li);
      });
    };
    fill(els.swot.sterke, swot?.sterke_punten || []);
    fill(els.swot.zorg, swot?.mogelijke_zorgpunten || []);
    fill(els.swot.kansen, swot?.mogelijke_kansen || []);
    fill(els.swot.bedreigingen, swot?.mogelijke_bedreigingen || []);

    // Toon waarschuwing “coup de cœur” altijd bij analyse
    show(els.coupWarning);
  }

  function revealContact() {
    // zichtbaarheid + animatie + scroll
    show(els.contact);
    els.contact.classList.add("reveal");
    smoothScrollIntoView(els.contact);
  }

  function updateComposeButtonsText() {
    // Kanaal => buttonlabel ("bericht" of "brief")
    const map = [
      { who: "notary", el: els.btnComposeNotary },
      { who: "agent", el: els.btnComposeAgent },
      { who: "seller", el: els.btnComposeSeller }
    ];
    map.forEach(({ who, el }) => {
      const channel = $(`input[name="channel-${who}"]:checked`)?.value || "email";
      const lang = $(`input[name="lang-${who}"]:checked`)?.value || (who === "notary" ? "fr" : who === "agent" ? "nl" : "nl");
      const noun =
        who === "notary" ? "notaris" :
        who === "agent" ? "makelaar" : "verkoper";
      const kind = channel === "letter" ? "brief" : "bericht";
      const suffixLang = lang.toUpperCase();
      el.textContent = `Maak ${kind} voor ${noun} (${suffixLang})`;
    });
  }

  async function composeMessage(recipient) {
    // Bepaal kanaal + taal → rol + channel (server mag deze hints meenemen)
    const channel = $(`input[name="channel-${recipient}"]:checked`)?.value || "email";
    const lang = $(`input[name="lang-${recipient}"]:checked`)?.value || (recipient === "notary" ? "fr" : recipient === "agent" ? "nl" : "nl");

    const role = `${recipient}-${lang}`; // bijv. "notary-fr", "agent-nl", "seller-en"
    const dossier = buildDossierText();

    els.composeText.textContent = "";
    show(els.composeOutput);

    try {
      const json = await fetchJSON("/api/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, dossier, channel })
      }, "compose");

      const text = json?.output?.letter_text || "(Geen tekst ontvangen.)";
      els.composeText.textContent = text;
    } catch (e) {
      els.composeText.textContent = String(e.message || e);
    }
  }

  // ---------- Main runner ----------
  async function runMakeDossier() {
    runId += 1;
    const myRun = runId;
    abortAll(); // oude pending calls annuleren
    resetPipeline();
    show(els.btnCancel);
    hide(els.btnExport);
    hide(els.result);
    hide(els.contact);
    els.composeOutput.hidden = true;
    setSpinnerLabel("Dossier wordt opgebouwd…");

    const input = {
      city: els.city.value.trim(),
      postcode: els.postcode.value.trim()
    };

    if (!input.city) {
      setSpinnerLabel("Plaatsnaam is verplicht.");
      pushLog("Plaatsnaam ontbreekt – voer minstens de plaatsnaam in.", "err");
      hide(els.btnCancel);
      return;
    }

    try {
      // 1) Commune
      const c = await stepCommune({ input });
      if (myRun !== runId) return; // geannuleerd

      // 2) GPU
      const g = await stepGPU({ insee: c.insee });
      if (myRun !== runId) return;

      // 3) GPU-doc
      const gd = await stepGPUDoc({ insee: c.insee });
      if (myRun !== runId) return;

      // 4) DVF
      const d = await stepDVF({ insee: c.insee });
      if (myRun !== runId) return;

      // 5) Géorisques
      const gr = await stepGeorisques({ insee: c.insee });
      if (myRun !== runId) return;

      const summary = {
        commune: c.commune || null,
        insee: c.insee || null,
        gpu: g.gpu || null,
        gpudoc: gd.gpudoc || null,
        dvf: d.dvf || null,
        georisques: gr.georisques || null
      };

      if (!summary.insee) {
        pushLog("ℹ Geen INSEE: alleen basisdossier zonder officiële bronnen", "warn");
      }

      // 6) AI analyse
      const a = await stepAI({ summary });
      if (myRun !== runId) return;

      // ---------- Render ----------
      renderKeyFacts({ input, summary });
      renderEnv(summary);
      renderActieplan(a.analysis?.output?.actieplan || []);
      renderSWOT(a.analysis?.output?.swot || {});

      // Toon resultaat + export + “Direct contact”
      show(els.result);
      show(els.btnExport);
      smoothScrollIntoView(els.result);

      // Na render: laten we de contactsectie “wow” laten inschuiven
      setTimeout(revealContact, 450);

    } catch (e) {
      // Zoek actief stepKey via laatste 'active'
      const active = $(".pipe-step[data-state='active']");
      if (active) {
        const stepKey = active.getAttribute("data-step");
        setStepState(stepKey, "error", "Fout");
      }
      pushLog(String(e.message || e), "err");
      setSpinnerLabel("Fout bij opbouwen.");
    } finally {
      hide(els.btnCancel);
      abortControllers = [];
    }
  }

  // ---------- Events ----------
  els.btnGenerate?.addEventListener("click", () => {
    runMakeDossier();
  });

  els.btnCancel?.addEventListener("click", () => {
    // Hard cancel van deze run
    pushLog("Gebruiker annuleert de huidige run");
    abortAll();
    // Zet actieve stap op stop
    const active = $(".pipe-step[data-state='active']");
    if (active) {
      const title = $(".pipe-title", active)?.textContent || "Actieve stap";
      pushLog(`⏹ Afgebroken: ${title}`);
      active.setAttribute("data-state", "idle");
    }
    setSpinnerLabel("Geannuleerd.");
    hide(els.btnCancel);
  });

  els.btnExport?.addEventListener("click", () => {
    window.print();
    // Na print opnieuw Direct contact zichtbaar in beeld brengen
    setTimeout(() => smoothScrollIntoView(els.contact), 250);
  });

  // Compose knoppen
  els.btnComposeNotary?.addEventListener("click", () => composeMessage("notary"));
  els.btnComposeAgent?.addEventListener("click", () => composeMessage("agent"));
  els.btnComposeSeller?.addEventListener("click", () => composeMessage("seller"));

  // Dynamic labels
  ["notary","agent","seller"].forEach(who => {
    $$(`input[name="channel-${who}"], input[name="lang-${who}"]`).forEach(r => {
      r.addEventListener("change", updateComposeButtonsText);
    });
  });
  updateComposeButtonsText();

  // Korte UX: submit op Enter in inputs → maak dossier
  els.form?.addEventListener("submit", (e) => {
    e.preventDefault();
    els.btnGenerate?.click();
  });

  // Init state
  resetPipeline();
})();
