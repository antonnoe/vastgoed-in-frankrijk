// /api/analyse.js
// Immodiagnostique – Analyse endpoint (POST { dossier, signals? })
//
// - Gebruikt Google Gemini via REST (geen SDK).
// - Default model: gemini-2.0-flash; fallbacks: gemini-2.0-flash (retry) → gemini-1.5-flash-latest.
// - JSON body: {contents:[{parts:[{text:"..."}]}]}.
// - Rate limits: 1 req/sec, max 8 req/min (dit endpoint doet 1 call per verzoek).
// - Bij 429: backoff 2s, daarna 4s.
// - Verwerkt 'signals' (prijs, DVF, Géorisques, advertentie.towns/near_water/truncated, etc.).
// - Nooit API key naar de client lekken.
//
// Verwacht output:
// {
//   ok: true,
//   model: "gemini-2.0-flash",
//   throttleNotice: null | "429 throttled/backoff ...",
//   output: {
//     swot: { sterke_punten:[], mogelijke_zorgpunten:[], mogelijke_kansen:[], mogelijke_bedreigingen:[] },
//     actieplan: [],
//     communicatie: { verkoper:[], notaris:[], makelaar:[] },
//     red_flags: [], actions: [], questions: [],
//     disclaimer: "…",
//     raw_text: "…"
//   },
//   meta: { received_chars: N, signals_present: true/false, timestamp: ISO }
// }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: "Method Not Allowed. Use POST { dossier }." });
    return;
  }

  const { dossier, signals } = (req.body || {});
  if (!dossier || typeof dossier !== 'string' || !dossier.trim()) {
    res.status(400).json({ ok: false, error: "Bad Request: veld 'dossier' is verplicht en mag niet leeg zijn." });
    return;
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    res.status(500).json({ ok: false, error: "Server-misconfiguratie: GEMINI_API_KEY ontbreekt." });
    return;
  }

  const models = [
    'gemini-2.0-flash',           // default
    'gemini-2.0-flash',           // retry zelfde model (handig bij incidentele NOT_FOUND/rollout)
    'gemini-1.5-flash-latest'     // fallback
  ];

  const prompt = buildPrompt(dossier, signals);

  // --- 1) Call Gemini met backoff & fallbacks ---
  let modelUsed = null;
  let throttleNotice = null;
  let aiText = null;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      const { text, throttle } = await callGeminiOnce({
        apiKey: GEMINI_API_KEY,
        model,
        text: prompt
      });
      aiText = text;
      modelUsed = model;
      if (throttle) throttleNotice = throttle;
      break;
    } catch (err) {
      // 404 / NOT_FOUND => probeer volgende model
      if (err.status === 404 || /NOT_FOUND/.test(String(err.message || ''))) {
        // Ga door naar volgende model
        continue;
      }
      // 429 => backoff 2s, nogmaals; daarna 4s
      if (err.status === 429) {
        if (!throttleNotice) throttleNotice = '429 throttled – backoff toegepast';
        await sleep(2000);
        try {
          const { text, throttle } = await callGeminiOnce({
            apiKey: GEMINI_API_KEY,
            model,
            text: prompt
          });
          aiText = text;
          modelUsed = model;
          if (throttle) throttleNotice = throttle;
          break;
        } catch (e2) {
          if (e2.status === 429) {
            await sleep(4000);
            const { text, throttle } = await callGeminiOnce({
              apiKey: GEMINI_API_KEY,
              model,
              text: prompt
            });
            aiText = text;
            modelUsed = model;
            if (throttle) throttleNotice = throttle;
            break;
          }
          // Anders: probeer volgend model
          continue;
        }
      }
      // Andere fout => probeer volgend model
      continue;
    }
  }

  // --- 2) Parse AI, bouw fallback SWOT & overige secties ---
  const parsed = parseAiText(aiText);
  const swot = ensureSwotWithFallback(parsed.swot, signals);
  const actieplan = ensureActieplan(parsed.actieplan, signals);
  const communicatie = ensureCommunicatie(parsed.communicatie, signals);

  const out = {
    swot,
    actieplan,
    communicatie,
    red_flags: parsed.red_flags || [],
    actions: parsed.actions || [],
    questions: parsed.questions || [],
    disclaimer: parsed.disclaimer || defaultDisclaimer(),
    raw_text: aiText || defaultRawText(dossier, signals)
  };

  res.status(200).json({
    ok: true,
    model: modelUsed || models[0],
    throttleNotice: throttleNotice || null,
    output: out,
    meta: {
      received_chars: dossier.length,
      signals_present: !!signals,
      timestamp: new Date().toISOString()
    }
  });
}

// ---------------- Helpers ----------------

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function callGeminiOnce({ apiKey, model, text }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [{ parts: [{ text }] }]
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  });

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const msg = isJson ? (data?.error?.message || JSON.stringify(data)) : String(data);
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }

  let textOut = '';
  try {
    // v1beta: candidates[0].content.parts[0].text
    const cand = data?.candidates?.[0];
    const parts = cand?.content?.parts || [];
    textOut = parts.map(p => p.text).filter(Boolean).join('\n').trim();
  } catch {
    textOut = '';
  }
  return { text: textOut, throttle: res.status === 429 ? '429 throttled' : null };
}

// Prompt stuurt richting SWOT + actieplan + communicatie
function buildPrompt(dossier, signals) {
  const hints = [];
  if (signals) {
    if (typeof signals.price === 'number') hints.push(`- Vraagprijs: EUR ${signals.price}`);
    if (signals.dvf?.median_price != null) hints.push(`- DVF-mediaan: EUR ${signals.dvf.median_price}`);
    if (signals.georisques) {
      const keys = Object.keys(signals.georisques).filter(k => signals.georisques[k]);
      if (keys.length) hints.push(`- Géorisques (positief): ${keys.join(', ')}`);
      else hints.push(`- Géorisques: geen categorieën positief`);
    }
    if (signals.advertentie?.keywords?.length) {
      hints.push(`- Advertentie keywords: ${signals.advertentie.keywords.join(', ')}`);
    }
    if (signals.advertentie?.towns?.length) {
      hints.push(`- Advertentie noemt nabij: ${signals.advertentie.towns.join(', ')}`);
    }
    if (signals.advertentie?.near_water) hints.push(`- Heuristiek: ligging nabij water`);
    if (signals.advertentie?.truncated) hints.push(`- Waarschuwing: advertentietekst mogelijk onvolledig (Lees meer/Lire plus)`);
  }

  const sys = [
    'Je bent een kritische due-diligence assistent voor de Franse woningmarkt.',
    'Formaat-output in het Nederlands, met duidelijke bullets.',
    'Gebruik secties: SWOT (vier blokken), Actieplan (korte taken), Communicatie (verkoper/notaris/makelaar).',
    'Vermijd loze taal; wees concreet en kort.'
  ].join(' ');

  return [
    sys,
    '',
    'Dossiertekst:',
    dossier,
    '',
    'Contextsignalen (gestructureerd):',
    hints.join('\n'),
    '',
    'Gevraagde output (compact, NL):',
    '1) SWOT: Sterke punten; Mogelijke zorgpunten; Mogelijke kansen; Mogelijke bedreigingen.',
    '2) Actieplan: 5–8 puntsgewijze acties.',
    '3) Communicatie: 3 vragen voor verkoper, 3 voor notaris, 3 voor makelaar.',
    'Kort en feitelijk, zonder overdrijven.'
  ].join('\n');
}

function parseAiText(text) {
  if (!text || !text.trim()) {
    return {
      swot: { sterke_punten: [], mogelijke_zorgpunten: [], mogelijke_kansen: [], mogelijke_bedreigingen: [] },
      actieplan: [],
      communicatie: { verkoper: [], notaris: [], makelaar: [] },
      red_flags: [],
      actions: [],
      questions: [],
      disclaimer: ''
    };
  }

  // Simpele heuristiek: splits op kopjes
  const lower = text.toLowerCase();
  const sect = (key) => extractSection(text, key);

  return {
    swot: {
      sterke_punten: bullets(sect('sterke punten')),
      mogelijke_zorgpunten: bullets(sect('zorgpunten')) || bullets(sect('zwakten')) || bullets(sect('mogelijke zorgpunten')),
      mogelijke_kansen: bullets(sect('kansen')) || bullets(sect('opportuniteiten')),
      mogelijke_bedreigingen: bullets(sect('bedreigingen')) || bullets(sect('risico\'s'))
    },
    actieplan: bullets(sect('actieplan')),
    communicatie: {
      verkoper: bullets(sect('verkoper')),
      notaris: bullets(sect('notaris')),
      makelaar: bullets(sect('makelaar'))
    },
    red_flags: bullets(sect('rode vlaggen')),
    actions: bullets(sect('actions')),
    questions: bullets(sect('vragen')),
    disclaimer: findDisclaimer(text)
  };
}

function extractSection(text, title) {
  const rx = new RegExp(`\\b${escapeReg(title)}\\b[\\s\\S]*?(?=\\n\\s*\\b[A-Z][A-Za-zÀ-ÖØ-öø-ÿ ]{2,}\\b\\s*:|$)`, 'i');
  const m = text.match(rx);
  return m ? m[0] : '';
}
function bullets(block) {
  if (!block) return [];
  const lines = block.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const ln of lines) {
    const m = ln.match(/^[\-\*\u2022•]\s*(.+)$/);
    if (m) out.push('• ' + m[1].trim());
  }
  return out;
}
function findDisclaimer(text) {
  const m = text.match(/disclaimer[:\s-]+([\s\S]+)$/i);
  return m ? m[1].trim() : '';
}
function escapeReg(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function defaultDisclaimer() {
  return 'Deze analyse is indicatief en informatief. Raadpleeg notaris, makelaar en officiële bronnen (Géorisques, DVF, Géoportail-Urbanisme). Aan deze tool kunnen geen rechten worden ontleend.';
}
function defaultRawText(dossier, signals) {
  return `Vooronderzoek op basis van beperkte data.\n\nDossier:\n${dossier}\n\nSignals:\n${JSON.stringify(signals || {}, null, 2)}`;
}

// ---- Fallback/aanvulling vanuit signals (assertief) ----
function ensureSwotWithFallback(swot, signals) {
  const out = {
    sterke_punten: (swot?.sterke_punten || []).slice(0),
    mogelijke_zorgpunten: (swot?.mogelijke_zorgpunten || []).slice(0),
    mogelijke_kansen: (swot?.mogelijke_kansen || []).slice(0),
    mogelijke_bedreigingen: (swot?.mogelijke_bedreigingen || []).slice(0)
  };

  // DVF vs prijs
  const price = isNum(signals?.price) ? Number(signals.price) : null;
  const dvfMedian = isNum(signals?.dvf?.median_price) ? Number(signals.dvf.median_price) : null;
  if (price != null && dvfMedian != null) {
    if (price < dvfMedian) {
      pushUnique(out.sterke_punten, '• Prijs ligt onder DVF-mediaan (bron: DVF) [confidence: hoog]');
      pushUnique(out.mogelijke_kansen, '• Potentieel voor waardevermeerdering bij renovatie of optimalisatie [confidence: middel]');
    } else if (price > dvfMedian) {
      pushUnique(out.mogelijke_zorgpunten, '• Prijs ligt boven DVF-mediaan; onderbouwing noodzakelijk (bron: DVF) [confidence: middel]');
    }
  }

  // Géorisques flags
  const gr = signals?.georisques;
  if (gr) {
    const anyTrue = Object.values(gr).some(Boolean);
    if (!anyTrue) {
      pushUnique(out.sterke_punten, '• Geen directe omgevingsrisico’s geïdentificeerd (bron: Géorisques) [confidence: hoog]');
    } else {
      // indien specifieke risico’s true zijn, voeg bedreiging toe
      const trueKeys = Object.keys(gr).filter(k => gr[k]);
      if (trueKeys.length) {
        pushUnique(out.mogelijke_bedreigingen, `• Omgevingsrisico’s aanwezig: ${trueKeys.join(', ')} (bron: Géorisques) [confidence: hoog]`);
      }
    }
  }

  // Advertentie-heuristiek
  const adv = signals?.advertentie || {};
  if (Array.isArray(adv.towns) && adv.towns.length) {
    pushUnique(out.mogelijke_zorgpunten, `• Advertentie noemt nabijgelegen plaatsen: ${adv.towns.join(', ')} – mogelijke locatie-afwijking [confidence: middel]`);
  }
  if (adv.near_water) {
    pushUnique(out.mogelijke_zorgpunten, '• Ligging nabij water → verhoogde ERP/PLU-aandacht vereist (bron: advertentie) [confidence: hoog]');
    pushUnique(out.mogelijke_bedreigingen, '• Potentieel overstromingsrisico (inondation/submersion) [confidence: middel]');
  }
  if (adv.truncated) {
    pushUnique(out.mogelijke_zorgpunten, '• Advertentietekst mogelijk onvolledig (Lees meer/Lire plus niet geopend) [confidence: hoog]');
  }
  if (Array.isArray(adv.keywords) && adv.keywords.length) {
    if (adv.keywords.some(k => /isolatie|isolation|double vitrage|triple vitrage|warmtepomp|pompe à chaleur/i.test(k))) {
      pushUnique(out.sterke_punten, '• Positieve energie-indicaties (isolatie/glas/warmtepomp) (bron: advertentie) [confidence: middel]');
    }
    if (adv.keywords.some(k => /travaux|rénover|to renovate/i.test(k))) {
      pushUnique(out.mogelijke_kansen, '• Renovatiekansen met waardevermeerdering (bron: advertentie) [confidence: middel]');
      pushUnique(out.mogelijke_zorgpunten, '• Werkzaamheden te verwachten (bron: advertentie) [confidence: middel]');
    }
  }

  return out;
}

function ensureActieplan(list, signals) {
  const out = Array.isArray(list) ? list.slice(0) : [];
  const add = (s) => pushUnique(out, s);

  add('• ERP (État des Risques et Pollutions) opvragen zodra exact adres bekend is.');
  add('• PLU-zonering en SUP controleren via Géoportail Urbanisme.');
  add('• Kadastrale referenties en perceelgrenzen bij de notaris bevestigen.');
  add('• Recente DVF-transacties in de directe omgeving vergelijken.');
  add('• Staat van installaties (elektra/gas/riolering) laten inspecteren.');

  const adv = signals?.advertentie || {};
  if (adv.near_water) {
    add('• Extra: overstromingshistorie en preventiemaatregelen opvragen (bijv. PPRI/ERP-bijlage).');
  }
  if (adv.truncated) {
    add('• Volledige advertentietekst verzamelen (open “Lees meer / Lire plus” en kopieer opnieuw).');
  }
  if (Array.isArray(adv.towns) && adv.towns.length) {
    add('• Exacte adreslocatie (pin of adres) bij makelaar/verkoper bevestigen i.v.m. locatie-afwijking.');
  }
  return out;
}

function ensureCommunicatie(obj, signals) {
  const out = {
    verkoper: Array.isArray(obj?.verkoper) ? obj.verkoper.slice(0) : [],
    notaris: Array.isArray(obj?.notaris) ? obj.notaris.slice(0) : [],
    makelaar: Array.isArray(obj?.makelaar) ? obj.makelaar.slice(0) : []
  };
  const pushV = (s) => pushUnique(out.verkoper, s);
  const pushN = (s) => pushUnique(out.notaris, s);
  const pushM = (s) => pushUnique(out.makelaar, s);

  // Minimale set
  pushV('• Is er een recent ERP beschikbaar (≤ 6 maanden)?');
  pushV('• Zijn er bekende gebreken of lopende dossiers?');
  pushV('• Zijn er recente renovaties uitgevoerd (met facturen/garanties)?');

  pushN('• Kadastrale referenties en erfdienstbaarheden bevestigen.');
  pushN('• Zijn er openstaande schulden of inschrijvingen op het pand?');
  pushN('• Zijn alle verplichte documenten beschikbaar voor compromis?');

  pushM('• Kunt u de exacte locatie (adres/pin) bevestigen?');
  pushM('• Recente vergelijkbare verkopen in de directe nabijheid?');
  pushM('• Reden van verkoop en eventuele biedingen?');

  const adv = signals?.advertentie || {};
  if (adv.near_water) {
    pushM('• Ligt het pand in of nabij een overstromingsgebied (PPRI)?');
  }
  if (Array.isArray(adv.towns) && adv.towns.length) {
    pushM(`• Advertentie noemt nabij: ${adv.towns.join(', ')} – in welke gemeente ligt het pand exact?`);
  }
  return out;
}

function pushUnique(arr, item) {
  if (!arr.some(x => String(x) === String(item))) arr.push(item);
}
function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }
