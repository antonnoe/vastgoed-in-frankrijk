// /api/address-verify.js
// Adresvalidatie via api-adresse.data.gouv.fr (server-side; geen keys nodig)
// Input (GET):
//   - q (vrije tekst)  of
//   - street, housenr, postcode, city (worden samengevoegd tot q)
//   - limit (optioneel, default 5)
// Output: { ok, query, hits:[{label,city,postcode,score,insee,lat,lon}], bestHit, mismatchHints }
//
// Let op: alle externe requests lopen hier via de server; geen calls vanuit de browser.

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ ok: false, error: "Method Not Allowed. Use GET." });
      return;
    }

    const {
      q: rawQ,
      street = "",
      housenr = "",
      postcode = "",
      city = "",
      limit = "5"
    } = req.query || {};

    const q = (rawQ && String(rawQ).trim()) ||
              [housenr, street, postcode, city].map(v => String(v || "").trim()).filter(Boolean).join(" ");

    if (!q) {
      res.status(400).json({ ok: false, error: "Bad Request: geef ?q= of (street+housenr+postcode+city)." });
      return;
    }

    const url = new URL("https://api-adresse.data.gouv.fr/search/");
    url.searchParams.set("q", q);
    url.searchParams.set("limit", String(limit || "5"));
    url.searchParams.set("autocomplete", "1");

    const t0 = Date.now();
    const r = await fetch(url.toString(), {
      headers: { "Accept": "application/json" },
      // redelijke timeout
      signal: AbortSignal.timeout(10000)
    });

    if (r.status === 429) {
      // eenvoudige backoff en één retry
      await new Promise(r => setTimeout(r, 1200));
      const r2 = await fetch(url.toString(), { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(10000) });
      if (!r2.ok) {
        const text2 = await r2.text().catch(() => "");
        res.status(r2.status).json({ ok: false, error: `Adresse API 2e poging: HTTP ${r2.status}`, details: text2.slice(0, 400) });
        return;
      }
      const j2 = await r2.json();
      return done(j2);
    }

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      res.status(r.status).json({ ok: false, error: `Adresse API: HTTP ${r.status}`, details: text.slice(0, 400) });
      return;
    }

    const j = await r.json();
    return done(j);

    function done(payload) {
      const feats = Array.isArray(payload?.features) ? payload.features : [];
      const hits = feats.map(f => {
        const p = f?.properties || {};
        const g = f?.geometry?.coordinates || [];
        return {
          label: p.label || "",
          city: p.city || p.citycode || p.context || "",
          postcode: p.postcode || "",
          score: typeof p.score === "number" ? p.score : null,
          insee: p.citycode || p.insee || null,
          lat: typeof g[1] === "number" ? g[1] : null,
          lon: typeof g[0] === "number" ? g[0] : null
        };
      });

      const best = hits[0] || null;
      const mismatchHints = [];
      if (best && city && best.label && !best.label.toLowerCase().includes(String(city).toLowerCase())) {
        mismatchHints.push("Label komt niet overeen met opgegeven plaatsnaam.");
      }
      if (best && postcode && best.postcode && String(best.postcode) !== String(postcode)) {
        mismatchHints.push("Postcode wijkt af van invoer.");
      }

      res.status(200).json({
        ok: true,
        ms: Date.now() - t0,
        query: { q, street, housenr, postcode, city, limit: Number(limit || 5) },
        hits,
        bestHit: best,
        mismatchHints
      });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: "Server error", details: String(e?.message || e).slice(0, 400) });
  }
}
