// api/genereer-rapport.js
export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  return res.status(410).json({
    error: 'De oude automatische motor is uitgeschakeld. Gebruik /api/analyse met het handmatige dossier.',
  });
}
