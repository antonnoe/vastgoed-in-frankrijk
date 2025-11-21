// /api/analyse.js
// Immodiagnostique – Analyse endpoint (V2: Force Dutch Language)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: "Method Not Allowed" });
    return;
  }

  const { dossier, signals } = (req.body || {});
  
  // Toestaan dat dossier leeg is als er wel signals zijn, maar liever niet
  if ((!dossier || !dossier.trim()) && (!signals)) {
    res.status(400).json({ ok: false, error: "Geen input data." });
    return;
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    res.status(500).json({ ok: false, error: "Server config error: API Key missing" });
    return;
  }

  // Modellen
  const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
  
  // Bouw de prompt met harde taal-eis
  const prompt = buildStrictJsonPrompt(dossier, signals);

  let output = null;
  let modelUsed = '';

  // Probeer modellen
  for (const model of models) {
    try {
      const txt = await callGemini(GEMINI_API_KEY, model, prompt);
      if (txt) {
        output = txt;
        modelUsed = model;
        break;
      }
    } catch (e) {
      console.error(`Model ${model} failed:`, e.message);
      // continue to next model
    }
  }

  if (!output) {
    return res.status(502).json({ ok: false, error: "AI analyse mislukt bij alle modellen." });
  }

  // Parse en clean
  let parsed = parseStrictJson(output);
  if (!parsed) {
    // Fallback parser als JSON stuk is
    parsed = parseAiTextFallback(output);
  }

  // Data opschonen
  const finalData = sanitizeParsed(parsed, signals);

  res.status(200).json({
    ok: true,
    model: modelUsed,
    output: finalData
  });
}

// --- Gemini Caller ---

async function callGemini(key, model, text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }]
    })
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// --- Prompt Builder (MET TAAL DWANG) ---

function buildStrictJsonPrompt(dossier, signals) {
  const hints = [];
  if (signals) {
    if (signals.price) hints.push(`- Vraagprijs: EUR ${signals.price}`);
    if (signals.dvf?.median_price) hints.push(`- DVF Mediaanprijs in buurt: EUR ${signals.dvf.median_price}/m2`);
    if (signals.georisques) {
       // Zet georisques om naar tekst
       const risks = [];
       if (signals.georisques.flood) risks.push('Overstromingsrisico');
       if (signals.georisques.argile) risks.push('Klei/Krimp risico');
       if (signals.georisques.industrial) risks.push('Industrieel risico');
       if (risks.length > 0) hints.push(`- Bekende risico's (Géorisques): ${risks.join(', ')}`);
       else hints.push(`- Géorisques: Geen grote risico's gemeld.`);
    }
  }

  return `
    Jij bent een strenge vastgoed-expert voor de Franse markt.
    
    Jouw taak: Analyseer de onderstaande tekst (die in het Frans, Engels of Nederlands kan zijn) en extraheer de risico's en kansen.
    
    BELANGRIJK:
    1. Je antwoord moet ALTIJD in het NEDERLANDS zijn.
    2. Je antwoord moet STRICTE JSON zijn volgens onderstaand schema.
    3. Geen markdown blocks (geen \`\`\`json). Alleen de raw JSON string.

    Input Dossier:
    "${dossier}"

    Context Signalen:
    ${hints.join('\n')}

    Verwacht JSON Schema:
    {
      "swot": {
        "sterke_punten": ["punt 1", "punt 2"],
        "mogelijke_zorgpunten": ["punt 1", "punt 2"],
        "mogelijke_kansen": ["punt 1", "punt 2"],
        "mogelijke_bedreigingen": ["punt 1", "punt 2"]
      },
      "actieplan": ["actie 1", "actie 2"],
      "communicatie": {
        "notaris": ["vraag 1"],
        "makelaar": ["vraag 1"],
        "verkoper": ["vraag 1"]
      }
    }
  `;
}

// --- Parsers ---

function parseStrictJson(text) {
  // Probeer markdown code blocks weg te strippen
  let clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    return null;
  }
}

function parseAiTextFallback(text) {
  // Noodoplossing: als JSON faalt, geef lege structuur terug zodat de frontend niet crasht
  // In een productie-omgeving zou je hier regexes gebruiken om tekst te schrapen.
  return {
    swot: { sterke_punten: ["Analyse technisch mislukt (JSON error)"] },
    actieplan: [],
    communicatie: {}
  };
}

function sanitizeParsed(obj, signals) {
  // Zorg dat alle velden bestaan (defensive programming)
  const out = {
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

  // Voeg standaard actiepunten toe als de lijst kort is
  if (out.actieplan.length < 3) {
    out.actieplan.push("Vraag de laatste 3 jaarvergaderingen van de VvE op (indien appartement).");
    out.actieplan.push("Controleer de eigendomsgrenzen in het kadaster.");
  }

  // Zorg dat lijsten niet te lang zijn (max 5 items)
  for (const k in out.swot) out.swot[k] = out.swot[k].slice(0, 6);
  out.actieplan = out.actieplan.slice(0, 6);

  return out;
}
