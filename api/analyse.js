// /api/analyse.js (ESM)
// Immodiagnostique – AI-analyse endpoint (Gemini REST, geen SDK)
// Contract:
//   POST { dossier: string, signals?: object }
//     - 'dossier' = samengestelde tekst uit de UI (+ evt. samenvatting van /api/summary)
//     - 'signals' (optioneel) = object met harde signalen (prijs/DVF, georisques, gpu, dpe/isolatie, advertentie-keywords)
// Response: { ok, model, throttleNotice?, output: { ... }, meta }
//
// Belangrijk:
// - Alle externe AI-calls via server (hier), nooit vanuit de browser.
// - Rate limit: 1 req/sec; max 8 req/min (best-effort, per instance).
// - 429 → backoff 2s, dan 4s. Max 3 pogingen.
// - 404/NOT_FOUND → fallback model: gemini-2.0-flash → gemini-1.5-flash-latest.
// - Env var: GEMINI_API_KEY (exacte naam).
// - Default taal: Nederlands (UI-copy NL).
//
// Let op: backward compatible met eerdere velden (red_flags/actions/questions/disclaimer/raw_text),
// én uitgebreid met gestructureerde SWOT + actieplan + communicatie.

const RATE_WINDOW_MS = 60_000;
const MAX_PER_MINUTE = 8;
const MIN_SPACING_MS = 1_000; // 1 req/sec
const calls = [];

const DEFAULT_MODEL_PRIMARY = "gemini-2.0-flash";
const DEFAULT_MODEL_FALLBACK = "gemini-1.5-flash-latest";
const ALT_MODEL = "gemini-2.0-flash"; // expliciet proberen als 404 gemeld wordt met andere naam-inconsistenties

function now() { return Date.now(); }
function pruneCalls() {
  const cutoff = now() - RATE_WINDOW_MS;
  while (calls.length && calls[0] < cutoff) calls.shift();
}
async function enforceRateLimit() {
  pruneCalls();
  // per minuut
  if (calls.length >= MAX_PER_MINUTE) {
    const waitMs = (calls[0] + RATE_WINDOW_MS) - now();
    if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
    pruneCalls();
  }
  // 1/sec
  const last = calls[calls.length - 1];
  if (last && (now() - last) < MIN_SPACING_MS) {
    await new Promise(r => setTimeout(r, MIN_SPACING_MS - (now() - last)));
  }
  calls.push(now());
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}
const sanitize = (v) => (typeof v === "string" ? v.trim() : "");

function buildPrompt(dossier, signals) {
  // 'signals' is een object met harde feiten. We dwingen JSON-output af met NL-terminologie.
  const signalsJson = JSON.stringify(signals || {}, null, 2);
  return [
`Je bent een Nederlandstalige analysemodule voor een vastgoed-vooronderzoek in Frankrijk (Immodiagnostique).`,
`Doel: maak een nuchtere, beknopte, **gestructureerde** analyse in JSON. Geen omslagteksten, geen codeblokken, **alleen JSON**.`,
`Context (dossier):`,
dossier,
`Harde signalen (objectief, te gebruiken als leidraad – verzin geen data):`,
signalsJson,
`Regels voor SWOT-mapping (hybride benadering, wees eerlijk en transparant):`,
`- Gebruik signalen uit DVF/prijs, Géorisques, PLU/SUP, DPE/isolatie en advertentietekst.`,
`- Interne zaken (staat, prijs, ontbrekende documenten) → "Mogelijke zorgpunten".`,
`- Externe zaken (overheidsrisico’s zoals overstroming/seismisch/industrieel, beleidsbeperkingen, markt) → "Mogelijke bedreigingen".`,
`- "Sterke punten": o.a. relatief lage prijs (<= ~-10% t.o.v. DVF-mediaan), géén georisques-hits, goede energetische score (DPE A–C), isolatie, moderne systemen.`,
`- "Mogelijke kansen": o.a. lage prijs met renovatiepotentieel, PLU-mogelijkheden, verduurzamingswinst, subsidies.`,
`- Bij ontbrekende brondata: noem dat expliciet als zorgpunt (bijv. ERP ontbreekt).`,
`- Voeg per bullet een korte bron-tag toe: (bron: DVF), (bron: Géorisques), (bron: PLU), (bron: advertentie), (bron: DPE/isolatie), of (bron: onbekend).`,
`- Geef ook een confidence per bullet: laag / middel / hoog.`,
`- Formuleer neutraal, zonder alarmisme. Max 3–6 bullets per lijst.`,
`- Neem een kort "actieplan" op (3–6 puntsgewijze acties, pragmatisch – bv. ERP opvragen, PLU-zonering checken, DVF vergelijken, kadastrale referenties bevestigen).`,
`- Neem een compacte lijst "communicatie" op met punten/vragen voor verkoper, notaris en makelaar (in NL, to-the-point).`,
`- Houd een "disclaimer" veld aan (1 zin in NL).`,
`JSON-schema (STRICT, alleen velden hieronder, strings en arrays van strings):`,
`{
  "swot": {
    "sterke_punten": [ "• tekst (bron: X) [confidence: laag|middel|hoog]" ],
    "mogelijke_zorgpunten": [ "• tekst (bron: X) [confidence: ...]" ],
    "mogelijke_kansen": [ "• tekst (bron: X) [confidence: ...]" ],
    "mogelijke_bedreigingen": [ "• tekst (bron: X) [confidence: ...]" ]
  },
  "actieplan": [ "• actie 1", "• actie 2" ],
  "communicatie": {
    "verkoper": [ "• vraag 1", "• vraag 2" ],
    "notaris": [ "• vraag 1", "• vraag 2" ],
    "makelaar": [ "• vraag 1", "• vraag 2" ]
  },
  "red_flags": [ "• (optioneel, legacy-veld — zet hier dezelfde items als 'mogelijke_zorgpunten' als dat logisch is)" ],
  "actions": [ "• (optioneel, legacy-veld — copieer uit 'actieplan' )" ],
  "questions": [ "• (optioneel, legacy-veld — combineer communicatiepunten indien nodig)" ],
  "disclaimer": "korte NL disclaimerzin",
  "raw_text": "max 500 tekens, samenvatting in lopende tekst (NL)."
}`,
`Antwoord **alleen** met JSON volgens bovenstaand schema.`
  ].join("\n\n");
}

function extractJson(text) {
  if (!text || typeof text !== "string") return null;
  // Probeer direct parse
  try { return JSON.parse(text); } catch {}
  // Probeer grove substring van eerste { tot laatste }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const slice = text.slice(first, last + 1);
    try { return JSON.parse(slice); } catch {}
  }
  return null;
}

async function callGeminiOnce({ model, apiKey, prompt }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ parts: [{ text: prompt }]}],
  };

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20_000);

  await enforceRateLimit();

  let resp, json;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: ac.signal
    });
    const ct = resp.headers.get("content-type") || "";
    json = ct.includes("application/json") ? await resp.json() : await resp.text();
  } finally {
    clearTimeout(t);
  }

  return { status: resp?.status || 0, data: json };
}

async function callGeminiWithRetries({ prompt }) {
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) {
    const e = new Error("Server misconfigured: GEMINI_API_KEY ontbreekt.");
    e.status = 500;
    throw e;
  }

  let modelsToTry = [DEFAULT_MODEL_PRIMARY, ALT_MODEL, DEFAULT_MODEL_FALLBACK];
  let lastErr = null;
  let throttleNotice = null;

  for (let i = 0; i < modelsToTry.length; i++) {
    let model = modelsToTry[i];
    // Max 3 pogingen per model bij 429
    let attempts = 0;
    while (attempts < 3) {
      attempts++;
      const { status, data } = await callGeminiOnce({ model, apiKey, prompt });

      // 2xx — probeer te lezen
      if (status >= 200 && status < 300) {
        try {
          const text = (data?.candidates?.[0]?.content?.parts || [])
            .map(p => (typeof p.text === "string" ? p.text : ""))
            .join("\n")
            .trim();
          const parsed = extractJson(text);
          if (parsed) {
            return { model, throttleNotice, output: parsed, rawText: text };
          }
          // Geen JSON — behandel als fout
          lastErr = new Error("Geen valide JSON van model ontvangen.");
          lastErr.details = text.slice(0, 2_000);
          break; // naar volgend model
        } catch (e) {
          lastErr = e;
          break; // naar volgend model
        }
      }

      // 404 / NOT_FOUND → volgende model
      const errStr = JSON.stringify(data || {});
      if (status === 404 || /NOT_FOUND/i.test(errStr)) {
        break; // ga naar volgend model
      }

      // 429 → backoff
      if (status === 429) {
        if (attempts === 1) { throttleNotice = "429 ontvangen: backoff 2s toegepast."; await new Promise(r => setTimeout(r, 2000)); continue; }
        if (attempts === 2) { throttleNotice = "429 ontvangen: extra backoff 4s toegepast."; await new Promise(r => setTimeout(r, 4000)); continue; }
        // derde keer mislukt → volgende model
        lastErr = new Error("429 na retries.");
        break;
      }

      // Andere niet-OK → volgende model
      lastErr = new Error(`Gemini HTTP ${status}`);
      lastErr.details = data;
      break;
    }
    // Probeer volgend model
  }

  if (lastErr) throw lastErr;
  throw new Error("Onbekende fout bij AI-oproep.");
}

function normalizeOutput(ai) {
  // Backward compatibility + defensieve normalisatie
  const out = {
    swot: {
      sterke_punten: [],
      mogelijke_zorgpunten: [],
      mogelijke_kansen: [],
      mogelijke_bedreigingen: [],
    },
    actieplan: [],
    communicatie: {
      verkoper: [],
      notaris: [],
      makelaar: [],
    },
    red_flags: [],
    actions: [],
    questions: [],
    disclaimer: "",
    raw_text: ""
  };

  if (ai && typeof ai === "object") {
    if (ai.swot && typeof ai.swot === "object") {
      out.swot.sterke_punten = toArr(ai.swot.sterke_punten);
      out.swot.mogelijke_zorgpunten = toArr(ai.swot.mogelijke_zorgpunten);
      out.swot.mogelijke_kansen = toArr(ai.swot.mogelijke_kansen);
      out.swot.mogelijke_bedreigingen = toArr(ai.swot.mogelijke_bedreigingen);
    }
    out.actieplan = toArr(ai.actieplan);
    if (ai.communicatie && typeof ai.communicatie === "object") {
      out.communicatie.verkoper = toArr(ai.communicatie.verkoper);
      out.communicatie.notaris = toArr(ai.communicatie.notaris);
      out.communicatie.makelaar = toArr(ai.communicatie.makelaar);
    }
    out.red_flags = toArr(ai.red_flags);
    out.actions = toArr(ai.actions);
    out.questions = toArr(ai.questions);
    out.disclaimer = typeof ai.disclaimer === "string" ? ai.disclaimer : "";
    out.raw_text = typeof ai.raw_text === "string" ? ai.raw_text : "";
  }
  // Legacy fallback: als red_flags leeg is maar zorgpunten niet, kopieer
  if (!out.red_flags.length && out.swot.mogelijke_zorgpunten.length) {
    out.red_flags = [...out.swot.mogelijke_zorgpunten];
  }
  if (!out.actions.length && out.actieplan.length) {
    out.actions = [...out.actieplan];
  }
  if (!out.questions.length) {
    out.questions = [
      ...out.communicatie.verkoper,
      ...out.communicatie.notaris,
      ...out.communicatie.makelaar
    ].slice(0, 12);
  }
  return out;
}

function toArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(x => String(x));
  if (typeof v === "string") return v.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return [];
}

// -------- HTTP handler --------
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return sendJson(res, 405, { ok: false, error: "Method Not Allowed. Use POST { dossier, signals? }." });
    }

    // Body lezen (Vercel kan body als string of object geven)
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

    const dossier = sanitize(body.dossier);
    const signals = (body.signals && typeof body.signals === "object") ? body.signals : null;

    if (!dossier) {
      return sendJson(res, 400, { ok: false, error: "Bad Request: veld 'dossier' is verplicht en mag niet leeg zijn." });
    }

    const prompt = buildPrompt(dossier, signals);

    const started = new Date().toISOString();
    const { model, throttleNotice, output: aiOut, rawText } = await callGeminiWithRetries({ prompt });
    const normalized = normalizeOutput(aiOut);

    return sendJson(res, 200, {
      ok: true,
      model,
      throttleNotice: throttleNotice || null,
      output: normalized,
      meta: {
        received_chars: dossier.length,
        signals_present: !!signals,
        timestamp: started
      }
    });

  } catch (err) {
    const status = err.status || 502;
    const msg = err.message || "AI-analyse mislukt";
    return sendJson(res, status, { ok: false, error: msg, details: err.details || undefined });
  }
}
