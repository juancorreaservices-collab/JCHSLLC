import { createClient } from '@supabase/supabase-js';

// Names set by hand or by the Supabase integration for Vercel.
export const SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
export const SB_ANON = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
export const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
export const PG_URL = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || process.env.DATABASE_URL || '';
const URL_ = SB_URL;
const SERVICE = SB_SERVICE;

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
