// /api/compose.js (ESM)
// Vercel Serverless Function — POST { role, dossier }
// Doel: genereer voorbeeldbrieven o.b.v. rol en dossier (NL/FR) zonder externe calls vanuit de client.
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

// ——— Helpers ———
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

// Rollen: knoppen in UI
// - "notary-fr"  → Notarisbrief in het Frans
// - "agent-nl"   → Makelaarsbrief in het Nederlands
// - "seller-mixed" → Brief aan verkoper tweetalig FR/NL
const ROLE_LABELS = {
  "notary-fr": "Notaris (Frans)",
  "agent-nl": "Makelaar (Nederlands)",
  "seller-mixed": "Verkoper (Frans/Nederlands)"
};

function buildPrompt(role, dossier) {
  // Strikte instructies: geen externe data, formeel, kort, bruikbaar. Voeg placeholders toe voor naam/handtekening.
  const baseRules = [
    "Schrijf een beknopte, formele brief op basis van uitsluitend het aangeleverde dossier.",
    "Geen externe feiten verzinnen. Geen links opnemen.",
    "Gebruik duidelijke alinea’s. Voeg geen greeting/closing die culturele fouten maken.",
    "Plaats geen persoonsgegevens; gebruik placeholders zoals <NAAM>, <ADRES>, <DATUM>.",
    "Sluit af met een korte, neutrale afsluiting en een disclaimer-regel."
  ].join("\n");

  let langBlock = "";
  if (role === "notary-fr") {
    langBlock = [
      "TAAL: Frans.",
      "ADRESSEE: Notaire (notaris).",
      "INHOUD:",
      "- Vraag om kadastrale referenties (section, numéro de parcelle) en servitudes (erfdienstbaarheden).",
      "- Vraag om ERP (État des Risques) niet ouder dan 6 maanden, indien beschikbaar.",
      "- Verwijs naar het feit dat DVF op gemeenteniveau is en dat exacte perceelinfo nodig is.",
      "- Houd formele toon, kort en puntsgewijs, maar in briefformaat (aanhef, kern, afsluiting)."
    ].join("\n");
  } else if (role === "agent-nl") {
    langBlock = [
      "TAAL: Nederlands.",
      "ADRESSEE: Makelaar.",
      "INHOUD:",
      "- Verzoek om exacte adres- en kadastrale gegevens.",
      "- Vraag naar recente vergelijkbare verkopen in de omgeving (naast DVF op gemeenteniveau).",
      "- Vraag naar bekende aandachtspunten/gebreken en lopende dossiers.",
      "- Formele, zakelijke toon; beknopt."
    ].join("\n");
  } else if (role === "seller-mixed") {
    langBlock = [
      "TAAL: Tweetalig; eerst Frans, daarna Nederlands.",
      "ADRESSEE: Verkoper.",
      "INHOUD:",
      "- Vraag vriendelijk om recente ERP (≤ 6 maanden), kadastrale referenties, en eventuele servitudes/geschillen.",
      "- Houd beide talen kort, dezelfde inhoud in beide talen.",
      "- Scheid de talen met duidelijke kopjes: 'FR' en 'NL'."
    ].join("\n");
  } else {
    // Onbekende rol
    langBlock = "TAAL: Nederlands. KORTE TESTBRIEF.";
  }

  return [
    baseRules,
    "",
    "ROL:",
    ROLE_LABELS[role] || role,
    "",
    "DOSSIER:",
    dossier,
    "",
    "OUTPUT:",
    "- Geef volledige brieftekst (geen JSON, geen markdown codefences).",
    "- Begin met plaats en datum placeholder. Gebruik <PLAATS>, <DATUM>.",
    "- Voeg onderwerpregel toe (Subject / Objet).",
    "- Sluit af met een korte disclaimer: 'Dit bericht is indicatief; raadpleeg officiële bronnen en professionals.'"
  ].join("\n");
}

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

      // 429 → backoff 2s, dan 4s
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

      // 404/NOT_FOUND → volgende model
      const notFoundMsg = (err.payload && (err.payload.error?.status || err.payload.error?.message || "")).toString();
      if (err.status === 404 || /NOT_FOUND/i.test(notFoundMsg)) {
        continue;
      }

      // Anders ook proberen met fallback
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

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return sendJson(res, 405, { ok: false, error: "Method Not Allowed. Use POST { role, dossier }." });
    }

    // Body lezen (compatibel met verschillende runtimes)
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { /* ignore */ }
    }
    if (!body || typeof body !== "object") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      try { body = JSON.parse(raw || "{}"); } catch { body = {}; }
    }

    const role = String(body.role || "").trim();
    const dossier = String(body.dossier || "").trim();

    if (!role || !["notary-fr", "agent-nl", "seller-mixed"].includes(role)) {
      return sendJson(res, 400, { ok: false, error: "Bad Request: 'role' vereist en moet één van [notary-fr, agent-nl, seller-mixed] zijn." });
    }
    if (!dossier) {
      return sendJson(res, 400, { ok: false, error: "Bad Request: veld 'dossier' is verplicht." });
    }

    const apiKey = getApiKey();
    const prompt = buildPrompt(role, dossier);

    const { text, modelUsed, throttleNotice } = await callGeminiWithPolicy({
      prompt,
      apiKey,
      models: DEFAULT_MODELS
    });

    return sendJson(res, 200, {
      ok: true,
      model: modelUsed,
      throttleNotice: throttleNotice || null,
      role,
      output: {
        letter_text: text
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
