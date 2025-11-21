// /api/analyse.js
// Immodiagnostique – Analyse endpoint (V5: Location Intel + Seller Check + Dutch Enforcement)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  const { dossier, signals } = (req.body || {});
  
  if ((!dossier || !dossier.trim()) && (!signals)) {
    return res.status(400).json({ ok: false, error: "Geen input data." });
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ ok: false, error: "Server config error: API Key missing" });
  }

  // 1. Bouw de 'Ultimate' Prompt
  const prompt = buildDeepAnalysisPrompt(dossier, signals);

  // 2. Call Gemini (met retry)
  const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
  let rawText = null;
  let modelUsed = '';

  for (const model of models) {
    try {
      rawText = await callGemini(GEMINI_API_KEY, model, prompt);
      if (rawText) {
        modelUsed = model;
        break;
      }
    } catch (e) {
      console.error(`Model ${model} failed:`, e.message);
    }
  }

  if (!rawText) {
    return res.status(502).json({ ok: false, error: "AI analyse mislukt." });
  }

  // 3. Parse output
  let parsed = parseStrictJson(rawText);
  if (!parsed) parsed = parseAiTextHeuristic(rawText);

  // 4. Schoonmaak & Verrijking
  const finalData = sanitizeAndEnrich(parsed, signals);

  return res.status(200).json({ ok: true, model: modelUsed, output: finalData });
}

// --- Gemini Caller ---
async function callGemini(key, model, text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text }] }] })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// --- PROMPT BUILDER V5 (Deep Analysis) ---
function buildDeepAnalysisPrompt(dossier, signals) {
  const hints = [];
  
  // Harde data context
  if (signals?.price) hints.push(`- Vraagprijs: €${signals.price}`);
  if (signals?.dvf?.median_price) hints.push(`- Buurtgemiddelde (DVF): €${signals.dvf.median_price}/m²`);
  
  // Zonering
  if (signals?.gpuMatch === 'exact') {
    const z = signals.gpu[0] || {};
    hints.push(`- Bestemming (PLU): Zone ${z.code} (${z.label}). Dit is een exact vastgesteld feit.`);
  } else if (signals?.gpuMatch === 'commune') {
    hints.push(`- Bestemming: Gemeente heeft digitaal plan, maar exact perceel niet gevonden.`);
  }

  // Risico's
  if (signals?.georisques) {
    const r = signals.georisques;
    const riskNames = [];
    if (r.flood) riskNames.push("Overstroming");
    if (r.argile) riskNames.push("Klei/Krimp (Argile)");
    if (r.industrial) riskNames.push("Industrieel");
    
    if (riskNames.length > 0) {
      hints.push(`- GEMEENTE RISICO'S (Data): ${riskNames.join(', ')}. LET OP: Check tekst of het huis specifiek risico loopt.`);
    }
  }

  return `
    Je bent Immodiagnostique, de expert voor vastgoed in Frankrijk.
    
    OPDRACHT:
    Analyseer de woningadvertentie diepgaand. Combineer de tekst met je eigen geografische kennis.

    1. LOCATIE PROFIEL (Context):
       Gebruik je kennis van de plaatsnaam in de tekst. 
       - Wat voor type plaats is het? (Dorp, stad, gehucht, forensengemeente?)
       - Hoe ver ligt het van grote steden, kust of bezienswaardigheden?
       - Wat is de demografische sfeer (Levendig vs Slaperig)?
       Schrijf dit als een compacte, informatieve paragraaf.

    2. VERKOPER ANALYSE:
       - Is dit een particulier (PAP, 'entre particuliers', 'propriétaire') of een makelaar?
       - Indien particulier: Zet 'Geen makelaarscourtage' bij sterke punten, maar waarschuw voor 'Minder juridische bescherming' bij risico's.
       - Indien makelaar: Als de naam bekend is (bijv. IAD, Safti, lokaal kantoor), benoem dit neutraal.

    3. TECHNISCHE CHECK:
       - Let op bouwjaar, energielabel (DPE), verwarming (warmtepomp/hout is top, olie/elektrisch is matig).
       - Let op specifieke termen: 'Travaux à prévoir' (Kluswoning), 'Viager' (Lijfrente), 'Loué' (Verhuurd).

    4. TAAL:
       Antwoord ALTIJD in het NEDERLANDS.

    Input Data:
    ${hints.join('\n')}

    Input Advertentie:
    "${dossier}"

    Verwacht JSON Schema:
    {
      "locatie_profiel": "Tekst...",
      "swot": {
        "sterke_punten": ["..."],
        "mogelijke_zorgpunten": ["..."],
        "mogelijke_kansen": ["..."],
        "mogelijke_bedreigingen": ["..."]
      },
      "actieplan": ["..."],
      "communicatie": { "notaris": ["..."], "makelaar": ["..."], "verkoper": ["..."] }
    }
  `;
}

// --- PARSERS & CLEANERS ---

function parseStrictJson(text) {
  const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
  try { return JSON.parse(clean); } catch (e) { return null; }
}

function parseAiTextHeuristic(text) {
  return {
    locatie_profiel: "Kon locatieprofiel niet genereren uit ruwe data.",
    swot: { sterke_punten: ["Zie ruwe tekst."] },
    actieplan: [],
    communicatie: {}
  };
}

function sanitizeAndEnrich(obj, signals) {
  const out = {
    locatie_profiel: obj?.locatie_profiel || "Geen profiel beschikbaar.",
    swot: {
      sterke_punten: obj?.swot?.sterke_punten || [],
      mogelijke_zorgpunten: obj?.swot?.mogelijke_zorgpunten || [],
      mogelijke_kansen: obj?.swot?.mogelijke_kansen || [],
      mogelijke_bedreigingen: obj?.swot?.mogelijke_bedreigingen || []
    },
    actieplan: obj?.actieplan || [],
    communicatie: {
      notaris: obj?.communicatie?.notaris || [],
      makelaar: obj?.communicatie?.makelaar || [],
      verkoper: obj?.communicatie?.verkoper || []
    }
  };

  // Data Injectie: Prijs check
  if (signals?.price && signals?.dvf?.median_price) {
    const p = signals.price / (signals.surface || 100);
    const m = signals.dvf.median_price;
    // Alleen toevoegen als het verschil significant is (>50% afwijking)
    if (p > m * 1.5) out.swot.mogelijke_zorgpunten.push(`Vraagprijs lijkt hoog t.o.v. buurtgemiddelde (€${m}/m²).`);
  }

  // Beperk lengtes
  const clamp = (arr) => Array.isArray(arr) ? arr.slice(0, 6) : [];
  out.swot.sterke_punten = clamp(out.swot.sterke_punten);
  out.swot.mogelijke_zorgpunten = clamp(out.swot.mogelijke_zorgpunten);
  out.swot.mogelijke_kansen = clamp(out.swot.mogelijke_kansen);
  out.swot.mogelijke_bedreigingen = clamp(out.swot.mogelijke_bedreigingen);
  out.actieplan = clamp(out.actieplan);

  return out;
}
