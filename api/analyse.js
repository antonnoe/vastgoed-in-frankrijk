// /api/analyse.js
// V11: THE MASTER FILE (Robust Parsing + Deep Nuance + Auto-Extraction + Fallbacks)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  const { dossier, signals } = (req.body || {});
  
  // Minimale input check
  if ((!dossier || !dossier.trim()) && (!signals)) {
    return res.status(400).json({ ok: false, error: "Geen input data." });
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return res.status(500).json({ ok: false, error: "API Key missing" });

  // 1. Bouw de slimme, genuanceerde prompt
  const prompt = buildMasterPrompt(dossier, signals);

  // 2. Call Gemini (met retry)
  const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
  let rawText = null;
  let modelUsed = '';

  for (const model of models) {
    try {
      rawText = await callGemini(GEMINI_API_KEY, model, prompt);
      if (rawText) { modelUsed = model; break; }
    } catch (e) { console.error(`Model ${model} failed:`, e.message); }
  }

  if (!rawText) return res.status(502).json({ ok: false, error: "AI analyse mislukt." });

  // 3. ROBUUSTE PARSING (De reparatie)
  let parsed = null;
  try {
     // Probeer de JSON er chirurgisch uit te snijden
     const jsonStart = rawText.indexOf('{');
     const jsonEnd = rawText.lastIndexOf('}');
     if (jsonStart !== -1 && jsonEnd !== -1) {
         const cleanJson = rawText.substring(jsonStart, jsonEnd + 1);
         parsed = JSON.parse(cleanJson);
     } else {
         throw new Error("Geen JSON haakjes");
     }
  } catch(e) {
     console.warn("JSON Parse mislukt, start Regex Fallback engine...", e.message);
     // Als JSON faalt, gebruiken we de "domme" regex parser om toch iets te redden
     parsed = parseAiTextHeuristic(rawText);
  }

  // 4. Schoonmaak & Verrijking
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
function buildMasterPrompt(dossier, signals) {
  // Data Context opbouwen
  const hints = [];
  if (signals?.price) hints.push(`- Vraagprijs (Input): €${signals.price}`);
  if (signals?.dvf?.median_price) hints.push(`- DVF Mediaan (Gemeente): €${signals.dvf.median_price}/m²`);
  
  // Risico Context (Met nuance instructie)
  let riskContext = "Geen grote risico's gemeld.";
  if (signals?.georisques) {
    const r = signals.georisques;
    const risks = [];
    if (r.flood) risks.push("Overstroming (Inondation)");
    if (r.argile) risks.push("Klei/Krimp");
    if (r.industrial) risks.push("Industrieel");
    if (risks.length) riskContext = `GEMEENTE RISICO'S: ${risks.join(', ')}.`;
  }

  // DVF Comparables
  let dvfText = "";
  if (signals?.dvf?.comparables?.length) {
      dvfText = "REFERENTIE PANDEN:\n" + signals.dvf.comparables.slice(0,4).map(c => 
          `- ${c.surface}m² voor €${c.price} (€${c.m2_price}/m²)`
      ).join('\n');
  }

  return `
    Je bent Immodiagnostique, een kritische en ervaren vastgoedexpert voor Frankrijk.
    
    DATA CONTEXT:
    ${hints.join('\n')}
    ${riskContext}
    ${dvfText}

    ADVERTENTIE TEKST:
    "${dossier}"

    JOUW OPDRACHT:
    1. DATA EXTRACTIE: Haal Vraagprijs, Oppervlakte en Perceel uit de tekst. (Als getal).
    2. LOCATIE PROFIEL: Beschrijf type omgeving, sfeer, voorzieningen en afstand tot hotspots (kust/stad).
    3. RISICO NUANCE: 
       - De Data hierboven zegt '${riskContext}'. DIT GELDT VOOR DE HELE GEMEENTE.
       - Check de tekst: Ligt het huis 'hoog', 'op een heuvel', 'Ville Haute'? -> Zet in SWOT als STERK PUNT (veilig).
       - Ligt het huis 'aan de rivier', 'in de vallei'? -> Zet in SWOT als BEDREIGING.
    4. WAARDERING: Vergelijk vraagprijs met de referentie panden en geef een oordeel.

    Taal: NEDERLANDS.

    Output JSON formaat (strikt):
    {
      "extracted": { "price": 0, "surface": 0, "plot": 0 },
      "locatie_profiel": "...",
      "swot": {
        "sterke_punten": ["..."],
        "mogelijke_zorgpunten": ["..."],
        "mogelijke_kansen": ["..."],
        "mogelijke_bedreigingen": ["..."]
      },
      "valuation_report": "...",
      "actieplan": ["..."],
      "communicatie": { "notaris": [], "makelaar": [], "verkoper": [] }
    }
  `;
}

// --- HELPER: Regex Fallback Parser (Voor als JSON faalt) ---
function parseAiTextHeuristic(text) {
  // Probeert met regex toch nog iets uit de tekst te vissen
  const extractList = (key) => {
    const regex = new RegExp(`${key}[:\\s]*([\\s\\S]*?)(?=\\n[A-Z]|$)`, 'i');
    const match = text.match(regex);
    if (!match) return [];
    return match[1].split('\n').map(s => s.replace(/^[-*•]\s*/, '').trim()).filter(Boolean).slice(0,5);
  };

  return {
    extracted: { price: 0, surface: 0, plot: 0 },
    locatie_profiel: "Kon profiel niet genereren (Fallback mode).",
    swot: { 
        sterke_punten: extractList("Sterke punten") || ["Zie ruwe tekst"],
        mogelijke_zorgpunten: extractList("Zorgpunten") || [],
        mogelijke_kansen: [],
        mogelijke_bedreigingen: []
    },
    valuation_report: "Geen waardering beschikbaar in fallback mode.",
    actieplan: extractList("Actieplan"),
    communicatie: {}
  };
}

function sanitizeAndEnrich(obj, signals) {
  // Zorg voor veilige structuur
  const out = {
    extracted: {
        price: Number(obj?.extracted?.price) || 0,
        surface: Number(obj?.extracted?.surface) || 0,
        plot: Number(obj?.extracted?.plot) || 0
    },
    locatie_profiel: obj?.locatie_profiel || "Geen profiel beschikbaar.",
    valuation_report: obj?.valuation_report || "Geen waardering beschikbaar.",
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

  // Beperk lengtes voor UI
  const clamp = (arr) => Array.isArray(arr) ? arr.slice(0, 6) : [];
  out.swot.sterke_punten = clamp(out.swot.sterke_punten);
  out.swot.mogelijke_zorgpunten = clamp(out.swot.mogelijke_zorgpunten);
  out.swot.mogelijke_kansen = clamp(out.swot.mogelijke_kansen);
  out.swot.mogelijke_bedreigingen = clamp(out.swot.mogelijke_bedreigingen);
  
  return out;
}
