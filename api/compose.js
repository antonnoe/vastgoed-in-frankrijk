// /api/compose.js (ESM, kanaal-ondersteuning + strikte rollen)
// POST { role, dossier, channel? }  where role ∈ [notary-fr, agent-nl, seller-mixed]
// channel ∈ [email, pb, phone, letter]  (default: email)
//
// Policies:
// - REST naar Google Gemini (geen SDK). Default model: gemini-2.0-flash; fallback: gemini-1.5-flash-latest.
// - Rate limit: 1 req/sec, max 8/min. 429 -> backoff 2s, dan 4s.
// - 404/NOT_FOUND -> switch model.
// - GEEN API key client-side; leest GEMINI_API_KEY uit env.

const DEFAULT_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash-latest"];
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

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

const ROLE_LABELS = {
  "notary-fr": "Notaris (Frans)",
  "agent-nl": "Makelaar (Nederlands)",
  "seller-mixed": "Verkoper (Frans/Nederlands)"
};
const VALID_ROLES = Object.keys(ROLE_LABELS);

const CHANNELS = ["email", "pb", "phone", "letter"];

// ——— Promptbouw ———
function buildPrompt(role, channel, dossier) {
  const baseRules = [
    "WERKWIJZE:",
    "- Gebruik UITSLUITEND het dossier hieronder; geen externe feiten of links.",
    "- KORT, concreet, toepasbaar.",
    "- Gebruik placeholders: <PLAATS>, <DATUM>, <NAAM>, <ADRES> indien passend.",
    "",
    "Rollen en talen (VERPLICHT):",
    "- notary-fr: ALLES in het FRANS.",
    "- agent-nl: ALLES in het NEDERLANDS.",
    "- seller-mixed: TWEE BLOKKEN: eerst FR, dan NL.",
    "",
    "Kanalen en structuur (VOLG EXACT):",
    "- email: bevat onderwerpregel (FR: 'Objet:' / NL: 'Onderwerp:'), formele aanhef, compacte body, formele afsluiting, afsluitende disclaimer.",
    "- pb (persoonlijk bericht): GEEN onderwerpregel; direct en kort; geen formele adressering; wel nette afsluiting + disclaimer.",
    "- phone: GEEN onderwerp/aanhef; geef een puntsgewijs belscript: Intro (1–2 zinnen), Kernvragen (3–6 bullets), Afsluiting (1–2 bullets), gevolgd door disclaimer.",
    "- letter: formele brief met onderwerpregel, aanhef, body, formele afsluiting, adres/naam placeholders en disclaimer.",
    "",
    "Vastgoedcontext die bijna altijd geldt:",
    "- ERP (≤ 6 maanden) nodig zodra adres bekend is.",
    "- DVF is op gemeenteniveau (niet per adres).",
    "- Vraag om kadastrale referenties en servitudes wanneer relevant."
  ].join("\n");

  const fewshotEmailFR = [
    "EXEMPEL EMAIL FR:",
    "Objet: Demande d’informations cadastrales et ERP",
    "Madame, Monsieur,",
    "- Merci de communiquer les références cadastrales (section, n° de parcelle) et les servitudes éventuelles.",
    "- Un ERP (≤ 6 mois) est requis pour l’adresse indiquée.",
    "Veuillez agréer, Madame, Monsieur, l’expression de mes salutations distinguées.",
    "<NAAM>",
    "<ADRES>",
    "Ce message est indicatif; consultez les sources officielles et des professionnels."
  ].join("\n");

  const fewshotEmailNL = [
    "EXEMPEL EMAIL NL:",
    "Onderwerp: Informatieaanvraag kadastrale gegevens en recente verkopen",
    "Geachte heer/mevrouw,",
    "- Graag ontvang ik het exacte adres en de kadastrale referenties.",
    "- Daarnaast recente vergelijkbare verkopen (naast DVF op gemeenteniveau).",
    "Met vriendelijke groet,",
    "<NAAM>",
    "<ADRES>",
    "Dit bericht is indicatief; raadpleeg officiële bronnen en professionals."
  ].join("\n");

  const fewshotPB = [
    "EXEMPEL PB (kort, geen onderwerp/aanhef):",
    "- Ik ben geïnteresseerd in het pand. Kunt u het exacte adres/kadasternummer en een recent ERP (≤ 6 mnd) delen?",
    "- Ook hoor ik graag recente vergelijkbare verkopen in de buurt.",
    "Alvast dank! <NAAM>",
    "Dit bericht is indicatief; raadpleeg officiële bronnen en professionals."
  ].join("\n");

  const fewshotPhone = [
    "EXEMPEL PHONE (belscript):",
    "Intro:",
    "- Goedendag, u spreekt met <NAAM>. Ik bel over het pand in <PLAATS>.",
    "Kernvragen:",
    "- Kunt u het exacte adres en kadastrale referenties bevestigen?",
    "- Is er een ERP (≤ 6 maanden) beschikbaar?",
    "- Zijn er bekende servitudes of bijzonderheden?",
    "- Zijn er recente vergelijkbare verkopen in de directe omgeving?",
    "Afsluiting:",
    "- Dank u wel. Kunt u de documenten mailen? Mijn e-mail: <ADRES>.",
    "Dit bericht is indicatief; raadpleeg officiële bronnen en professionals."
  ].join("\n");

  const fewshotLetterFRNL = [
    "EXEMPEL LETTER SELLER-MIXED:",
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

  // Rol-specificatie
  let roleBlock = "";
  if (role === "notary-fr") {
    roleBlock = [
      "TAAL: FRANS (hele output).",
      channel === "email" ? fewshotEmailFR : channel === "pb" ? fewshotPB : channel === "phone" ? fewshotPhone : fewshotEmailFR
    ].join("\n");
  } else if (role === "agent-nl") {
    roleBlock = [
      "TAAL: NEDERLANDS (hele output).",
      channel === "email" ? fewshotEmailNL : channel === "pb" ? fewshotPB : channel === "phone" ? fewshotPhone : fewshotEmailNL
    ].join("\n");
  } else {
    // seller-mixed (FR + NL)
    // Bij email/letter handhaven we tweetalige briefvorm; bij pb/phone maken we twee blokken met kopjes FR/NL.
    roleBlock = [
      "TAAL: TWEETALIG. EERST FRANS-BLOK, DAN NEDERLANDS-BLOK.",
      "STRUCTUUR:",
      channel === "phone"
        ? "- Geef twee belscripts: eerst 'FR', dan 'NL', elk met Intro/Kernvragen/Afsluiting bullets."
        : channel === "pb"
          ? "- Geef twee PB-teksten: kop 'FR', kort PB-bericht; lege regel; kop 'NL', kort PB-bericht."
          : "- Geef twee brieven (FR daarna NL) met onderwerp/aanhef/body/afsluiting.",
      fewshotLetterFRNL
    ].join("\n");
  }

  return [
    baseRules,
    "",
    "ROL:",
    ROLE_LABELS[role] || role,
    "KANAAL:",
    channel,
    "",
    "DOSSIER (alleen als context, citeer spaarzaam):",
    dossier,
    "",
    "VOLG DE ROL- EN KANAALREGELS STRIKT. PRODUCEER ENKEL DE TEKST (geen JSON of codefences)."
  ].join("\n") + "\n\n" + roleBlock;
}

// ——— Gemini-call + policy ———
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
  } catch {}
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
        continue;
      }
      continue;
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

// ——— Validatie/normalisatie ———
function looksFrench(s = "") {
  const frWords = ["Madame", "Monsieur", "Objet", "Veuillez", "références", "cadastrales", "servitudes", "Veuillez agréer"];
  const diacritics = /[éèêëàâîïôöûüç]/i.test(s);
  const hits = frWords.reduce((n, w) => n + (s.includes(w) ? 1 : 0), 0);
  return diacritics || hits >= 2;
}
function looksDutch(s = "") {
  const nlWords = ["Geachte", "Onderwerp", "Met vriendelijke groet", "erfdienstbaarheden", "kadastrale", "bij voorbaat"];
  const hits = nlWords.reduce((n, w) => n + (s.includes(w) ? 1 : 0), 0);
  return hits >= 2;
}
function hasSubjectFR(s=""){ return /^Objet\s*:/mi.test(s); }
function hasSubjectNL(s=""){ return /^(Onderwerp|Subject\s*\/\s*Onderwerp)\s*:/mi.test(s); }
function ensurePlaceholdersBlock(t){
  let out = t.trim();
  if (!/<PLAATS>/.test(out) || !/<DATUM>/.test(out)) {
    out = `<PLAATS>, <DATUM>\n` + out;
  }
  if (!/<NAAM>/.test(out)) out += `\n<NAAM>`;
  if (!/<ADRES>/.test(out)) out += `\n<ADRES>`;
  return out.trim();
}

function normalizeByRoleAndChannel(role, channel, text) {
  let t = String(text || "").trim();

  if (role === "notary-fr") {
    if (channel === "email" || channel === "letter") {
      if (!hasSubjectFR(t)) t = `Objet: (à compléter)\n` + t;
      t = ensurePlaceholdersBlock(t);
    } else if (channel === "pb") {
      // geen onderwerp/aanhef verplicht; kort houden
      t = t.replace(/^Objet\s*:.*$/gmi, "").trim();
    } else if (channel === "phone") {
      // verwacht bullets, laat tekst ongemoeid
    }
  } else if (role === "agent-nl") {
    if (channel === "email" || channel === "letter") {
      if (!hasSubjectNL(t)) t = `Onderwerp: (in te vullen)\n` + t;
      t = ensurePlaceholdersBlock(t);
    } else if (channel === "pb") {
      t = t.replace(/^(Onderwerp|Subject\s*\/\s*Onderwerp)\s*:.*$/gmi, "").trim();
    } else if (channel === "phone") {
      // bullets verwacht
    }
  } else {
    // seller-mixed
    const hasFR = /(^|\n)FR\s*\n/.test(t);
    const hasNL = /(^|\n)NL\s*\n/.test(t);
    if (!(hasFR && hasNL)) {
      // forceer eenvoudige splitsing als ontbrekend
      const half = Math.floor(t.length / 2);
      t = `FR\n${t.slice(0, half).trim()}\n\nNL\n${t.slice(half).trim()}`;
    }
    if (channel === "email" || channel === "letter") {
      // Voeg placeholders/subjects toe binnen elk blok
      t = t.replace(/(^FR\s*\n)([\s\S]*?)(?=\nNL\b|$)/, (m, tag, block) => {
        let b = block;
        if (!hasSubjectFR(b)) b = `Objet: (à compléter)\n` + b;
        b = ensurePlaceholdersBlock(b);
        return `${tag}${b.trim()}\n`;
      });
      t = t.replace(/(^NL\s*\n)([\s\S]*)$/, (m, tag, block) => {
        let b = block;
        if (!hasSubjectNL(b)) b = `Onderwerp: (in te vullen)\n` + b;
        b = ensurePlaceholdersBlock(b);
        return `${tag}${b.trim()}`;
      });
    } else if (channel === "pb") {
      // Geen onderwerpregels
      t = t.replace(/(^FR[\s\S]*?)(?=\nNL\b)/, (seg) => seg.replace(/^Objet\s*:.*$/gmi, "").trim()+"\n");
      t = t.replace(/(^NL[\s\S]*)$/, (seg) => seg.replace(/^(Onderwerp|Subject\s*\/\s*Onderwerp)\s*:.*$/gmi, "").trim());
    } else if (channel === "phone") {
      // Laat staan; validatie checkt bullets
    }
  }
  // Zorg voor disclaimer
  if (!/Dit bericht is indicatief; raadpleeg officiële bronnen en professionals\./.test(t) &&
      !/Ce message est indicatif; consultez les sources officielles et des professionnels\./.test(t)) {
    t += "\n\nDit bericht is indicatief; raadpleeg officiële bronnen en professionals.";
  }
  return t.trim();
}

function validate(role, channel, text) {
  const t = (text || "").trim();
  if (role === "notary-fr") {
    if (channel === "email" || channel === "letter") {
      return looksFrench(t) && hasSubjectFR(t) && /<PLAATS>/.test(t);
    }
    if (channel === "pb") {
      return looksFrench(t) && !hasSubjectFR(t);
    }
    if (channel === "phone") {
      const bulletLines = t.split(/\r?\n/).filter(l => /^[-*]\s/.test(l));
      return bulletLines.length >= 3;
    }
  }
  if (role === "agent-nl") {
    if (channel === "email" || channel === "letter") {
      return looksDutch(t) && hasSubjectNL(t) && /<PLAATS>/.test(t);
    }
    if (channel === "pb") {
      return looksDutch(t) && !hasSubjectNL(t);
    }
    if (channel === "phone") {
      const bulletLines = t.split(/\r?\n/).filter(l => /^[-*]\s/.test(l));
      return bulletLines.length >= 3;
    }
  }
  // seller-mixed
  const frBlock = /(^|\n)FR\s*\n([\s\S]*?)(?=\nNL\b|$)/.exec(t);
  const nlBlock = /(^|\n)NL\s*\n([\s\S]*)$/.exec(t);
  if (!frBlock || !nlBlock) return false;
  if (channel === "email" || channel === "letter") {
    const frOk = looksFrench(frBlock[2]) && hasSubjectFR(frBlock[2]) && /<PLAATS>/.test(frBlock[2]);
    const nlOk = looksDutch(nlBlock[2]) && hasSubjectNL(nlBlock[2]) && /<PLAATS>/.test(nlBlock[2]);
    return frOk && nlOk;
  }
  if (channel === "pb") {
    const frOk = looksFrench(frBlock[2]) && !hasSubjectFR(frBlock[2]);
    const nlOk = looksDutch(nlBlock[2]) && !hasSubjectNL(nlBlock[2]);
    return frOk && nlOk;
  }
  if (channel === "phone") {
    const bulletsFR = frBlock[2].split(/\r?\n/).filter(l => /^[-*]\s/.test(l)).length;
    const bulletsNL = nlBlock[2].split(/\r?\n/).filter(l => /^[-*]\s/.test(l)).length;
    return bulletsFR >= 3 && bulletsNL >= 3;
  }
  return false;
}

// ——— Handler ———
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return sendJson(res, 405, { ok: false, error: "Method Not Allowed. Use POST { role, dossier, channel? }." });
    }

    // Body lezen
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch {} }
    if (!body || typeof body !== "object") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      try { body = JSON.parse(raw || "{}"); } catch { body = {}; }
    }

    const role = String(body.role || "").trim();
    const dossier = String(body.dossier || "").trim();
    const channel = (String(body.channel || "email").trim().toLowerCase());
    if (!VALID_ROLES.includes(role)) {
      return sendJson(res, 400, { ok: false, error: "Bad Request: 'role' moet één van [notary-fr, agent-nl, seller-mixed] zijn." });
    }
    if (!CHANNELS.includes(channel)) {
      return sendJson(res, 400, { ok: false, error: "Bad Request: 'channel' moet één van [email, pb, phone, letter] zijn." });
    }
    if (!dossier) {
      return sendJson(res, 400, { ok: false, error: "Bad Request: veld 'dossier' is verplicht." });
    }

    const apiKey = getApiKey();
    const prompt = buildPrompt(role, channel, dossier);

    const r1 = await callGeminiWithPolicy({ prompt, apiKey, models: DEFAULT_MODELS });
    let text = normalizeByRoleAndChannel(role, channel, r1.text);

    // één extra herprompt bij validatiefout
    if (!validate(role, channel, text)) {
      const strictHint = [
        "STRICT: Corrigeer volgens rol en kanaal.",
        role === "notary-fr" ? "Langue: FRANÇAIS. Email/lettre: exiger 'Objet:'; PB: PAS d'objet; Phone: liste à puces." : "",
        role === "agent-nl" ? "Taal: NEDERLANDS. E-mail/brief: 'Onderwerp:' verplicht; PB: géén onderwerp; Telefoon: bullets." : "",
        role === "seller-mixed" ? "Deux blocs requis: 'FR' puis 'NL'. Respectez les structures selon le canal." : ""
      ].filter(Boolean).join("\n");
      const prompt2 = buildPrompt(role, channel, dossier) + "\n\n" + strictHint;
      const r2 = await callGeminiWithPolicy({ prompt: prompt2, apiKey, models: DEFAULT_MODELS });
      text = normalizeByRoleAndChannel(role, channel, r2.text);
    }

    const valid = validate(role, channel, text);

    return sendJson(res, 200, {
      ok: true,
      role,
      channel,
      model: r1.modelUsed,
      throttleNotice: r1.throttleNotice || null,
      output: { letter_text: text, valid },
      meta: { received_chars: dossier.length, timestamp: new Date().toISOString() }
    });
  } catch (err) {
    const status = err.status || 500;
    const payload = err.out || { ok: false, error: err.message || "Internal Error" };
    return sendJson(res, status, payload);
  }
}
