// /api/analyse.js
// Immodiagnostique – Analyse endpoint (POST { dossier, signals? })
//
// Verbeteringen t.o.v. vorige versie:
// - Eerst strikt JSON aan Gemini vragen (precies schema).
// - JSON parsing + schoonmaak (strip markdown/sectiekoppen, dedup, max 6).
// - Heuristische fallback indien JSON niet lukt.
// - Assertieve aanvulling vanuit 'signals' blijft (DVF/prijs, Géorisques, advertentie.*).
//
// Vereisten:
// - Google Gemini via REST (geen SDK)
// - Default model: gemini-2.0-flash; fallbacks: gemini-2.0-flash (retry) → gemini-1.5-flash-latest
// - Rate limit: 1 req/sec, max 8 req/min. Bij 429: backoff 2s, dan 4s.
// - JSON body naar Gemini: { contents:[{ parts:[{ text:"..." }] }] }

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

  // Modellen (default + retry + fallback)
  const models = [
    'gemini-2.0-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash-latest'
  ];

  const prompt = buildStrictJsonPrompt(dossier, signals);

  let modelUsed = null;
  let throttleNotice = null;
  let aiRaw = null;

  // 1) Call Gemini met backoff & fallbacks
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      const { text, throttle } = await callGeminiOnce({
        apiKey: GEMINI_API_KEY,
        model,
        text: prompt
      });
      aiRaw = text;
      modelUsed = model;
      if (throttle) throttleNotice = throttle;
      break;
    } catch (err) {
      if (err.status === 404 || /NOT_FOUND/.test(String(err.message || ''))) {
        continue; // probeer volgende model
      }
      if (err.status === 429) {
        if (!throttleNotice) throttleNotice = '429 throttled – backoff toegepast';
        await sleep(2000);
        try {
          const { text, throttle } = await callGeminiOnce({ apiKey: GEMINI_API_KEY, model, text: prompt });
          aiRaw = text; modelUsed = model; if (throttle) throttleNotice = throttle; break;
        } catch (e2) {
          if (e2.status === 429) {
            await sleep(4000);
            const { text, throttle } = await callGeminiOnce({ apiKey: GEMINI_API_KEY, model, text: prompt });
            aiRaw = text; modelUsed = model; if (throttle) throttleNotice = throttle; break;
          }
          continue;
        }
      }
      continue;
    }
  }

  // 2) Parse AI naar object
  let parsed = parseStrictJson(aiRaw);
  if (!parsed) {
    // fallback op heuristische parser (vorige gedrag)
    parsed = parseAiText(aiRaw);
  }

  // 3) Schoonmaak + limieten
  const cleaned = sanitizeParsed(parsed);

  // 4) Assertieve aanvulling vanuit signals
  const swot = ensureSwotWithFallback(cleaned.swot, signals);
  const actieplan = ensureActieplan(cleaned.actieplan, signals);
  const communicatie = ensureCommunicatie(cleaned.communicatie, signals);

  // 5) Antwoord
  res.status(200).json({
    ok: true,
    model: modelUsed || models[0],
    throttleNotice: throttleNotice || null,
    output: {
      swot,
      actieplan,
      communicatie,
      red_flags: cleaned.red_flags || [],
      actions: cleaned.actions || [],
      questions: cleaned.questions || [],
      disclaimer: cleaned.disclaimer || defaultDisclaimer(),
      raw_text: aiRaw || defaultRawText(dossier, signals)
    },
    meta: {
      received_chars: dossier.length,
      signals_present: !!signals,
      timestamp: new Date().toISOString()
    }
  });
}

/* ---------------- Gemini call ---------------- */

async function callGeminiOnce({ apiKey, model, text }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = { contents: [{ parts: [{ text }] }] };

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
    const err = new Error(msg); err.status = res.status; throw err;
  }

  let textOut = '';
  try {
    const cand = data?.candidates?.[0];
    const parts = cand?.content?.parts || [];
    textOut = parts.map(p => p.text).filter(Boolean).join('\n').trim();
  } catch {
    textOut = '';
  }
  return { text: textOut, throttle: res.status === 429 ? '429 throttled' : null };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ---------------- Prompting ---------------- */

function buildStrictJsonPrompt(dossier, signals) {
  const hints = [];
  if (signals) {
    if (typeof signals.price === 'number') hints.push(`- Vraagprijs: EUR ${signals.price}`);
    if (signals.dvf?.median_price != null) hints.push(`- DVF-mediaan: EUR ${signals.dvf.median_price}`);
    if (signals.georisques) {
      const keys = Object.keys(signals.georisques).filter(k => signals.georisques[k]);
      hints.push(keys.length ? `- Géorisques (positief): ${keys.join(', ')}` : `- Géorisques: geen categorieën positief`);
    }
    if (signals.advertentie?.keywords?.length) hints.push(`- Advertentie keywords: ${signals.advertentie.keywords.join(', ')}`);
    if (signals.advertentie?.towns?.length)    hints.push(`- Advertentie noemt nabij: ${signals.advertentie.towns.join(', ')}`);
    if (signals.advertentie?.near_water)       hints.push(`- Heuristiek: ligging nabij water`);
    if (signals.advertentie?.truncated)        hints.push(`- Waarschuwing: advertentietekst mogelijk onvolledig (Lees meer/Lire plus)`);
  }

  const sys = [
    'Je bent een kritische due-diligence assistent voor de Franse woningmarkt.',
    'Antwoord uitsluitend in strikt geldige JSON conform het schema hieronder.',
    'GEEN uitleg, GEEN markdown, GEEN extra tekst buiten de JSON.',
    'Korte, concrete bullets; maximaal 6 items per lijst; zonder *, -, ** of andere markering; gewone platte strings.'
  ].join(' ');

  const schema = {
    swot: {
      sterke_punten: ["string"],
      mogelijke_zorgpunten: ["string"],
      mogelijke_kansen: ["string"],
      mogelijke_bedreigingen: ["string"]
    },
    actieplan: ["string"],
    communicatie: {
      verkoper: ["string"],
      notaris: ["string"],
      makelaar: ["string"]
    }
  };

  return [
    sys,
    '',
    'Dossiertekst:',
    dossier,
    '',
    'Contextsignalen:',
    hints.join('\n'),
    '',
    'Schema (voorbeeldstructuur, geen uitleg teruggeven):',
    JSON.stringify(schema, null, 2),
    '',
    'Geef NU ALLEEN de JSON terug, exact volgens schema.'
  ].join('\n');
}

/* ---------------- Parsing & Cleanup ---------------- */

function parseStrictJson(text) {
  if (!text || !text.trim()) return null;
  // Neem het grootste JSON-blok
  const match = text.match(/\{[\s\S]*\}$/);
  const candidate = match ? match[0] : text;
  try {
    const obj = JSON.parse(candidate);
    // minimale vormcontrole
    if (!obj || typeof obj !== 'object') return null;
    if (!obj.swot || !obj.actieplan || !obj.communicatie) return null;
    return obj;
  } catch {
    return null;
  }
}

function sanitizeParsed(parsed) {
  // Normaliseer en beperk lijsten, verwijder markdown/sectiekoppen
  const scr = (s) => sanitizeLine(s);
  const clamp = (arr) => Array.from(dedupe((arr || []).map(scr))).filter(Boolean).slice(0, 6);

  const swot = parsed.swot || {};
  const cleaned = {
    swot: {
      sterke_punten: clamp(swot.sterke_punten),
      mogelijke_zorgpunten: clamp(swot.mogelijke_zorgpunten),
      mogelijke_kansen: clamp(swot.mogelijke_kansen),
      mogelijke_bedreigingen: clamp(swot.mogelijke_bedreigingen)
    },
    actieplan: clamp(parsed.actieplan),
    communicatie: {
      verkoper: clamp(parsed.communicatie?.verkoper),
      notaris: clamp(parsed.communicatie?.notaris),
      makelaar: clamp(parsed.communicatie?.makelaar)
    },
    red_flags: clamp(parsed.red_flags || []),
    actions: clamp(parsed.actions || []),
    questions: clamp(parsed.questions || []),
    disclaimer: (parsed.disclaimer || '').toString().trim()
  };

  // Extra guard: verwijder regels die zelf weer sectiekoppen voorstellen
  for (const key of ['sterke_punten','mogelijke_zorgpunten','mogelijke_kansen','mogelijke_bedreigingen']) {
    cleaned.swot[key] = cleaned.swot[key].filter(notASectionHeader);
  }
  cleaned.actieplan = cleaned.actieplan.filter(notASectionHeader);
  cleaned.communicatie.verkoper = cleaned.communicatie.verkoper.filter(notASectionHeader);
  cleaned.communicatie.notaris = cleaned.communicatie.notaris.filter(notASectionHeader);
  cleaned.communicatie.makelaar = cleaned.communicatie.makelaar.filter(notASectionHeader);

  return cleaned;
}

function sanitizeLine(s) {
  if (s == null) return '';
  let v = String(s).trim();

  // Strip markdown bullets / bold / italics
  v = v.replace(/^[-*\u2022•]+\s*/g, '');   // leading -,*,• bullets
  v = v.replace(/^\d+\.\s*/g, '');          // "1. "
  v = v.replace(/^\(?[ivxlcdm]+\)\s*/i, ''); // roman numerals like (i)
  v = v.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1'); // *text*, **text**

  // Soms zet model kopjes in items; strip kopje-prefixen
  v = v.replace(/^(?:sterke punten|mogelijke zorgpunten|zwakten|mogelijke kansen|mogelijke bedreigingen|actieplan|communicatie)\s*:\s*/i, '');

  // Collapse spaces
  v = v.replace(/\s+/g, ' ').trim();

  // Verwijder rest-markdown-ruis
  v = v.replace(/^#+\s*/, '');

  return v;
}

function notASectionHeader(s) {
  const lower = s.toLowerCase();
  return !/^(?:sterke punten|mogelijke zorgpunten|zwakten|mogelijke kansen|mogelijke bedreigingen|actieplan|communicatie)\b/.test(lower);
}

function dedupe(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = String(x);
    if (!seen.has(k)) { out.push(x); seen.add(k); }
  }
  return out;
}

/* ---------------- Heuristische fallback (oude parser) ---------------- */

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
    if (m) out.push(m[1].trim());
  }
  return out;
}
function findDisclaimer(text) {
  const m = text.match(/disclaimer[:\s-]+([\s\S]+)$/i);
  return m ? m[1].trim() : '';
}
function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* ---------------- Fallback/aanvulling vanuit signals ---------------- */

function ensureSwotWithFallback(swot, signals) {
  const out = {
    sterke_punten: (swot?.sterke_punten || []).slice(0, 6),
    mogelijke_zorgpunten: (swot?.mogelijke_zorgpunten || []).slice(0, 6),
    mogelijke_kansen: (swot?.mogelijke_kansen || []).slice(0, 6),
    mogelijke_bedreigingen: (swot?.mogelijke_bedreigingen || []).slice(0, 6)
  };

  const price = isNum(signals?.price) ? Number(signals.price) : null;
  const dvfMedian = isNum(signals?.dvf?.median_price) ? Number(signals.dvf.median_price) : null;
  if (price != null && dvfMedian != null) {
    if (price < dvfMedian) {
      pushUnique(out.sterke_punten, 'Prijs ligt onder DVF-mediaan (bron: DVF) [confidence: hoog]');
      pushUnique(out.mogelijke_kansen, 'Potentieel voor waardevermeerdering bij renovatie of optimalisatie [confidence: middel]');
    } else if (price > dvfMedian) {
      pushUnique(out.mogelijke_zorgpunten, 'Prijs ligt boven DVF-mediaan; onderbouwing noodzakelijk (bron: DVF) [confidence: middel]');
    }
  }

  const gr = signals?.georisques;
  if (gr) {
    const anyTrue = Object.values(gr).some(Boolean);
    if (!anyTrue) {
      pushUnique(out.sterke_punten, 'Geen directe omgevingsrisico’s geïdentificeerd (bron: Géorisques) [confidence: hoog]');
    } else {
      const trueKeys = Object.keys(gr).filter(k => gr[k]);
      if (trueKeys.length) {
        pushUnique(out.mogelijke_bedreigingen, `Omgevingsrisico’s aanwezig: ${trueKeys.join(', ')} (bron: Géorisques) [confidence: hoog]`);
      }
    }
  }

  const adv = signals?.advertentie || {};
  if (Array.isArray(adv.towns) && adv.towns.length) {
    pushUnique(out.mogelijke_zorgpunten, `Advertentie noemt nabijgelegen plaatsen: ${adv.towns.join(', ')} – mogelijke locatie-afwijking [confidence: middel]`);
  }
  if (adv.near_water) {
    pushUnique(out.mogelijke_zorgpunten, 'Ligging nabij water → verhoogde ERP/PLU-aandacht vereist (bron: advertentie) [confidence: hoog]');
    pushUnique(out.mogelijke_bedreigingen, 'Potentieel overstromingsrisico (inondation/submersion) [confidence: middel]');
  }
  if (adv.truncated) {
    pushUnique(out.mogelijke_zorgpunten, 'Advertentietekst mogelijk onvolledig (Lees meer/Lire plus niet geopend) [confidence: hoog]');
  }
  if (Array.isArray(adv.keywords) && adv.keywords.length) {
    if (adv.keywords.some(k => /isolatie|isolation|double vitrage|triple vitrage|warmtepomp|pompe à chaleur/i.test(k))) {
      pushUnique(out.sterke_punten, 'Positieve energie-indicaties (isolatie/glas/warmtepomp) (bron: advertentie) [confidence: middel]');
    }
    if (adv.keywords.some(k => /travaux|rénover|to renovate/i.test(k))) {
      pushUnique(out.mogelijke_kansen, 'Renovatiekansen met waardevermeerdering (bron: advertentie) [confidence: middel]');
      pushUnique(out.mogelijke_zorgpunten, 'Werkzaamheden te verwachten (bron: advertentie) [confidence: middel]');
    }
  }

  // Clamp opnieuw
  out.sterke_punten = out.sterke_punten.slice(0, 6);
  out.mogelijke_zorgpunten = out.mogelijke_zorgpunten.slice(0, 6);
  out.mogelijke_kansen = out.mogelijke_kansen.slice(0, 6);
  out.mogelijke_bedreigingen = out.mogelijke_bedreigingen.slice(0, 6);

  return out;
}

function ensureActieplan(list, signals) {
  const out = Array.isArray(list) ? list.slice(0, 6) : [];
  const add = (s) => pushUnique(out, s);

  add('ERP (État des Risques et Pollutions) opvragen zodra exact adres bekend is.');
  add('PLU-zonering en SUP controleren via Géoportail Urbanisme.');
  add('Kadastrale referenties en perceelgrenzen bij de notaris bevestigen.');
  add('Recente DVF-transacties in de directe omgeving vergelijken.');
  add('Staat van installaties (elektra/gas/riolering) laten inspecteren.');

  const adv = signals?.advertentie || {};
  if (adv.near_water) add('Extra: overstromingshistorie en PPRI/ERP-bijlage opvragen.');
  if (adv.truncated) add('Volledige advertentietekst verzamelen (open “Lees meer / Lire plus”).');
  if (Array.isArray(adv.towns) && adv.towns.length) add('Exacte adreslocatie (adres/pin) bevestigen i.v.m. locatie-afwijking.');

  return out.slice(0, 8);
}

function ensureCommunicatie(obj, signals) {
  const out = {
    verkoper: Array.isArray(obj?.verkoper) ? obj.verkoper.slice(0, 6) : [],
    notaris: Array.isArray(obj?.notaris) ? obj.notaris.slice(0, 6) : [],
    makelaar: Array.isArray(obj?.makelaar) ? obj.makelaar.slice(0, 6) : []
  };
  const pushV = (s) => pushUnique(out.verkoper, s);
  const pushN = (s) => pushUnique(out.notaris, s);
  const pushM = (s) => pushUnique(out.makelaar, s);

  // Minimale set
  pushV('Is er een recent ERP beschikbaar (≤ 6 maanden)?');
  pushV('Zijn er bekende gebreken of lopende dossiers?');
  pushV('Zijn er recente renovaties uitgevoerd (met facturen/garanties)?');

  pushN('Kadastrale referenties en erfdienstbaarheden bevestigen.');
  pushN('Zijn er openstaande schulden of inschrijvingen op het pand?');
  pushN('Zijn alle verplichte documenten beschikbaar voor compromis?');

  pushM('Kunt u de exacte locatie (adres/pin) bevestigen?');
  pushM('Recente vergelijkbare verkopen in de directe nabijheid?');
  pushM('Reden van verkoop en eventuele biedingen?');

  const adv = signals?.advertentie || {};
  if (adv.near_water) pushM('Ligt het pand in of nabij een overstromingsgebied (PPRI)?');
  if (Array.isArray(adv.towns) && adv.towns.length) pushM(`Advertentie noemt nabij: ${adv.towns.join(', ')} – in welke gemeente ligt het pand exact?`);

  // Clamp
  out.verkoper = out.verkoper.slice(0, 6);
  out.notaris = out.notaris.slice(0, 6);
  out.makelaar = out.makelaar.slice(0, 6);

  return out;
}

function pushUnique(arr, item) { if (!arr.some(x => String(x) === String(item))) arr.push(item); }
function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }

function defaultDisclaimer() {
  return 'Deze analyse is indicatief en informatief. Raadpleeg notaris, makelaar en officiële bronnen (Géorisques, DVF, Géoportail-Urbanisme). Aan deze tool kunnen geen rechten worden ontleend.';
}
function defaultRawText(dossier, signals) {
  return `Vooronderzoek op basis van beperkte data.\n\nDossier:\n${dossier}\n\nSignals:\n${JSON.stringify(signals || {}, null, 2)}`;
}
