// /api/analyse.js
// V8: The Hybrid - Expert Valuation + Robust Error Handling + Auto-Extraction

export default async function handler(req, res) {
  // 1. Veiligheidschecks
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  const { dossier, signals } = (req.body || {});
  if ((!dossier || !dossier.trim()) && (!signals)) {
    return res.status(400).json({ ok: false, error: "Geen input data." });
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return res.status(500).json({ ok: false, error: "API Key missing" });

  // 2. Bouw de slimme prompt (Nu met DVF data!)
  const prompt = buildExpertPrompt(dossier, signals);
  
  // 3. Call Gemini (Met retry strategie uit V6)
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

  // 4. Parsing & Schoonmaak (De "Veiligheid" uit V6)
  let parsed = parseStrictJson(rawText);
  if (!parsed) {
    console.warn("JSON parse mislukt, gebruik heuristiek");
    parsed = parseAiTextHeuristic(rawText);
  }

  const finalData = sanitizeAndEnrich(parsed, signals);

  return res.status(200).json({ ok: true, model: modelUsed, output: finalData });
}

// --- HELPER: Gemini Caller ---
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

// --- HELPER: Prompt Builder (Het Brein) ---
function buildExpertPrompt(dossier, signals) {
  // 1. Format DVF Comparables (Nieuw in V7/V8)
  let dvfContext = "Geen vergelijkbare verkopen gevonden in de database.";
  if (signals?.dvf?.comparables && signals.dvf.comparables.length > 0) {
    const list = signals.dvf.comparables.slice(0, 5).map(c => 
      `- Verkocht op ${c.date}: ${c.surface}m² voor €${c.price} (€${c.m2_price}/m²)`
    ).join('\n');
    dvfContext = `REFERENTIE PANDEN (Gemeente/Buurt):\n${list}`;
  }

  // 2. Risico's & Bestemming
  const hints = [];
  if (signals?.price) hints.push(`- Vraagprijs Huidig: €${signals.price}`);
  if (signals?.dvf?.median_price) hints.push(`- Mediaanprijs Gemeente: €${signals.dvf.median_price}/m²`);
  
  if (signals?.georisques) {
    const r = signals.georisques;
    const risks = [];
    if (r.flood) risks.push("Overstroming");
    if (r.argile) risks.push("Klei/Krimp");
    if (risks.length) hints.push(`- RISICO'S (Data): ${risks.join(', ')}. (Check tekst of dit relevant is voor ligging)`);
  }

  if (signals?.gpuMatch === 'exact') {
    const z = signals.gpu[0] || {};
    hints.push(`- Bestemming (PLU): Zone ${z.code} (${z.label}).`);
  }

  return `
    Je bent Immodiagnostique, een Elite Vastgoed Taxateur in Frankrijk.
    
    CONTEXT DATA:
    ${hints.join('\n')}
    
    ${dvfContext}

    ADVERTENTIE:
    "${dossier}"

    OPDRACHT:
    1. DATA: Haal prijs, oppervlakte en perceel uit de tekst (indien aanwezig).
    2. LOCATIE: Beschrijf de omgeving (sfeer, voorzieningen, type gemeente).
    3. ANALYSE: SWOT analyse.
    4. WAARDERING (valuation_report): Schrijf een expert-alinea. Vergelijk de vraagprijs met de Referentie Panden hierboven. Is het marktconform? Wat zijn de plussen/minnen?

    Taal: NEDERLANDS.

    Output JSON Schema:
    {
      "extracted": { "price": 0, "surface": 0, "plot": 0 },
      "locatie_profiel": "...",
      "swot": {
        "sterke_punten": ["..."],
        "mogelijke_zorgpunten": ["..."],
        "mogelijke_kansen": ["..."],
        "mogelijke_bedreigingen": ["..."]
      },
      "valuation_report": "Expert tekst hier...",
      "actieplan": ["..."],
      "communicatie": { "notaris": [], "makelaar": [], "verkoper": [] }
    }
  `;
}

// --- HELPER: Parsers & Cleaners (De Veiligheid uit V6) ---

function parseStrictJson(text) {
  const clean = text.replace(/```json|```/g, '').trim();
  try { return JSON.parse(clean); } catch (e) { return null; }
}

function parseAiTextHeuristic(text) {
  // Noodoplossing: als JSON faalt, geef iets terug zodat de UI niet hangt
  return {
    extracted: { price: 0, surface: 0, plot: 0 },
    locatie_profiel: "Kon profiel niet genereren.",
    swot: { sterke_punten: ["Analyse tekstueel geslaagd, maar technisch format fout. Zie ruwe output."] },
    valuation_report: "Geen waardering beschikbaar.",
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
    valuation_report: obj?.valuation_report || "",
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

  // Beperk lijsten
  const clamp = (arr) => Array.isArray(arr) ? arr.slice(0, 6) : [];
  out.swot.sterke_punten = clamp(out.swot.sterke_punten);
  out.swot.mogelijke_zorgpunten = clamp(out.swot.mogelijke_zorgpunten);
  out.swot.mogelijke_kansen = clamp(out.swot.mogelijke_kansen);
  out.swot.mogelijke_bedreigingen = clamp(out.swot.mogelijke_bedreigingen);
  out.actieplan = clamp(out.actieplan);

  return out;
}
