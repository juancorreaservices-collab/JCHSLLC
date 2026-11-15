import { createClient } from '@supabase/supabase-js';

const URL_ = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function admin() {
  if (!URL_ || !SERVICE) return null;
  return createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
}

function tokenFrom(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  const m = /(?:^|;\s*)kuadra_token=([^;]+)/.exec(req.headers.cookie || '');
  return m ? decodeURIComponent(m[1]) : (req.query?.t || '');
}

// Resolves the signed-in Kuadra user, or sends 401/403/503 and returns null.
export async function requireUser(req, res) {
  const sb = admin();
  if (!sb) { res.status(503).json({ code: 'not_configured', message: 'Supabase is not configured' }); return null; }
  const token = tokenFrom(req);
  if (!token) { res.status(401).json({ code: 'session_expired', message: 'Sign in first' }); return null; }
  const { data, error } = await sb.auth.getUser(token);
  const email = data?.user?.email;
  if (error || !email) { res.status(401).json({ code: 'session_expired', message: 'Sign in again' }); return null; }
  const { data: rows } = await sb.from('kuadra_users').select('email').ilike('email', email).limit(1);
  if (!rows?.length) { res.status(403).json({ code: 'not_granted', message: 'This account has no access' }); return null; }
  return { email, sb };
}

export const origin = (req) => `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers['x-forwarded-host'] || req.headers.host}`;
