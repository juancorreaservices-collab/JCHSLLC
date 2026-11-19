import { admin, SB_URL, SB_ANON, SB_SERVICE, PG_URL } from '../lib/auth.js';

let schemaOk = false; // remembered while this function instance stays warm

// Public configuration for the browser. The anon key is designed to be public;
// access to data is enforced by row level security in Supabase.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  let hasOwner = null;
  const sb = admin();
  if (sb) {
    const { data, error } = await sb.from('kuadra_users').select('email').limit(1);
    schemaOk = !error;
    if (!error) hasOwner = data.length > 0;
  }
  res.status(200).json({
    supabaseUrl: SB_URL,
    supabaseAnonKey: SB_ANON,
    schema: schemaOk,
    hasOwner,
    canSetup: !!PG_URL,
    features: {
      ai: !!process.env.ANTHROPIC_API_KEY,
      gmail: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      commas: !!process.env.COMMAS_API_KEY,
      files: !!SB_SERVICE,
    },
  });
}
