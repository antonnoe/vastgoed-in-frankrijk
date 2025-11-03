// /api/compose.js (ESM, STRIKT)
// Vercel Serverless Function — POST { role, dossier }
// Doel: consistente brieven genereren per rol met taal/structuur-validatie en auto-retry.
// Vereisten: Env var GEMINI_API_KEY (Vercel → Settings → Environment Variables)

const DEFAULT_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash-latest"];
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

// ——— In-memory rate limiting (per instance, best-effort) ———
// Regels: 1 req/sec, max 8 req/min.
const calls = [];
const nowMs = () => Date.now();
function pruneCalls() {
  const cutoff = nowMs() - 60_000;
  while (calls.length && calls[0] < cutoff) calls.shift();
}
async function enforceRateLimit() {
  pruneCalls();
  if (calls.length >= 8) {
    const earliest = calls[0];
    const waitMs = Math.max(0, (earliest + 60_000) - nowMs());
    await new Promise(r => setTimeout(r, waitMs));
    pruneCalls();
  }
  const last = calls[calls.length - 1];
  if (last && nowMs() - last < 1_000) {
    const waitMs = 1_000 - (nowMs() - last);
    await new Promise(r => setTimeout(r, waitMs));
  }
  calls.push(nowMs());
}

// ——— Helpers (HTTP/JSON) ———
function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
function getApiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    const e = new Error("Missing GEMINI_API_KEY");
    e.status = 500;
    throw e;
  }
  return key;
}

// ——— Rollen en labels ———
const ROLE_LABELS = {
  "notary-fr": "Notaris (Frans)",
  "agent-nl": "Makelaar (Nederlands)",
  "seller-mixed": "Verkoper (Frans/Nederlands)"
};
const VALID_ROLES = Object.keys(ROLE_LABELS);

// ——— Promptbouw met few-shots en strikte regels ———
function buildPrompt(role, dossier) {
  const baseRules = [
    "DOEL: Schrijf een beknopte, formele brief op basis van UITSLUITEND het aangeleverde dossier.",
    "GEEN externe feiten, GEEN links, GEEN verzinsels.",
    "STRUCTUUR (VERPLICHT):",
    "- Eerste regel: <PLAATS>, <DATUM>",
    "- Onderwerpregel:",
    "  * FR: 'Objet:'",
    "  * NL: 'Onderwerp:' of 'Subject / Onderwerp:'",
    "- Aanhef: formeel (FR of NL naargelang de taal).",
    "- Kern: puntsgewijs, kort, zakelijk; adresseer dossierpunten.",
    "- Afsluiting: formeel; gebruik placeholders <NAAM>, <ADRES> indien relevant.",
    "- Laatste regel: 'Dit bericht is indicatief; raadpleeg officiële bronnen en professionals.'",
    "GEBRUIK PLACEHOLDERS ALTIJD: <PLAATS>, <DATUM>, <NAAM>, <ADRES>."
  ].join("\n");

  // Few-shot mini-voorbeelden per rol (extreem kort, stijl-anker)
  const fewshotNotaryFR = [
    "EXEMPEL FR (très court):",
    "<PLAATS>, <DATUM>",
    "Objet: Demande d’informations cadastrales et ERP",
    "Madame, Monsieur,",
    "- Merci de communiquer les références cadastrales (section, n° de parcelle) et les servitudes éventuelles.",
    "- Un ERP (≤ 6 mois) est requis pour l’adresse indiquée.",
    "Veuillez agréer, Madame, Monsieur, l’expression de mes salutations distinguées.",
    "<NAAM>",
    "<ADRES>",
    "Ce message est indicatif; consultez les sources officielles et des professionnels."
  ].join("\n");

  const fewshotAgentNL = [
    "EXEMPEL NL (heel kort):",
    "<PLAATS>, <DATUM>",
    "Onderwerp: Informatieaanvraag verkoopdata en kadastrale gegevens",
    "Geachte heer/mevrouw,",
    "- Graag ontvang ik het exacte adres en de kadastrale referenties.",
    "- Daarnaast verzoek ik om recente vergelijkbare verkopen in de directe omgeving.",
    "Met vriendelijke groet,",
    "<NAAM>",
    "<ADRES>",
    "Dit bericht is indicatief; raadpleeg officiële bronnen en professionals."
  ].join("\n");

  const fewshotSellerMixed = [
    "EXEMPEL TWEETALIG (FR + NL, in deze volgorde):",
    "FR",
    "<PLAATS>, <DATUM>",
    "Objet: Demande ERP, références cadastrales et servitudes",
    "Madame, Monsieur,",
    "- Merci de fournir un ERP (≤ 6 mois), les références cadastrales et les servitudes éventuelles.",
    "Veuillez agréer, Madame, Monsieur, l’expression de mes salutations distinguées.",
    "<NAAM>",
    "<ADRES>",
    "Ce message est indicatif; consultez les sources officielles et des professionnels.",
    "",
    "NL",
    "<PLAATS>, <DATUM>",
    "Onderwerp: Verzoek ERP, kadastrale referenties en erfdienstbaarheden",
    "Geachte heer/mevrouw,",
    "- Graag ontvang ik een ERP (≤ 6 maanden), de kadastrale referenties en eventuele erfdienstbaarheden.",
    "Met vriendelijke groet,",
    "<NAAM>",
    "<ADRES>",
    "Dit bericht is indicatief; raadpleeg officiële bronnen en professionals."
  ].join("\n");

  let roleBlock = "";
  if (role === "notary-fr") {
    roleBlock = [
      "TAAL: FRANS. ALLES in het FRANS.",
      "ADRESSEE: Notaire.",
      "INHOUD (SAMENVATTING):",
      "- Références cadastrales, servitudes.",
      "- ERP (≤ 6 mois).",
      "- Mention que DVF est au niveau communal.",
      fewshotNotaryFR
    ].join("\n");
  } else if (role === "agent-nl") {
    roleBlock = [
      "TAAL: NEDERLANDS. ALLES in het NEDERLANDS.",
      "ADRESSEE: Makelaar.",
      "INHOUD (SAMENVATTING):",
      "- Exacte adres/kadastrale gegevens.",
      "- Recente vergelijkbare verkopen (naast DVF op gemeenteniveau).",
      "- Bekende aandachtspunten/gebreken/lopende dossiers.",
      fewshotAgentNL
    ].join("\n");
  } else {
    // seller-mixed
    roleBlock = [
      "TAAL: TWEETALIG. EERST FRANS-BLOK, DAN NEDERLANDS-BLOK.",
      "BOUW:",
      "- Kop 'FR' op eigen regel; daarna FR-brief.",
      "- Daarna een lege regel en kop 'NL'; vervolgens NL-brief.",
      "- Beide brieven moeten de STRUCTUUR volgen en inhoudelijk equivalent zijn.",
      fewshotSellerMixed
    ].join("\n");
  }

  return [
    baseRules,
    "",
    "ROL:",
    ROLE_LABELS[role] || role,
    "",
    "DOSSIER (enkel input; niet citeren tenzij nodig):",
    dossier,
    "",
    "VOLG DEZE INSTRUCTIES STRENG EN EXACT.",
    roleBlock
  ].join("\n");
}

// ——— Gemini-call + policy (backoff + fallback) ———
async function callGeminiOnce({ model, text, apiKey }) {
  const url = `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = { contents: [{ parts: [{ text }] }] };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  });

  const contentType = resp.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await resp.json() : await resp.text();

  if (!resp.ok) {
    const err = new Error("Gemini error");
    err.status = resp.status;
    err.payload = payload;
    throw err;
  }

  let textOut = "";
  try {
    const parts = payload?.candidates?.[0]?.content?.parts || [];
    textOut = parts.map(p => p.text || "").join("").trim();
  } catch {
    // noop
  }
  return { text: textOut, raw: payload };
}

async function callGeminiWithPolicy({ prompt, apiKey, models = DEFAULT_MODELS }) {
  let lastError = null;
  let modelUsed = null;
  let throttleNotice = null;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      await enforceRateLimit();
      const { text, raw } = await callGeminiOnce({ model, text: prompt, apiKey });
      modelUsed = model;
      return { text, raw, modelUsed, throttleNotice };
    } catch (err) {
      lastError = err;

      if (err.status === 429) {
        throttleNotice = "Gemini throttle: backoff toegepast (2s→4s).";
        await new Promise(r => setTimeout(r, 2000));
        try {
          await enforceRateLimit();
          const retry = await callGeminiOnce({ model, text: prompt, apiKey });
          modelUsed = model;
          return { text: retry.text, raw: retry.raw, modelUsed, throttleNotice };
        } catch (err2) {
          if (err2.status === 429) {
            await new Promise(r => setTimeout(r, 4000));
            try {
              await enforceRateLimit();
              const retry2 = await callGeminiOnce({ model, text: prompt, apiKey });
              modelUsed = model;
              return { text: retry2.text, raw: retry2.raw, modelUsed, throttleNotice };
            } catch (err3) {
              lastError = err3;
            }
          } else {
            lastError = err2;
          }
        }
      }

      const notFoundMsg = (err.payload && (err.payload.error?.status || err.payload.error?.message || "")).toString();
      if (err.status === 404 || /NOT_FOUND/i.test(notFoundMsg)) {
        continue; // volgende model
      }
      continue; // andere fout → ook fallback proberen
    }
  }

  const status = lastError?.status || 500;
  const details = lastError?.payload || { message: String(lastError) };
  const message =
    status === 429
      ? "Gemini-throttling blijft actief na backoff. Probeer het zo dadelijk opnieuw."
      : "Gemini kon geen resultaat leveren.";
  const out = { ok: false, status, message, details };
  const e = new Error(message);
  e.status = status;
  e.out = out;
  throw e;
}

// ——— Validatie & normalisatie ———
function looksFrench(s = "") {
  const frWords = ["Madame", "Monsieur", "Objet", "Veuillez", "références", "cadastrales", "servitudes", "ERP", "Veuillez agréer"];
  const diacritics = /[éèêëàâîïôöûüç]/i.test(s);
  const hits = frWords.reduce((n, w) => n + (s.includes(w) ? 1 : 0), 0);
  return diacritics || hits >= 2;
}
function looksDutch(s = "") {
  const nlWords = ["Geachte", "Onderwerp", "Met vriendelijke groet", "erfdienstbaarheden", "kadastrale", "gegevens", "bij voorbaat"];
  const hits = nlWords.reduce((n, w) => n + (s.includes(w) ? 1 : 0), 0);
  return hits >= 2;
}
function hasPlaceholders(s = "") {
  return /<PLAATS>/.test(s) && /<DATUM>/.test(s);
}
function ensurePlaceholders(text) {
  let t = text;
  if (!/<PLAATS>/.test(t)) t = t.replace(/^\s*/, "<PLAATS>, <DATUM>\n");
  if (!/<DATUM>/.test(t)) {
    if (!/<PLAATS>/.test(t)) t = "<PLAATS>, <DATUM>\n" + t;
  }
  if (!/<NAAM>/.test(t)) t += "\n<NAAM>";
  if (!/<ADRES>/.test(t)) t += "\n<ADRES>";
  return t;
}
function standardizeSubjectHeaders(text, lang) {
  let t = text;
  if (lang === "FR") {
    if (!/^Objet:/m.test(t)) {
      t = t.replace(/^(Subject\s*\/\s*Objet|Onderwerp|Subject|Objet)\s*:/mi, "Objet:");
      if (!/^Objet:/m.test(t)) {
        t = t.replace(/^(Madame|Monsieur|Madame, Monsieur)/m, "Objet: (à compléter)\n$1");
      }
    }
  } else if (lang === "NL") {
    if (!/^(Onderwerp|Subject\s*\/\s*Onderwerp)\s*:/mi.test(t)) {
      t = t.replace(/^Onderwerp\s*:/mi, "Onderwerp:");
      if (!/^(Onderwerp|Subject\s*\/\s*Onderwerp)\s*:/mi.test(t)) {
        t = t.replace(/^(Geachte|Beste)/m, "Onderwerp: (in te vullen)\n$1");
      }
    }
  }
  return t;
}
function normalizeOutputByRole(role, text) {
  let t = text.trim();

  if (role === "notary-fr") {
    t = ensurePlaceholders(t);
    t = standardizeSubjectHeaders(t, "FR");
  } else if (role === "agent-nl") {
    t = ensurePlaceholders(t);
    t = standardizeSubjectHeaders(t, "NL");
  } else {
    // seller-mixed
    // Splits op FR/NL kopjes of forceer structuur.
    const hasFR = /^\s*FR\s*$/m.test(t);
    const hasNL = /^\s*NL\s*$/m.test(t);
    if (!(hasFR && hasNL)) {
      // probeer heuristisch te markeren
      if (looksFrench(t) && looksDutch(t)) {
        // voeg kopjes toe als ze ontbreken
        const mid = Math.floor(t.length / 2);
        t = "FR\n" + t.slice(0, mid).trim() + "\n\nNL\n" + t.slice(mid).trim();
      } else {
        // fallback: dupliceer kern in twee talen is onmogelijk hier; laat validatie/reprompt beslissen
      }
    }
    // Zorg voor placeholders en subjectregels in beide blokken
    t = t
      .replace(/^\s*FR\s*$/m, "FR")
      .replace(/^\s*NL\s*$/m, "NL");
    // Per blok normaliseren
    t = t.replace(/(^FR[\r\n]+)([\s\S]*?)(?=\nNL\b|$)/, (m, tag, block) => {
      let b = ensurePlaceholders(block);
      b = standardizeSubjectHeaders(b, "FR");
      return `${tag}${b.trim()}\n`;
    });
    t = t.replace(/(^NL[\r\n]+)([\s\S]*)$/, (m, tag, block) => {
      let b = ensurePlaceholders(block);
      b = standardizeSubjectHeaders(b, "NL");
      return `${tag}${b.trim()}`;
    });
  }

  // Altijd afsluitende disclaimer indien ontbreekt
  if (!/Dit bericht is indicatief; raadpleeg officiële bronnen en professionals\./.test(t) &&
      !/Ce message est indicatif; consultez les sources officielles et des professionnels\./.test(t)) {
    t += "\n\nDit bericht is indicatief; raadpleeg officiële bronnen en professionals.";
  }

  return t.trim();
}
function validateByRole(role, text) {
  const t = text.trim();
  if (role === "notary-fr") {
    return looksFrench(t) && hasPlaceholders(t) && /^Objet:/m.test(t);
  }
  if (role === "agent-nl") {
    return looksDutch(t) && hasPlaceholders(t) && /(Onderwerp|Subject\s*\/\s*Onderwerp)\s*:/mi.test(t);
  }
  // seller-mixed: moet FR en NL blok hebben
  const frBlock = /(^|\n)FR\s*\n([\s\S]*?)(?=\nNL\b|$)/.exec(t);
  const nlBlock = /(^|\n)NL\s*\n([\s\S]*)$/.exec(t);
  if (!frBlock || !nlBlock) return false;
  const frOk = looksFrench(frBlock[2]) && /<PLAATS>/.test(frBlock[2]) && /^Objet:/m.test(frBlock[2]);
  const nlOk = looksDutch(nlBlock[2]) && /<PLAATS>/.test(nlBlock[2]) && /(Onderwerp|Subject\s*\/\s*Onderwerp)\s*:/mi.test(nlBlock[2]);
  return frOk && nlOk;
}

// ——— Handler ———
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return sendJson(res, 405, { ok: false, error: "Method Not Allowed. Use POST { role, dossier }." });
    }

    // Body lezen (compatibel)
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch {}
    }
    if (!body || typeof body !== "object") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      try { body = JSON.parse(raw || "{}"); } catch { body = {}; }
    }

    const role = String(body.role || "").trim();
    const dossier = String(body.dossier || "").trim();

    if (!VALID_ROLES.includes(role)) {
      return sendJson(res, 400, { ok: false, error: "Bad Request: 'role' vereist en moet één van [notary-fr, agent-nl, seller-mixed] zijn." });
    }
    if (!dossier) {
      return sendJson(res, 400, { ok: false, error: "Bad Request: veld 'dossier' is verplicht." });
    }

    const apiKey = getApiKey();

    // — Step 1: primaire prompt
    const prompt1 = buildPrompt(role, dossier);
    const r1 = await callGeminiWithPolicy({ prompt: prompt1, apiKey, models: DEFAULT_MODELS });
    let text = normalizeOutputByRole(role, r1.text);

    // — Step 2: validatie + 1 herprompt indien nodig
    if (!validateByRole(role, text)) {
      const strictHint = [
        "STRICT: Corrigeer output volgens de regels.",
        role === "notary-fr" ? "La langue DOIT être le FRANÇAIS, avec 'Objet:' et les placeholders <PLAATS>, <DATUM>, <NAAM>, <ADRES>." : "",
        role === "agent-nl" ? "De taal MOET NEDERLANDS zijn, met 'Onderwerp:' en placeholders <PLAATS>, <DATUM>, <NAAM>, <ADRES>." : "",
        role === "seller-mixed" ? "Produisez DEUX BLOCS distincts: d'abord 'FR' (français complet), ensuite 'NL' (néerlandais complet). Chaque bloc doit respecter la structure et les placeholders." : ""
      ].filter(Boolean).join("\n");

      const prompt2 = [buildPrompt(role, dossier), "", strictHint].join("\n");
      const r2 = await callGeminiWithPolicy({ prompt: prompt2, apiKey, models: DEFAULT_MODELS });
      text = normalizeOutputByRole(role, r2.text);
    }

    // — Laatste check; als nog fout, geef de best effort terug met een waarschuwing
    const valid = validateByRole(role, text);

    return sendJson(res, 200, {
      ok: true,
      role,
      model: r1.modelUsed, // eerste succesvolle model
      throttleNotice: r1.throttleNotice || null,
      output: {
        letter_text: text,
        valid
      },
      meta: {
        received_chars: dossier.length,
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    const status = err.status || 500;
    const payload = err.out || { ok: false, error: err.message || "Internal Error" };
    return sendJson(res, status, payload);
  }
}
