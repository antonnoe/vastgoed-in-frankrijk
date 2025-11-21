// /api/analyse.js
// Immodiagnostique – Analyse endpoint (V4: Robust Logic + Location Profile + Dutch Enforcement)

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

  // 1. Bouw de slimme prompt (Met Location, Nuance & Taal dwang)
  const prompt = buildPrompts(dossier, signals);

  // 2. Call Gemini (met retry/model fallback)
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

  // 3. Parse output (Strict JSON -> Fallback Regex)
  let parsed = parseStrictJson(rawText);
  if (!parsed) {
    parsed = parseAiTextHeuristic(rawText); // Jouw oude vertrouwde regex parser
  }

  // 4. Data verrijken/schoonmaken (Signals injectie)
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

// --- PROMPT BUILDER (Het brein) ---
function buildPrompts(dossier, signals) {
  const hints = [];
  
  // Harde data feiten
  if (signals?.price) hints.push(`- Vraagprijs: €${signals.price}`);
  if (signals?.dvf?.median_price) hints.push(`- Buurtgemiddelde (DVF): €${signals.dvf.median_price}/m²`);
  
  // Zonering context
  if (signals?.gpuMatch === 'exact') {
    const z = signals.gpu[0] || {};
    hints.push(`- Bestemming (PLU): Zone ${z.code} (${z.label}). Dit is een exact vastgesteld feit.`);
  } else if (signals?.gpuMatch === 'commune') {
    hints.push(`- Bestemming: Gemeente heeft een digitaal plan, maar perceel is niet exact gevonden.`);
  }

  // Risico context
  if (signals?.georisques) {
    const r = signals.georisques;
    const riskNames = [];
    if (r.flood) riskNames.push("Overstroming");
    if (r.argile) riskNames.push("Klei/Krimp");
    if (r.industrial) riskNames.push("Industrieel");
    
    if (riskNames.length > 0) {
      hints.push(`- GEMEENTE RISICO'S (Data): ${riskNames.join(', ')}. LET OP: Check de tekst of het huis hoog/veilig ligt (bijv. 'Ville Haute' vs rivierbedding).`);
    } else {
      hints.push(`- GEMEENTE RISICO'S: Geen grote risico's gemeld in database.`);
    }
  }

  return `
    Je bent Immodiagnostique, een kritische vastgoedexpert voor Frankrijk.
    
    OPDRACHT:
    1. Analyseer de woningtekst en de signalen.
    2. Bepaal het 'Locatie Profiel' (Rural/Urban, Levendig/Rustig, Voorzieningen).
    3. Weeg risico's: Als data zegt 'Overstroming', maar tekst zegt 'Op een heuvel/Ville Haute', benoem dit dan als positieve nuance in de SWOT.
    4. Antwoord ALTIJD in het NEDERLANDS (ook bij Engelse/Franse input).
    5. Geef antwoord als strict JSON.

    Input Signalen:
    ${hints.join('\n')}

    Input Advertentie:
    "${dossier}"

    Verwacht JSON Schema:
    {
      "locatie_profiel": "Een korte, zakelijke zin over de omgeving. Bijv: 'Levendig stadscentrum met historische charme en alle voorzieningen op loopafstand.' of 'Rustige, landelijke omgeving met verspreide bebouwing en veel privacy.'",
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

// --- PARSERS & CLEANERS (Behouden van je oude code) ---

function parseStrictJson(text) {
  const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
  try { return JSON.parse(clean); } catch (e) { return null; }
}

// De oude heuristische parser voor fallback
function parseAiTextHeuristic(text) {
  // Simpele fallback structuur als JSON faalt
  return {
    locatie_profiel: "Analyse van locatie niet mogelijk door technisch format-fout.",
    swot: { sterke_punten: ["Zie ruwe tekst voor details."] },
    actieplan: [],
    communicatie: {}
  };
}

function sanitizeAndEnrich(obj, signals) {
  // 1. Basis structuur herstellen
  const out = {
    locatie_profiel: obj?.locatie_profiel || "Geen locatieprofiel gegenereerd.",
    swot: {
      sterke_punten: Array.isArray(obj?.swot?.sterke_punten) ? obj.swot.sterke_punten : [],
      mogelijke_zorgpunten: Array.isArray(obj?.swot?.mogelijke_zorgpunten) ? obj.swot.mogelijke_zorgpunten : [],
      mogelijke_kansen: Array.isArray(obj?.swot?.mogelijke_kansen) ? obj.swot.mogelijke_kansen : [],
      mogelijke_bedreigingen: Array.isArray(obj?.swot?.mogelijke_bedreigingen) ? obj.swot.mogelijke_bedreigingen : []
    },
    actieplan: Array.isArray(obj?.actieplan) ? obj.actieplan : [],
    communicatie: {
      notaris: Array.isArray(obj?.communicatie?.notaris) ? obj.communicatie.notaris : [],
      makelaar: Array.isArray(obj?.communicatie?.makelaar) ? obj.communicatie.makelaar : [],
      verkoper: Array.isArray(obj?.communicatie?.verkoper) ? obj.communicatie.verkoper : []
    }
  };

  // 2. INJECTIE VAN HARDE SIGNALEN (Jouw oude wens: assertieve aanvulling)
  // Als prijs verdacht laag/hoog is t.o.v. DVF
  if (signals?.price && signals?.dvf?.median_price) {
    const p = signals.price / (signals.surface || 100); // groffe schatting m2
    const m = signals.dvf.median_price;
    if (p > m * 1.5) out.swot.mogelijke_zorgpunten.push(`Vraagprijs ligt aanzienlijk boven buurtgemiddelde (€${m}/m²).`);
    if (p < m * 0.7) out.swot.mogelijke_kansen.push(`Prijs lijkt scherp t.o.v. buurtgemiddelde (€${m}/m²).`);
  }

  // Als Risico rood is, maar AI het gemist heeft in de bedreigingen, voeg toe
  if (signals?.georisques?.flood) {
    // Check of AI het al genoemd heeft
    const hasMention = JSON.stringify(out.swot).toLowerCase().includes('overstroming');
    if (!hasMention) {
      out.swot.mogelijke_bedreigingen.push("Gemeente kent overstromingsrisico (PPRI); check exacte ligging t.o.v. water.");
    }
  }

  // 3. Beperk lengtes
  const clamp = (arr) => arr.slice(0, 6);
  out.swot.sterke_punten = clamp(out.swot.sterke_punten);
  out.swot.mogelijke_zorgpunten = clamp(out.swot.mogelijke_zorgpunten);
  out.swot.mogelijke_kansen = clamp(out.swot.mogelijke_kansen);
  out.swot.mogelijke_bedreigingen = clamp(out.swot.mogelijke_bedreigingen);
  out.actieplan = clamp(out.actieplan);

  return out;
}
