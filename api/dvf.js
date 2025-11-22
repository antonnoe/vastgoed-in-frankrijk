// /api/analyse.js
// V7: Expert Valuation Mode

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const { dossier, signals } = req.body || {};
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  // Prompt bouwen
  const prompt = buildExpertPrompt(dossier, signals);

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Parse JSON
    let output = null;
    try {
       output = JSON.parse(rawText.replace(/```json|```/g, '').trim());
    } catch(e) {
       // Fallback als JSON faalt
       output = { 
         locatie_profiel: "Analyse technisch niet leesbaar.", 
         swot: { sterke_punten: ["Zie ruwe tekst"] },
         valuation_report: "Kon geen waardering genereren."
       };
    }

    return res.status(200).json({ ok: true, output });

  } catch (e) {
    return res.status(500).json({ ok: false });
  }
}

function buildExpertPrompt(dossier, signals) {
  // Format DVF data voor de AI
  let dvfContext = "Geen DVF transacties gevonden in de directe omgeving.";
  if (signals?.dvf?.comparables && signals.dvf.comparables.length > 0) {
    const list = signals.dvf.comparables.map(c => 
      `- ${c.date}: ${c.surface}m² voor €${c.price} (€${c.m2_price}/m²)`
    ).join('\n');
    dvfContext = `Recente verkopen in de gemeente (Referentie):\n${list}`;
  }

  const priceInfo = signals?.price ? `Vraagprijs Huidige Woning: €${signals.price}` : "Vraagprijs onbekend";

  return `
    Je bent een Elite Vastgoed Taxateur in Frankrijk.
    
    INPUT DATA:
    ${priceInfo}
    ${dvfContext}
    
    ADVERTENTIE TEKST:
    "${dossier}"

    OPDRACHT:
    Genereer een JSON object met een diepgaande analyse. 
    
    1. LOCATIE & SFEER: Een wervende maar eerlijke beschrijving van de locatie.
    2. SWOT: De klassieke analyse (max 5 punten per categorie).
    3. WAARDERINGSRAPPORT (valuation_report): 
       Schrijf een tekstuele analyse zoals een expert dat doet.
       - Vergelijk de vraagprijs/m2 met de referentie verkopen.
       - Pas correcties toe (bijv: "Duurder dan gemiddeld, maar gerechtvaardigd door recente renovatie/warmtepomp" of "Te duur gezien energielabel G").
       - Geef een conclusie: "Marktconform", "Aan de hoge kant", of "Scherp geprijsd".
       - Geef advies voor het openingsbod.

    Taal: NEDERLANDS.

    Verwacht JSON formaat:
    {
      "locatie_profiel": "...",
      "swot": {
        "sterke_punten": [],
        "mogelijke_zorgpunten": [],
        "mogelijke_kansen": [],
        "mogelijke_bedreigingen": []
      },
      "valuation_report": "Hier jouw expert tekst (gebruik enters/newlines voor leesbaarheid)...",
      "actieplan": [],
      "extracted": { "price": 0, "surface": 0, "plot": 0 } 
    }
  `;
}
