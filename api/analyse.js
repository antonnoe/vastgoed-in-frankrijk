// /api/analyse.js
// Immodiagnostique – Analyse endpoint (V6: Auto-Extraction Data)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  const { dossier, signals } = (req.body || {});
  if ((!dossier || !dossier.trim()) && (!signals)) return res.status(400).json({ ok: false, error: "Geen input." });

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return res.status(500).json({ ok: false, error: "API Key missing" });

  const prompt = buildDeepAnalysisPrompt(dossier, signals);
  const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
  
  let rawText = null;
  let modelUsed = '';

  for (const model of models) {
    try {
      rawText = await callGemini(GEMINI_API_KEY, model, prompt);
      if (rawText) { modelUsed = model; break; }
    } catch (e) { console.error(e); }
  }

  if (!rawText) return res.status(502).json({ ok: false, error: "AI analyse mislukt." });

  let parsed = parseStrictJson(rawText);
  if (!parsed) parsed = parseAiTextHeuristic(rawText);

  const finalData = sanitizeAndEnrich(parsed, signals);

  return res.status(200).json({ ok: true, model: modelUsed, output: finalData });
}

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

function buildDeepAnalysisPrompt(dossier, signals) {
  const hints = [];
  if (signals?.price) hints.push(`- Opgegeven Vraagprijs: €${signals.price}`);
  if (signals?.dvf?.median_price) hints.push(`- DVF Mediaan: €${signals.dvf.median_price}/m²`);
  
  if (signals?.gpuMatch === 'exact') {
    const z = signals.gpu[0] || {};
    hints.push(`- Bestemming (PLU): Zone ${z.code} (${z.label}).`);
  }

  if (signals?.georisques) {
    const r = signals.georisques;
    const riskNames = [];
    if (r.flood) riskNames.push("Overstroming");
    if (r.argile) riskNames.push("Klei/Krimp");
    if (r.industrial) riskNames.push("Industrieel");
    if (riskNames.length > 0) hints.push(`- GEMEENTE RISICO'S: ${riskNames.join(', ')}.`);
  }

  return `
    Je bent Immodiagnostique, vastgoedexpert.
    
    OPDRACHT 1: DATA EXTRACTIE
    Haal de volgende getallen uit de tekst (als ze er staan). Negeer valuta of eenheden, geef puur het getal (integer).
    - prijs (Vraagprijs)
    - oppervlakte (Woonoppervlakte in m2)
    - perceel (Terrein/Tuin in m2)

    OPDRACHT 2: ANALYSE
    - Locatieprofiel: Type plaats, afstand voorzieningen.
    - Verkoper: Particulier (PAP) of Makelaar?
    - SWOT: Sterke/Zwakke punten. Weeg risico's tegen ligging.

    Taal: NEDERLANDS.

    Input Data:
    ${hints.join('\n')}

    Input Advertentie:
    "${dossier}"

    Verwacht JSON Schema:
    {
      "extracted": {
         "price": 0,
         "surface": 0,
         "plot": 0
      },
      "locatie_profiel": "...",
      "swot": {
        "sterke_punten": ["..."],
        "mogelijke_zorgpunten": ["..."],
        "mogelijke_kansen": ["..."],
        "mogelijke_bedreigingen": ["..."]
      },
      "actieplan": ["..."],
      "communicatie": { "notaris": [], "makelaar": [], "verkoper": [] }
    }
  `;
}

function parseStrictJson(text) {
  const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
  try { return JSON.parse(clean); } catch (e) { return null; }
}

function parseAiTextHeuristic(text) {
  return {
    extracted: { price: 0, surface: 0, plot: 0 },
    locatie_profiel: "Geen profiel.",
    swot: { sterke_punten: ["Zie ruwe tekst."] },
    actieplan: [],
    communicatie: {}
  };
}

function sanitizeAndEnrich(obj, signals) {
  const out = {
    extracted: {
        price: Number(obj?.extracted?.price) || 0,
        surface: Number(obj?.extracted?.surface) || 0,
        plot: Number(obj?.extracted?.plot) || 0
    },
    locatie_profiel: obj?.locatie_profiel || "Geen profiel.",
    swot: {
      sterke_punten: Array.isArray(obj?.swot?.sterke_punten) ? obj.swot.sterke_punten : [],
      mogelijke_zorgpunten: Array.isArray(obj?.swot?.mogelijke_zorgpunten) ? obj.swot.mogelijke_zorgpunten : [],
      mogelijke_kansen: Array.isArray(obj?.swot?.mogelijke_kansen) ? obj.swot.mogelijke_kansen : [],
      mogelijke_bedreigingen: Array.isArray(obj?.swot?.mogelijke_bedreigingen) ? obj.swot.mogelijke_bedreigingen : []
    },
    actieplan: Array.isArray(obj?.actieplan) ? obj.actieplan : [],
    communicatie: {
      notaris: obj?.communicatie?.notaris || [],
      makelaar: obj?.communicatie?.makelaar || [],
      verkoper: obj?.communicatie?.verkoper || []
    }
  };
  
  // Slice lists
  const clamp = (arr) => arr.slice(0, 6);
  out.swot.sterke_punten = clamp(out.swot.sterke_punten);
  out.swot.mogelijke_zorgpunten = clamp(out.swot.mogelijke_zorgpunten);
  out.swot.mogelijke_kansen = clamp(out.swot.mogelijke_kansen);
  out.swot.mogelijke_bedreigingen = clamp(out.swot.mogelijke_bedreigingen);
  out.actieplan = clamp(out.actieplan);

  return out;
}
