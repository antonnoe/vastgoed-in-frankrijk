// /api/envinfo.js
// Omgevingsinformatie op basis van INSEE of (lat,lon).
// Bronnen (publiek, zonder keys):
// - geo.api.gouv.fr/communes (naam, dept, population, center)
// - data.gouv links (alleen als referentie)
// - (optioneel) eenvoudige kust/berg heuristiek via afstand tot kustlijn is complex;
//   we geven hier nette links + placeholders terug om UI niet te blokkeren.
//
// Input (GET):
//   - insee=XXXXX  (voorkeur)  of
//   - lat=..&lon=.. (fallback)
// Output:
//   {
//     ok, insee, commune:{name, insee, department:{code,name}, population, lat, lon},
//     around: { heritage: [], coast_km: null, ski: null },
//     links: { commune, geoportail, georisques, dvf_app }
//   }

async function fetchJSON(url, timeoutMs = 12000) {
  const r = await fetch(url, { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status} @ ${url} – ${text.slice(0, 300)}`);
  }
  return r.json();
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ ok: false, error: "Method Not Allowed. Use GET." });
      return;
    }

    const { insee: qInsee, lat: qLat, lon: qLon } = req.query || {};
    let insee = (qInsee || "").trim();
    let commune = null;

    // 1) Als INSEE gegeven → haal commune info
    if (insee) {
      const url = `https://geo.api.gouv.fr/communes/${encodeURIComponent(insee)}?fields=nom,code,centre,codeDepartement,departement,population,codesPostaux`;
      const j = await fetchJSON(url);
      commune = normalizeCommuneFromDetails(j);
    } else if (qLat && qLon) {
      // 2) Als lat/lon gegeven → pak dichtsbijzijnde commune
      const url = `https://geo.api.gouv.fr/communes?lat=${encodeURIComponent(qLat)}&lon=${encodeURIComponent(qLon)}&fields=nom,code,centre,codeDepartement,departement,population&format=json&geometry=centre`;
      const j = await fetchJSON(url);
      const c = Array.isArray(j) ? j[0] : null;
      if (c) {
        commune = normalizeCommuneFromListItem(c);
        insee = commune?.insee || "";
      }
    } else {
      res.status(400).json({ ok: false, error: "Bad Request: geef ?insee= of ?lat=&lon=." });
      return;
    }

    if (!commune?.insee) {
      res.status(404).json({ ok: false, error: "Commune niet gevonden." });
      return;
    }

    // 3) Heritage (Monuments historiques) — we pakken top 5 op basis van nabijheid via data.culture.gouv.fr
    // Dataset (opendata): base des monuments historiques via opendatasoft
    // We gebruiken geofilter.distance (10 km radius) indien we lat/lon hebben.
    let heritage = [];
    if (commune.lat && commune.lon) {
      try {
        const ds = "https://data.culture.gouv.fr/api/records/1.0/search/?dataset=base-des-monuments-historiques";
        const q = `${ds}&rows=5&geofilter.distance=${encodeURIComponent(commune.lat)},${encodeURIComponent(commune.lon)},10000`;
        const h = await fetchJSON(q, 12000);
        heritage = (h?.records || []).map(r => {
          const f = r?.fields || {};
          return {
            title: f.tico || f.titre || f.appellation_courante || "Monument",
            commune: f.com || f.commune || null,
            distance_m: null, // API geeft geen directe afstand terug; we tonen zonder afstand
            url: r?.recordid ? `https://data.culture.gouv.fr/explore/dataset/base-des-monuments-historiques/record/?id=${r.recordid}` : null
          };
        });
      } catch {
        heritage = [];
      }
    }

    // 4) Coast / Ski placeholders (zonder zware geoprocessing):
    // We geven nette links terug; UI kan tonen "— km (link)" of "Niet beschikbaar".
    const links = {
      commune: `https://www.geoportail.gouv.fr/carte?c=${commune.lon},${commune.lat}&z=12`,
      geoportail: `https://www.geoportail-urbanisme.gouv.fr/recherche?insee=${commune.insee}`,
      georisques: `https://www.georisques.gouv.fr/commune/${commune.insee}`,
      dvf_app: "https://app.dvf.etalab.gouv.fr/"
    };

    const around = {
      heritage,
      coast_km: null, // (later: echte berekening; nu onbepaald)
      ski: null       // (later: OSM extract of FR api; nu onbepaald)
    };

    res.status(200).json({
      ok: true,
      insee: commune.insee,
      commune,
      around,
      links,
      meta: { timestamp: new Date().toISOString() }
    });

  } catch (e) {
    res.status(500).json({ ok: false, error: "Server error", details: String(e?.message || e).slice(0, 400) });
  }
}

function normalizeCommuneFromDetails(j) {
  if (!j || !j.code) return null;
  const lat = j?.centre?.coordinates?.[1] ?? null;
  const lon = j?.centre?.coordinates?.[0] ?? null;
  return {
    name: j.nom || "",
    insee: j.code || "",
    department: {
      code: j?.departement?.code || j?.codeDepartement || "",
      name: j?.departement?.nom || ""
    },
    population: typeof j?.population === "number" ? j.population : null,
    lat, lon
  };
}
function normalizeCommuneFromListItem(c) {
  const lat = c?.centre?.coordinates?.[1] ?? null;
  const lon = c?.centre?.coordinates?.[0] ?? null;
  return {
    name: c.nom || "",
    insee: c.code || "",
    department: {
      code: c?.departement?.code || c?.codeDepartement || "",
      name: c?.departement?.nom || ""
    },
    population: typeof c?.population === "number" ? c.population : null,
    lat, lon
  };
}
