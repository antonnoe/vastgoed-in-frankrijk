/* public/script.js
 * IMMODIAGNOSTIQUE – frontend pipeline
 * - Commune → INSEE
 * - DVF (commune or departement fallback)
 * - Analyse (/api/analyse) met simpele signals
 * - Resultaat renderen (Vastgoeddossier, Omgeving, Actieplan, SWOT)
 * - Voortgangspijplijn + spinner + annuleren
 */

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
  const inputArea = document.getElementById("area"); // kan ontbreken; we lezen via selector

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
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  };

  const logLine = (msg) => {
    const p = document.createElement("div");
    p.textContent = `${nowHHMMSS()} · ${msg}`;
    logBox.appendChild(p);
    logBox.scrollTop = logBox.scrollHeight;
  };

  const setSpinner = (on, label = "") => {
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
    Array.from(pipeline.querySelectorAll(".pipe-step")).forEach((li) => {
      li.dataset.state = "idle";
      const meta = li.querySelector(".pipe-meta");
      if (meta) meta.textContent = "";
    });
    logBox.innerHTML = "";
    spinnerLabel.textContent = "Wachten op start…";
    setSpinner(false);
  };

  const setStepState = (step, state, metaText = "") => {
    const li = pipeline.querySelector(`.pipe-step[data-step="${step}"]`);
    if (!li) return;
    li.dataset.state = state; // idle | active | done | error
    const meta = li.querySelector(".pipe-meta");
    if (meta) meta.textContent = metaText || "";
  };

  const euro = (n) =>
    typeof n === "number" && isFinite(n)
      ? n.toLocaleString("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })
      : String(n);

  const cleanAdvertLink = (url) => {
    try {
      const u = new URL(url);
      return `${u.origin}${u.pathname}`;
    } catch {
      return url;
    }
  };

  const readNumber = (el) => {
    if (!el) return null;
    const v = (el.value || "").replace(",", ".").trim();
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
    // NB: lege string → null
  };

  const qs = (sel) => document.querySelector(sel);

  // --------- Fetch helpers (with AbortController) ---------
  const doFetch = async (url, opts = {}, abortController) => {
    const cfg = { ...opts, signal: abortController?.signal };
    const r = await fetch(url, cfg);
    return r;
  };

  const GET_json = async (url, abortController) => {
    const r = await doFetch(url, { method: "GET", headers: { accept: "application/json" } }, abortController);
    if (!r.ok) throw new Error(`HTTP ${r.status} @ ${url}`);
    return r.json();
  };

  const POST_json = async (url, body, abortController) => {
    const r = await doFetch(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body || {}),
      },
      abortController
    );
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`HTTP ${r.status} @ ${url}: ${text}`);
    }
    return r.json();
  };

  // --------- Render helpers ---------
  const clearNode = (node) => {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  };

  const addFact = (k, vHTML) => {
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
    clearNode(ul);
    if (!Array.isArray(arr) || arr.length === 0) {
      const li = document.createElement("li");
      li.textContent = "—";
      ul.appendChild(li);
      return;
    }
    arr.forEach((line) => {
      const li = document.createElement("li");
      li.textContent = line.replace(/^[-•]\s*/, "");
      ul.appendChild(li);
    });
  };

  const addBadge = (key, label, present) => {
    const span = document.createElement("span");
    span.className = "badge";
    span.textContent = present ? `✅ ${label}` : `— ${label}`;
    envBadges.appendChild(span);
  };

  // --------- Contact composer ---------
  const getSelected = (name) => {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : null;
  };

  const composeRoleFromUI = (who) => {
    // in backend: roles: notary-fr, agent-nl, seller-mixed
    if (who === "notary") return "notary-fr";
    if (who === "agent") return "agent-nl";
    if (who === "seller") return "seller-mixed";
    return "agent-nl";
  };

  const composeMessage = async (who, dossierText) => {
    const role = composeRoleFromUI(who);
    const payload = { role, dossier: dossierText || "" };
    const data = await POST_json("/api/compose", payload, currentAbort);
    if (data?.ok && data?.output?.letter_text) {
      return data.output.letter_text;
    }
    return "—";
  };

  // --------- Main pipeline ---------
  const runPipeline = async () => {
    // Reset UI
    resultCard.hidden = true;
    contactCard.hidden = true;
    composeOut.hidden = true;
    btnExport.hidden = true;

    resetPipeline();
    setSpinner(true, "Dossier wordt opgebouwd…");
    logLine("Dossier wordt opgebouwd…");

    // Build dossier text from form
    const city = (inputCity.value || "").trim();
    const postcode = (inputPostcode.value || "").trim();
    const street = (inputStreet.value || "").trim();
    const house = (inputHouse.value || "").trim();
    const advertUrl = (inputAdvert.value || "").trim();
    const adText = (inputAdText.value || "").trim();
    const price = readNumber(inputPrice);
    const areaInput = qs("#area") || { value: "" };
    const area = readNumber(areaInput);

    if (!city) {
      setSpinner(false, "Klaar.");
      logLine("Fout: Plaatsnaam is verplicht.");
      alert("Plaatsnaam is verplicht.");
      return;
    }

    // AbortController per run
    currentAbort = new AbortController();

    // Local collect
    let commune = null;
    let insee = null;
    let dvf = null;

    // STEP: commune
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

    // STEP: GPU (placeholder → link tonen in resultaat)
    setStepState("gpu", "done", "bekijk link in Omgevingsdossier");
    // STEP: GPUDOC (idem)
    setStepState("gpudoc", "done", "bekijk link in Omgevingsdossier");

    // STEP: DVF
    try {
      setStepState("dvf", "active");
      logLine("Controleert DVF (verkoopprijzen)…");
      const d = await GET_json(`/api/dvf?insee=${encodeURIComponent(insee)}`, currentAbort);
      dvf = d;
      if (d?.ok) {
        const meta = d.source === "commune"
          ? "commune-bestand"
          : `departement-fallback`;
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

    // STEP: Géorisques (we linken straks; geen directe fetch nodig)
    setStepState("georisques", "done", "bekijk link in Omgevingsdossier");

    // STEP: Analyse (AI)
    let analyseOut = null;
    try {
      setStepState("ai", "active");
      logLine("Genereert AI-analyse…");

      // signals voor fallback-SWOT
      const signals = {
        price: price ?? undefined,
        area: area ?? undefined,
        dvf: {
          source: dvf?.source || null,
          median_price_m2: dvf?.summary?.median_eur_m2 ?? null
        },
        advertentie: {
          keywords: extractKeywords(adText),
          towns: [], // geen NER hier
          near_water: false,
          truncated: false
        }
      };

      const dossierLines = [];
      dossierLines.push(`Plaats: ${city}${postcode ? " " + postcode : ""}`);
      if (street || house) dossierLines.push(`Adres (indicatief): ${street} ${house}`.trim());
      if (price != null) dossierLines.push(`Vraagprijs: ${price}`);
      if (area != null) dossierLines.push(`Woonoppervlakte: ${area} m²`);
      if (commune?.name) dossierLines.push(`Commune: ${commune.name} (INSEE ${insee})`);
      if (dvf?.source) {
        const med = dvf?.summary?.median_eur_m2;
        if (med) dossierLines.push(`DVF: mediaan ca. €/${med} m² (bron: DVF)`);
        else dossierLines.push(`DVF: ${dvf.source}`);
      }
      if (advertUrl) dossierLines.push(`Advertentie: ${advertUrl}`);
      if (adText) dossierLines.push(`Advertentietekst: ${adText.slice(0, 800)}${adText.length > 800 ? "…" : ""}`);

      const payload = {
        dossier: dossierLines.join("; "),
        signals
      };

      const an = await POST_json("/api/analyse", payload, currentAbort);
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

    // --------- Render resultaat ---------
    try {
      // Keyfacts
      clearNode(keyfactsBox);
      const inputStr = [
        postcode ? postcode : null,
        city || null
      ].filter(Boolean).join(" ");
      addFact("Invoer:", inputStr || "—");
      if (price != null) addFact("Vraagprijs:", `${euro(price)} <span class="muted">(facultatief maar aanbevolen)</span>`);
      if (area != null) addFact("Woonoppervlakte:", `${area} m²`);
      addFact("Exact perceel:", "later opvragen bij notaris");
      if (commune?.name) addFact("Gemeente:", commune.name);
      if (insee) addFact("INSEE:", insee);

      // DVF status
      if (dvf?.ok) {
        const src = dvf.source === "commune" ? "commune-bestand" : `Geen commune-bestand, fallback op departement ${dvf.dep || "?"}.`;
        const lines = [
          `DVF status: ${src}`,
          `<a href="https://app.dvf.etalab.gouv.fr/" target="_blank" rel="noopener">DVF (Etalab)</a>`
        ];
        addFact("DVF:", lines.join("<br>"));
      }

      // Advertentielink schoon tonen
      if (advertUrl) {
        const clean = cleanAdvertLink(advertUrl);
        const html = `<a href="${clean}" target="_blank" rel="noopener">${clean}</a> 
          <button class="link-mini" data-action="copy-full-link">Kopieer volledige link</button>`;
        addFact("Advertentielink:", html);
      }

      // Env badges (placeholder: we hebben geen live risico API hier—links aanbieden)
      clearNode(envBadges);
      addBadge("flood", "Overstroming", false);
      addBadge("coastal", "Kust", false);
      addBadge("industrial", "Industrieel", false);
      addBadge("seismic", "Seismisch", false);
      addBadge("radon", "Radon", false);
      addBadge("clay", "Klei/krimp", false);
      addBadge("forestfire", "Bosbrand", false);

      // Env links
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

      // Actieplan + SWOT (uit analyse, met fallbacks)
      const ap = analyseOut?.actieplan || [];
      renderList(actieplanList, ap);

      const sw = analyseOut?.swot || {};
      renderList(swotSterke, sw?.sterke_punten || []);
      renderList(swotZorg, sw?.mogelijke_zorgpunten || []);
      renderList(swotKansen, sw?.mogelijke_kansen || []);
      renderList(swotBedreigingen, sw?.mogelijke_bedreigingen || []);

      // Coup-warning optioneel (standaard verbergen)
      coupWarning.hidden = true;

      // Show sections
      resultCard.hidden = false;
      btnExport.hidden = false;

      // Toon contact pas na resultaat (wow-effect)
      contactCard.hidden = false;

      setSpinner(false, "Klaar.");
    } catch (e) {
      logLine("❌ Render-fout: " + (e?.message || e));
      setSpinner(false, "Klaar.");
    }
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

  // --------- Events ---------
  btnGenerate?.addEventListener("click", async () => {
    // toggle buttons
    btnGenerate.disabled = true;
    btnCancel.hidden = false;
    await runPipeline().catch((e) => {
      logLine("❌ Alg. fout: " + (e?.message || e));
    });
    btnGenerate.disabled = false;
    btnCancel.hidden = true;
  });

  btnCancel?.addEventListener("click", () => {
    if (currentAbort) {
      currentAbort.abort();
      logLine("Gebruiker annuleert de huidige run");
      setSpinner(false, "Klaar.");
      // zet actieve stappen naar error/stop
      ["commune", "gpu", "gpudoc", "dvf", "georisques", "ai"].forEach((s) => {
        const li = pipeline.querySelector(`.pipe-step[data-step="${s}"]`);
        if (li && li.dataset.state === "active") li.dataset.state = "error";
      });
    }
  });

  // Copy volledige advertentielink (event delegation)
  document.addEventListener("click", (ev) => {
    const t = ev.target;
    if (t && t.matches && t.matches('button[data-action="copy-full-link"]')) {
      const full = (inputAdvert.value || "").trim();
      if (!full) return;
      navigator.clipboard.writeText(full).then(
        () => {
          t.textContent = "Gekopieerd";
          setTimeout(() => (t.textContent = "Kopieer volledige link"), 1500);
        },
        () => alert("Kopiëren mislukt")
      );
    }
  });

  // Contact composers
  const handleCompose = async (who) => {
    try {
      composeOut.hidden = false;
      composeText.textContent = "Bezig met opstellen…";

      // dossiertekst uit keyfacts voor context
      const facts = Array.from(keyfactsBox.querySelectorAll(".fact")).map((f) => {
        const k = f.querySelector(".k")?.textContent || "";
        const v = f.querySelector(".v")?.textContent || "";
        return `${k} ${v}`.trim();
      });
      const dossier = facts.join("; ");
      const text = await composeMessage(who, dossier);
      composeText.textContent = text || "—";
    } catch (e) {
      composeText.textContent = "Fout bij samenstellen bericht.";
    }
  };

  btnComposeNotary?.addEventListener("click", () => handleCompose("notary"));
  btnComposeAgent?.addEventListener("click", () => handleCompose("agent"));
  btnComposeSeller?.addEventListener("click", () => handleCompose("seller"));

  // Export (print)
  btnExport?.addEventListener("click", () => {
    window.print();
  });

  // Init
  resetPipeline();
})();
