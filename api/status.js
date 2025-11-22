// /api/status.js
// System Health Check - Test alle externe verbindingen

export default async function handler(req, res) {
  const results = {};
  const startTotal = Date.now();

  // Helper om een URL te testen
  const checkService = async (name, url, method = 'GET', body = null, headers = {}) => {
    const start = Date.now();
    try {
      const options = { method, headers };
      if (body) options.body = JSON.stringify(body);
      
      // Timeout van 5 seconden per service
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      options.signal = controller.signal;

      const response = await fetch(url, options);
      clearTimeout(timeout);

      const duration = Date.now() - start;
      results[name] = {
        status: response.status === 200 ? 'OK' : 'ERROR',
        code: response.status,
        latency: `${duration}ms`,
        url_tested: url
      };
    } catch (error) {
      results[name] = {
        status: 'FAIL',
        error: error.message,
        latency: `${Date.now() - start}ms`
      };
    }
  };

  // 1. Check Google Gemini (API Key check)
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    results['Gemini AI'] = { status: 'CONFIG_ERROR', error: 'API Key ontbreekt in Vercel Env' };
  } else {
    await checkService(
      'Gemini AI',
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      'POST',
      { contents: [{ parts: [{ text: "Ping" }] }] },
      { 'Content-Type': 'application/json' }
    );
  }

  // 2. Check Gemeente API (Gouv.fr) - Test op 'Paris'
  await checkService('API Géo (Gemeentes)', 'https://geo.api.gouv.fr/communes?nom=Paris&limit=1');

  // 3. Check Etalab DVF (Prijzen) - Test op Paris 1er (75101)
  await checkService('Etalab DVF (Prijzen)', 'https://apidvf.etalab.gouv.fr/api/mutations/3j/distribution/75101');

  // 4. Check Géorisques (Risico's) - Test op Paris 1er
  await checkService('Géorisques (Gaspar)', 'https://georisques.gouv.fr/api/v1/gaspar/risques?code_insee=75101');

  // 5. Check IGN GPU (Zonering) - Test op 'Document' (meest stabiele endpoint)
  await checkService('IGN GPU (Zonering)', 'https://apicarto.ign.fr/api/gpu/document?partition=DU_75101');

  // 6. Check Adres Autocomplete API
  await checkService('Adres Autocomplete', 'https://api-adresse.data.gouv.fr/search/?q=paris&limit=1');

  const totalTime = Date.now() - startTotal;

  res.status(200).json({
    system_status: 'Diagnose Voltooid',
    total_duration: `${totalTime}ms`,
    checks: results
  });
}
