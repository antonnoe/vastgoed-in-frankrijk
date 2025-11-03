// /api/analyse.js
// Vercel Serverless Function — POST { dossier }
// Doel: AI-overzicht op basis van ingevoerd dossier (rode vlaggen / acties / vragen)
// Vereisten: Env var GEMINI_API_KEY (Vercel → Settings → Environment Variables)

const DEFAULT_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash-latest"];
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

// ——— Simpele, in-memory rate limiting (best effort in één instance) ———
// Regels: 1 req/sec, max 8 req/min.
// Let op: serverless is stateless over meerdere instances; dit beschermt vooral tegen bursts per instance.
const calls = [];
function nowMs() { return Date.now(); }
function pruneCalls() {
  const cutoff = nowMs() - 60_000;
  while (calls.length && calls[0] < cutoff) calls.shift();
}
async function enforceRateLimit() {
  pruneCalls();
  // Max 8/min
  if (calls.length >= 8) {
    const earliest = calls[0];
    const waitMs = Math.max(0, (earliest + 60_000) - nowMs());
    await new Promise(r => setTimeout(r, waitMs));
    pruneCalls();
  }
  // 1 req/sec (tussen opeenvolgende)
  const last = calls[calls.length - 1];
  if (last && nowMs() - last < 1_000) {
    const waitMs = 1_000 - (nowMs() - last);
    await new Promise(r => setTimeout(r, waitMs));
  }
  calls.push(nowMs());
}

// ——— Helpers ———
function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function getApiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY");
  return key;
}

function buildPrompt(dossier) {
  // Strikt: geen externe feiten, alleen redeneren over de input. Korte, actiegerichte output.
  return [
    "Je bent een juridische/vastegoed-analist. Werk:",
    "- Alleen op basis van de aangeleverde tekst hieronder.",
    "- Geen externe bronnen/data verzinnen of citeren.",
    "- Wees kort, concreet, puntsgewijs. Nederlands.",
    "- Toon drie secties: 'Rode vlaggen', 'Wat nu regelen', 'Vragen (verkoper/notaris/makelaar)'.",
    "- Benoem dat DVF op gemeenteniveau is en ERP (≤6 mnd) nodig is als het adres bekend is.",
    "",
    "INPUT DOSSIER:",
    dossier,
    "",
    "OUTPUTFORMAT (strikt):",
    "Rode vlaggen:",
    "- …",
    "- …",
    "",
    "Wat nu regelen:",
    "- …",
    "- …",
    "",
    "Vragen (verkoper/notaris/makelaar):",
    "- Verkoper: …",
    "- Notaris: …",
    "- Makelaar: …",
    "",
    "Disclaimer (één zin): Deze analyse is indicatief; raadpleeg officiële bronnen en professionals."
  ].join("\n");
}

async function callGeminiOnce({ model, text, apiKey }) {
  const url = `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [
      {
        parts: [{ text }]
      }
    ]
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(body)
  });

  const isJson = (resp.headers.get("content-type") || "").includes("application/json");
  const payload = isJson ? await resp.json() : await resp.text();

  // Normaliseer bekende foutcodes
  if (!resp.ok) {
    const err = new Error("Gemini error");
    err.status = resp.status;
    err.payload = payload;
    throw err;
  }

  // Extractie: candidates[0].content.parts[].text
  let textOut = "";
  try {
    const parts = payload?.candidates?.[0]?.content?.parts || [];
    textOut = parts.map(p => p.text || "").join("").trim();
  } catch (_) {
    // val stil terug op lege string
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
      // Rate limiting per call (1/sec, 8/min)
      await enforceRateLimit();
      const { text, raw } = await callGeminiOnce({ model, text: prompt, apiKey });
      modelUsed = model;
      return { text, raw, modelUsed, throttleNotice };
    } catch (err) {
      lastError = err;

      // 429 → backoff 2s, dan één extra poging met 4s
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
              // Ga door naar volgend model (fallback)
            }
          } else {
            lastError = err2;
          }
        }
      }

      // 404 / NOT_FOUND → switch naar volgend model in lijst
      const notFoundMsg = (err.payload && (err.payload.error?.status || err.payload.error?.message || "")).toString();
      if (err.status === 404 || /NOT_FOUND/i.test(notFoundMsg)) {
        // probeer volgend model in de loop
        continue;
      }

      // Andere fout → probeer ook fallback model
      continue;
    }
  }

  // Als alle modellen faalden:
  const status = lastError?.status || 500;
  const details = lastError?.payload || { message: String(lastError) };
  const message =
    status === 429
      ? "Gemini-throttling blijft actief na backoff. Probeer het zo dadelijk opnieuw."
      : "Gemini kon geen resultaat leveren.";
  const errorOut = {
    ok: false,
    status,
    message,
    details
  };
  const err = new Error(message);
  err.status = status;
  err.out = errorOut;
  throw err;
}

function splitToSections(markdown) {
  // Probeert de drie secties grof te verdelen, maar geeft ook raw terug
  const result = {
    red_flags: "",
    actions: "",
    questions: "",
    disclaimer: "",
    raw: markdown || ""
  };

  const lines = (markdown || "").split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const l = line.trim().toLowerCase();
    if (l.startsWith("rode vlaggen")) { current = "red_flags"; continue; }
    if (l.startsWith("wat nu regelen")) { current = "actions"; continue; }
    if (l.startsWith("vragen")) { current = "questions"; continue; }
    if (l.startsWith("disclaimer")) { current = "disclaimer"; continue; }
    if (!current) continue;
    // Append line to the current section (preserve formatting)
    if (result[current]) result[current] += "\n" + line;
    else result[current] = line;
  }
  // Trim sections
  for (const k of ["red_flags","actions","questions","disclaimer"]) {
    result[k] = (result[k] || "").trim();
  }
  return result;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return json(res, 405, { ok: false, error: "Method Not Allowed. Use POST { dossier }." });
    }

    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (_) { /* ignore */ }
    }
    const dossier = (body && body.dossier ? String(body.dossier) : "").trim();

    if (!dossier) {
      return json(res, 400, { ok: false, error: "Bad Request: veld 'dossier' is verplicht." });
    }

    const apiKey = getApiKey();
    const prompt = buildPrompt(dossier);

    const { text, raw, modelUsed, throttleNotice } = await callGeminiWithPolicy({
      prompt,
      apiKey,
      models: DEFAULT_MODELS
    });

    const sections = splitToSections(text);

    return json(res, 200, {
      ok: true,
      model: modelUsed,
      throttleNotice: throttleNotice || null,
      output: {
        red_flags: sections.red_flags,
        actions: sections.actions,
        questions: sections.questions,
        disclaimer: sections.disclaimer,
        raw_text: sections.raw
      },
      // minimale usage/debug-info zonder gevoelige data
      meta: {
        received_chars: dossier.length,
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    const status = err.status || 500;
    const payload = err.out || { ok: false, error: err.message || "Internal Error" };
    return json(res, status, payload);
  }
};
