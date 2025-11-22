// /api/analyse.js
// V9: Nuanced Risk + Expert Valuation

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const { dossier, signals } = req.body || {};
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  const prompt = buildPrompt(dossier, signals);

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    let output = null;
    try {
       output = JSON.parse(rawText.replace(/```json|```/g, '').trim());
    } catch(e) {
       output = parseHeuristic(rawText);
    }
    return res.status(200).json({ ok: true, output: sanitize(output, signals) });
  } catch (e) { return res.status(500).json({ ok: false }); }
}

function buildPrompt(dossier, signals) {
  // Format Risico's voor de AI
  let riskContext = "Geen data";
  if (signals?.georisques) {
    const r = signals.georisques;
    const list = [];
    if(r.flood) list.push("OVERSTROMING (Inondation)");
    if(r.argile) list.push("KLEI/KRIMP");
    riskContext = list.length ? `RISICO DATA (GEMEENTE): ${list.join(', ')}` : "Geen grote risico's.";
  }

  return `
    Je bent Immodiagnostique, expert Frans vastgoed.
    
    DATA CONTEXT:
    - ${riskContext}
    - ${signals?.gpuMatch === 'exact' ? 'Exact perceel gevonden.' : 'Alleen gemeentedata beschikbaar.'}

    ADVERTENTIE:
    "${dossier}"

    CRUCIALE OPDRACHT (NATTE VOETEN):
    De Risico Data geldt voor de hele gemeente. Jij moet nuanceren op basis van de tekst:
    - Als data zegt 'Overstroming', maar tekst zegt 'Ville Haute', 'Sommet', 'Plateau', 'Citadelle':
      -> ZET IN SWOT (Sterk Punt): "Hoog gelegen (Ville Haute/Heuvel), beperkt risico ondanks gemeente-code."
    - Als tekst zegt 'Rivière', 'Berge', 'Vallée', 'Moulin':
      -> ZET IN SWOT (Bedreiging): "Direct risico door ligging nabij water/in vallei."

    Output JSON (NEDERLANDS):
    {
      "locatie_profiel": "Korte, sfeervolle beschrijving van locatie en voorzieningen.",
      "swot": { "sterke_punten": [], "mogelijke_zorgpunten": [], "mogelijke_kansen": [], "mogelijke_bedreigingen": [] },
      "valuation_report": "Expert oordeel over de prijs.",
      "actieplan": [],
      "extracted": { "price": 0, "surface": 0, "plot": 0 }
    }
  `;
}

// (Helpers parseHeuristic en sanitize zoals in V8 hierboven behouden)
function parseHeuristic(t) { return { locatie_profiel: "Geen profiel", swot: { sterke_punten: ["Zie tekst"] }, actieplan: [], valuation_report: "", extracted: {} }; }
function sanitize(o, s) { return o; } // Verkorte weergave, in echte file gebruik je de sanitize uit V8
