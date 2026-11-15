import crypto from 'node:crypto';

const KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.readonly',
].join(' ');

// Signed, short-lived state for the OAuth round trip.
export function signState(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, ts: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', KEY()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function readState(state) {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) return null;
  const good = crypto.createHmac('sha256', KEY()).update(body).digest('base64url');
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  return Date.now() - p.ts < 15 * 60 * 1000 ? p : null;
}

export async function tokenRequest(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, ...params }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error_description || j.error || 'token'); e.google = j.error; throw e; }
  return j;
}

// Access token for the connected Gmail account, refreshed from the stored refresh token.
export async function gmailAccessToken(sb) {
  const { data } = await sb.from('secrets').select('value').eq('key', 'google').maybeSingle();
  const v = data?.value;
  if (!v?.refresh_token) { const e = new Error('Gmail is not connected'); e.code = 'server_not_connected'; throw e; }
  if (v.access_token && v.expires_at && v.expires_at - Date.now() > 60000) return { token: v.access_token, email: v.email };
  try {
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: v.refresh_token });
    const next = { ...v, access_token: t.access_token, expires_at: Date.now() + (t.expires_in || 3500) * 1000 };
    await sb.from('secrets').upsert({ key: 'google', value: next, updated_at: new Date().toISOString() });
    return { token: next.access_token, email: v.email };
  } catch (err) {
    const e = new Error('Gmail connection expired'); e.code = err.google === 'invalid_grant' ? 'needs_reauth' : 'server_unavailable'; throw e;
  }
}
