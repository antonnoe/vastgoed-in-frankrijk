// /api/ping-gemini.js
// ESM endpoint (Vercel) voor een minimale Gemini round-trip via REST.
// - Default model: gemini-2.0-flash
// - Fallbacks bij 404/NOT_FOUND: eerst nogmaals gemini-2.0-flash (sanity), dan gemini-1.5-flash-latest
// - 429: backoff 2s, daarna 4s (max 2 retries)
// - Request body (POST): { prompt?: string, model?: string }
// - GET ?ping=1 → health check

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      if (req.query?.ping) {
        return res.status(200).json({ ok: true, pong: true, timestamp: new Date().toISOString() });
      }
      return res
        .status(405)
        .json({ ok: false, error: 'Method Not Allowed. Use POST { prompt, model? } or GET ?ping=1.' });
    }

    if (req.method !== 'POST') {
      return res
        .status(405)
        .json({ ok: false, error: 'Method Not Allowed. Use POST { prompt, model? }.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ ok: false, error: 'Server misconfiguratie: GEMINI_API_KEY ontbreekt.' });
    }

    let body = {};
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    } catch {
      body = {};
    }

    const userPrompt = (body.prompt ?? 'ping').toString();
    // Respecteer aangevraagd model, maar val terug op de default
    const requestedModel = (body.model || '').toString().trim();
    const DEFAULT_MODEL = 'gemini-2.0-flash';
    const FALLBACK_MODEL = 'gemini-1.5-flash-latest';

    // volgens spec
    const makePayload = (text) => ({
      contents: [{ parts: [{ text }] }],
    });

    // Kleine helper: belt het REST endpoint van Google
    async function callGeminiOnce(modelName, attempt, controller) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`;
      const started = Date.now();
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify(makePayload(userPrompt)),
        signal: controller?.signal,
      });
      const latencyMs = Date.now() - started;

      const ct = resp.headers.get('content-type') || '';
      const isJson = ct.includes('application/json');
      const data = isJson ? await resp.json() : await resp.text();

      return { resp, data, latencyMs, modelName, attempt };
    }

    // Retry-beleid: 429 → 2s, daarna 4s, max 2 retries (per model)
    async function withRetries(modelName) {
      let attempt = 0;
      const results = [];
      const backoffs = [2000, 4000];
      while (attempt <= backoffs.length) {
        attempt++;
        const controller = new AbortController();

        try {
          const out = await callGeminiOnce(modelName, attempt, controller);
          const { resp, data, latencyMs } = out;
          results.push({ code: resp.status, latencyMs });

          if (resp.ok) {
            // Parseer text-antwoord
            let text = '';
            try {
              const candidates = data?.candidates || [];
              const parts = candidates[0]?.content?.parts || [];
              text = parts.map(p => p?.text || '').join('\n').trim();
            } catch { /* noop */ }

            return {
              ok: true,
              model: modelName,
              latencyMs,
              text: text || '[leeg antwoord]',
              retries: attempt - 1,
              history: results,
            };
          }

          // 429 → backoff
          if (resp.status === 429) {
            const wait = backoffs[attempt - 1] ?? 0;
            if (wait > 0) await new Promise(r => setTimeout(r, wait));
            continue;
          }

          // Andere fouten: geef terug met detail
          return {
            ok: false,
            model: modelName,
            latencyMs,
            error: extractErrorMessage(data) || `HTTP ${resp.status}`,
            code: resp.status,
            history: results,
          };
        } catch (e) {
          results.push({ code: 'FETCH_ERROR', latencyMs: null, message: e?.message || String(e) });
          // bij fetch-error geen extra backoff-cyclus behalve als we nog retries hebben
          const wait = backoffs[attempt - 1] ?? 0;
          if (wait > 0) await new Promise(r => setTimeout(r, wait));
        }
      }
      return { ok: false, model: modelName, error: 'Max retries bereikt (429/backoff).', history: [] };
    }

    function extractErrorMessage(d) {
      try {
        if (typeof d === 'string') return d;
        return d?.error?.message || d?.message || d?.error?.error?.message || null;
      } catch { return null; }
    }

    // Modelkeuze + failover bij 404/NOT_FOUND
    const modelOrder = [];
    if (requestedModel) modelOrder.push(requestedModel);
    if (!modelOrder.includes(DEFAULT_MODEL)) modelOrder.push(DEFAULT_MODEL);
    if (!modelOrder.includes(FALLBACK_MODEL)) modelOrder.push(FALLBACK_MODEL);

    let lastErr = null;
    let tried = [];

    for (const modelName of modelOrder) {
      const r = await withRetries(modelName);
      tried.push({ model: modelName, ok: r.ok, code: r.code ?? 200, latencyMs: r.latencyMs });

      if (r.ok) {
        return res.status(200).json({
          ok: true,
          model: r.model,
          text: r.text,
          latencyMs: r.latencyMs,
          retries: r.retries,
          tried,
        });
      }

      // 404/NOT_FOUND → probeer volgend model
      const isNotFound = r.code === 404 || /\bNOT_FOUND\b/i.test(r.error || '');
      if (!isNotFound) {
        // Niet 404 → geef direct terug (bijv. 401/403/500)
        lastErr = r;
        break;
      }
      lastErr = r; // en door met volgende model in de lus
    }

    // Als we hier komen: alles gefaald
    return res.status(502).json({
      ok: false,
      error: lastErr?.error || 'Gemini-call mislukte voor alle modellen.',
      tried,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Onbekende serverfout in ping-gemini.' });
  }
}
