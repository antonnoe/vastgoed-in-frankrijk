/* public/script.js — null-safe UI */
(() => {
  // --------- DOM refs ---------
  const form = document.getElementById("dossier-form");
  const btnGenerate = document.getElementById("btn-generate");
  const btnCancel = document.getElementById("btn-cancel");
  const btnExport = document.getElementById("btn-export");

  const inputAdvert = document.getElementById("advert-link");
  const inputCity = document.getElementById("city");
  const inputPrice = document.getElementById("price");
  const inputPostcode = document.getElementById("postcode");
  const inputStreet = document.getElementById("street");
  const inputHouse = document.getElementById("housenr");
  const inputAdText = document.getElementById("ad-text");
  const inputAreaEl = document.getElementById("area"); // mag ontbreken

  // Progress UI
  const spinner = document.getElementById("progress-spinner");
  const spinnerLabel = document.getElementById("spinner-label");
  const pipeline = document.getElementById("progress-pipeline");
  const logBox = document.getElementById("progress-log");

  // Result UI
  const resultCard = document.getElementById("result");
  const keyfactsBox = document.getElementById("keyfacts");
  const envBadges = document.getElementById("env-badges");
  const envLinks = document.getElementById("env-links");
  const actieplanList = document.getElementById("actieplan-list");

  const swotSterke = document.getElementById("swot-sterke");
  const swotZorg = document.getElementById("swot-zorg");
  const swotKansen = document.getElementById("swot-kansen");
  const swotBedreigingen = document.getElementById("swot-bedreigingen");
  const coupWarning = document.getElementById("coup-warning");

  // Contact UI
  const contactCard = document.getElementById("contact");
  const btnComposeNotary = document.getElementById("btn-compose-notary");
  const btnComposeAgent = document.getElementById("btn-compose-agent");
  const btnComposeSeller = document.getElementById("btn-compose-seller");
  const composeOut = document.getElementById("compose-output");
  const composeText = document.getElementById("compose-text");

  // --------- State ---------
  let currentAbort = null;

  // --------- Utils ---------
  const nowHHMMSS = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
  };

  const logLine = (msg) => {
    if (!logBox) return;
    const p = document.createElement("div");
    p.textContent = `${nowHHMMSS()} · ${msg}`;
    logBox.appendChild(p);
    logBox.scrollTop = logBox.scrollHeight;
  };

  const setSpinner = (on, label = "") => {
    if (!spinner || !spinnerLabel) return;
    if (on) {
      spinner.removeAttribute("aria-hidden");
      spinner.style.display = "inline-block";
      spinnerLabel.textContent = label || "Bezig…";
    } else {
      spinner.setAttribute("aria-hidden", "true");
      spinner.style.display = "none";
      spinnerLabel.textContent = "Klaar.";
    }
  };

  const resetPipeline = () => {
    if (pipeline) {
      Array.from(pipeline.querySelectorAll(".pipe-step")).forEach((li) => {
        li.dataset.state = "idle";
        const meta = li.querySelector(".pipe-meta");
        if (meta) meta.textContent = "";
      });
    }
    if (logBox) logBox.innerHTML = "";
    if (spinnerLabel) spinnerLabel.textContent = "Wachten op start…";
    setSpinner(false);
  };

  const setStepState = (step, state, metaText = "") => {
    if (!pipeline) return;
    const li = pipeline.querySelector(`.pipe-step[data-step="${step}"]`);
    if (!li) return;
    li.dataset.state = state; // idle | active | done | error
    const meta = li.querySelector(".pipe-meta");
    if (meta) meta.textContent = metaText || "";
  };

  const euro = (n) =>
    typeof n === "number" && isFinite(n)
      ? n.toLocaleString("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })
      : String(n ?? "");

  const cleanAdvertLink = (url) => {
    try { const u = new URL(url); return `${u.origin}${u.pathname}`; }
    catch { return url; }
  };

  const readNumber = (el) => {
    if (!el) return null;
    const v = String(el.value || "").replace(",", ".").trim();
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const clearNode = (node) => {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  };

  const addFact = (k, vHTML) => {
    if (!keyfactsBox) return;
    const wrap = document.createElement("div");
    wrap.className = "fact";
    const kSpan = document.createElement("span");
    kSpan.className = "k";
    kSpan.textContent = k;
    const vSpan = document.createElement("span");
    vSpan.className = "v";
    vSpan.innerHTML = vHTML;
    wrap.appendChild(kSpan);
    wrap.appendChild(vSpan);
    keyfactsBox.appendChild(wrap);
  };

  const renderList = (ul, arr) => {
    if (!ul) return;
    clearNode(ul);
    if (!Array.isArray(arr) || arr.length === 0) {
      const li = document.createElement("li");
      li.textContent = "—";
      ul.appendChild(li);
      return;
    }
    arr.forEach((line) => {
      const li = document.createElement("li");
      li.textContent = String(line || "").replace(/^[-•]\s*/, "");
      ul.appendChild(li);
    });
  };

  const addBadge = (label, present) => {
    if (!envBadges) return;
    const span = document.createElement("span");
    span.className = "badge";
    span.textContent = present ? `✅ ${label}` : `— ${label}`;
    envBadges.appendChild(span);
  };

  const GET_json = async (url, abortController) => {
    const r = await fetch(url, { method: "GET", headers: { accept:"application/json" }, signal: abortController?.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} @ ${url}`);
    return r.json();
  };

  const POST_json = async (url, body, abortController) => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type":"application/json", accept:"application/json" },
      body: JSON.stringify(body || {}),
      signal: abortController?.signal
    });
    if (!r.ok) {
      const text = await r.text().catch(()=> "");
      throw new Error(`HTTP ${r.status} @ ${url}: ${text}`);
    }
    return r.json();
  };

  const extractKeywords = (txt) => {
    if (!txt) return [];
    const lower = txt.toLowerCase();
    const keys = [];
    if (lower.includes("travaux")) keys.push("travaux à prévoir");
    if (lower.includes("isolation")) keys.push("isolation");
    if (lower.includes("double vitrage")) keys.push("double vitrage");
    if (lower.includes("pompe à chaleur") || lower.includes("warmtepomp")) keys.push("warmtepomp");
    return Array.from(new Set(keys));
  };

  const composeMessage = async (who, dossierText) => {
    const role = who === "notary" ? "notary-fr" : who === "seller" ? "seller-mixed" : "agent-nl";
    const data = await POST_json("/api/compose", { role, dossier: dossierText || "" }, currentAbort);
    return data?.ok && data?.output?.letter_text ? data.output.letter_text : "—";
  };

  // --------- Main pipeline ---------
  const runPipeline = async () => {
    // Reset UI (null-safe)
    if (resultCard) resultCard.hidden = true;
    if (contactCard) contactCard.hidden = true;
    if (composeOut) composeOut.hidden = true;
    if (btnExport) btnExport.hidden = true;

    resetPipeline();
    setSpinner(true, "Dossier wordt opgebouwd…");
    logLine("Dossier wordt opgebouwd…");

    const city = (inputCity?.value || "").trim();
    const postcode = (inputPostcode?.value || "").trim();
    const street = (inputStreet?.value || "").trim();
    const house = (inputHouse?.value || "").trim();
    const advertUrl = (inputAdvert?.value || "").trim();
    const adText = (inputAdText?.value || "").trim();
    const price = readNumber(inputPrice);
    const area = readNumber(inputAreaEl);

    if (!city) {
      setSpinner(false, "Klaar.");
      logLine("Fout: Plaatsnaam is verplicht.");
      if (typeof alert === "function") alert("Plaatsnaam is verplicht.");
      return;
    }

    currentAbort = new AbortController();

    let commune = null, insee = null, dvf = null;

    // Step: commune
    try {
      setStepState("commune", "active");
      logLine("Raadpleegt gemeente…");
      const url = `/api/commune?city=${encodeURIComponent(city)}${postcode ? `&postcode=${encodeURIComponent(postcode)}` : ""}`;
      const c = await GET_json(url, currentAbort);
      if (c?.ok && c?.commune?.insee) {
        commune = c.commune;
        insee = commune.insee;
        setStepState("commune", "done", `${commune.name} (INSEE ${insee})`);
        logLine("✔ Raadpleegt gemeente…");
      } else {
        setStepState("commune", "error", "Geen match");
        throw new Error("Geen gemeente gevonden");
      }
    } catch (e) {
      logLine("❌ Gemeente-fout: " + (e?.message || e));
      setSpinner(false, "Klaar.");
      return;
    }

    // GPU & GPUDOC placeholders
    setStepState("gpu", "done", "bekijk link in Omgevingsdossier");
    setStepState("gpudoc", "done", "bekijk link in Omgevingsdossier");

    // Step: DVF
    try {
      setStepState("dvf", "active");
      logLine("Controleert DVF (verkoopprijzen)…");
      dvf = await GET_json(`/api/dvf?insee=${encodeURIComponent(insee)}`, currentAbort);
      if (dvf?.ok) {
        const meta = dvf.source === "commune" ? "commune-bestand" : "departement-fallback";
        setStepState("dvf", "done", meta);
        logLine("✔ DVF opgehaald");
      } else {
        setStepState("dvf", "error", "fout");
        logLine("⚠ DVF: geen data");
      }
    } catch (e) {
      setStepState("dvf", "error", "fout");
      logLine("⚠ DVF-fout: " + (e?.message || e));
    }

    // Step: Géorisques (alleen link)
    setStepState("georisques", "done", "bekijk link in Omgevingsdossier");

    // Step: Analyse
    let analyseOut = null;
    try {
      setStepState("ai", "active");
      logLine("Genereert AI-analyse…");

      const signals = {
        price: price ?? undefined,
        area: area ?? undefined,
        dvf: {
          source: dvf?.source || null,
          median_price_m2: dvf?.summary?.median_eur_m2 ?? null
        },
        advertentie: {
          keywords: extractKeywords(adText),
          towns: [],
          near_water: false,
          truncated: false
        }
      };

      const dossierLines = [];
      dossierLines.push(`Plaats: ${city}${postcode ? " " + postcode : ""}`);
      if (street || house) dossierLines.push(`Adres (indicatief): ${(street + " " + house).trim()}`);
      if (price != null) dossierLines.push(`Vraagprijs: ${price}`);
      if (area != null) dossierLines.push(`Woonoppervlakte: ${area} m²`);
      if (commune?.name) dossierLines.push(`Commune: ${commune.name} (INSEE ${insee})`);
      if (dvf?.source) {
        const med = dvf?.summary?.median_eur_m2;
        dossierLines.push(med ? `DVF mediaan ca. €/${med} m²` : `DVF bron: ${dvf.source}`);
      }
      if (advertUrl) dossierLines.push(`Advertentie: ${advertUrl}`);
      if (adText) dossierLines.push(`Advertentietekst: ${adText.slice(0, 800)}${adText.length > 800 ? "…" : ""}`);

      const an = await POST_json("/api/analyse", { dossier: dossierLines.join("; "), signals }, currentAbort);
      if (an?.ok) {
        analyseOut = an.output || {};
        setStepState("ai", "done", an?.model || "AI");
        logLine("✔ Analyse gereed");
      } else {
        setStepState("ai", "error", "AI-fout");
        logLine("⚠ AI-fout");
      }
    } catch (e) {
      setStepState("ai", "error", "AI-fout");
      logLine("⚠ Analyse-fout: " + (e?.message || e));
    }

    // --------- Render resultaat (null-safe) ---------
    try {
      if (!resultCard) logLine("⚠ UI: #result ontbreekt");
      if (!keyfactsBox) logLine("⚠ UI: #keyfacts ontbreekt");
      if (!envBadges) logLine("⚠ UI: #env-badges ontbreekt");
      if (!envLinks) logLine("⚠ UI: #env-links ontbreekt");
      if (!actieplanList) logLine("⚠ UI: #actieplan-list ontbreekt");

      // Keyfacts
      if (keyfactsBox) {
        clearNode(keyfactsBox);
        const inputStr = [postcode || null, city || null].filter(Boolean).join(" ");
        addFact("Invoer:", inputStr || "—");
        if (price != null) addFact("Vraagprijs:", `${euro(price)} <span class="muted">(facultatief maar aanbevolen)</span>`);
        if (area != null) addFact("Woonoppervlakte:", `${area} m²`);
        addFact("Exact perceel:", "later opvragen bij notaris");
        if (commune?.name) addFact("Gemeente:", commune.name);
        if (insee) addFact("INSEE:", insee);
        if (dvf?.ok) {
          const src = dvf.source === "commune" ? "commune-bestand" : `Geen commune-bestand, fallback op departement ${dvf.dep || "?"}.`;
          addFact("DVF:", [
            `DVF status: ${src}`,
            `<a href="https://app.dvf.etalab.gouv.fr/" target="_blank" rel="noopener">DVF (Etalab)</a>`
          ].join("<br>"));
        }
        if (advertUrl) {
          const clean = cleanAdvertLink(advertUrl);
          const html = `<a href="${clean}" target="_blank" rel="noopener">${clean}</a> 
            <button class="link-mini" data-action="copy-full-link">Kopieer volledige link</button>`;
          addFact("Advertentielink:", html);
        }
      }

      // Env badges/links
      if (envBadges) {
        clearNode(envBadges);
        addBadge("Overstroming", false);
        addBadge("Kust", false);
        addBadge("Industrieel", false);
        addBadge("Seismisch", false);
        addBadge("Radon", false);
        addBadge("Klei/krimp", false);
        addBadge("Bosbrand", false);
      }
      if (envLinks) {
        clearNode(envLinks);
        if (insee) {
          envLinks.innerHTML = [
            `<a href="https://www.geoportail-urbanisme.gouv.fr/recherche?insee=${insee}" target="_blank" rel="noopener">Géoportail Urbanisme</a>`,
            `<a href="https://www.georisques.gouv.fr/commune/${insee}" target="_blank" rel="noopener">Géorisques – gemeente</a>`,
            `<a href="https://app.dvf.etalab.gouv.fr/" target="_blank" rel="noopener">DVF – Etalab</a>`
          ].join("<br>");
        } else {
          envLinks.textContent = "—";
        }
      }

      // Actieplan + SWOT
      if (actieplanList) renderList(actieplanList, (analyseOut?.actieplan || []));
      if (swotSterke) renderList(swotSterke, (analyseOut?.swot?.sterke_punten || []));
      if (swotZorg) renderList(swotZorg, (analyseOut?.swot?.mogelijke_zorgpunten || []));
      if (swotKansen) renderList(swotKansen, (analyseOut?.swot?.mogelijke_kansen || []));
      if (swotBedreigingen) renderList(swotBedreigingen, (analyseOut?.swot?.mogelijke_bedreigingen || []));

      if (coupWarning) coupWarning.hidden = true;

      if (resultCard) resultCard.hidden = false;
      if (btnExport) btnExport.hidden = false;
      if (contactCard) contactCard.hidden = false;

      setSpinner(false, "Klaar.");
    } catch (e) {
      logLine("❌ Render-fout: " + (e?.message || e));
      setSpinner(false, "Klaar.");
    }
  };

  // --------- Events ---------
  btnGenerate?.addEventListener("click", async () => {
    if (btnGenerate) btnGenerate.disabled = true;
    if (btnCancel) btnCancel.hidden = false;
    try { await runPipeline(); }
    catch (e) { logLine("❌ Alg. fout: " + (e?.message || e)); }
    if (btnGenerate) btnGenerate.disabled = false;
    if (btnCancel) btnCancel.hidden = true;
  });

  btnCancel?.addEventListener("click", () => {
    if (currentAbort) {
      currentAbort.abort();
      logLine("Gebruiker annuleert de huidige run");
      setSpinner(false, "Klaar.");
      if (pipeline) {
        ["commune","gpu","gpudoc","dvf","georisques","ai"].forEach((s) => {
          const li = pipeline.querySelector(`.pipe-step[data-step="${s}"]`);
          if (li && li.dataset.state === "active") li.dataset.state = "error";
        });
      }
    }
  });

  document.addEventListener("click", (ev) => {
    const t = ev.target;
    if (t && t.matches && t.matches('button[data-action="copy-full-link"]')) {
      const full = (inputAdvert?.value || "").trim();
      if (!full) return;
      navigator.clipboard.writeText(full).then(
        () => { t.textContent = "Gekopieerd"; setTimeout(() => (t.textContent = "Kopieer volledige link"), 1500); },
        () => { if (typeof alert === "function") alert("Kopiëren mislukt"); }
      );
    }
  });

  const collectFactsText = () => {
    if (!keyfactsBox) return "";
    return Array.from(keyfactsBox.querySelectorAll(".fact")).map((f) => {
      const k = f.querySelector(".k")?.textContent || "";
      const v = f.querySelector(".v")?.textContent || "";
      return `${k} ${v}`.trim();
    }).join("; ");
  };

  const handleCompose = async (who) => {
    if (composeOut) composeOut.hidden = false;
    if (composeText) composeText.textContent = "Bezig met opstellen…";
    try {
      const dossier = collectFactsText();
      const text = await composeMessage(who, dossier);
      if (composeText) composeText.textContent = text || "—";
    } catch {
      if (composeText) composeText.textContent = "Fout bij samenstellen bericht.";
    }
  };

  btnComposeNotary?.addEventListener("click", () => handleCompose("notary"));
  btnComposeAgent?.addEventListener("click", () => handleCompose("agent"));
  btnComposeSeller?.addEventListener("click", () => handleCompose("seller"));

  btnExport?.addEventListener("click", () => window.print());

  // Init
  resetPipeline();
})();
