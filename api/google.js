import { requireUser, admin, origin } from '../lib/auth.js';
import { SCOPES, signState, readState, tokenRequest } from '../lib/google.js';

// GET /api/google            → starts "Connect Gmail" (needs the signed-in user)
// GET /api/google?code=...   → Google's callback: stores the refresh token server-side
// POST /api/google {action:'disconnect'}
export default async function handler(req, res) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return res.status(503).send('Google OAuth is not configured.');
  const redirect = `${origin(req)}/api/google`;

  if (req.method === 'POST') {
    const user = await requireUser(req, res); if (!user) return;
    if (req.body?.action === 'disconnect') { await user.sb.from('secrets').delete().eq('key', 'google'); return res.status(200).json({ ok: true }); }
    return res.status(400).json({ code: 'invalid_request' });
  }

  if (req.query.error) return res.redirect(302, '/#email');

  if (req.query.code) {
    const st = readState(req.query.state);
    const sb = admin();
    if (!st || !sb) return res.status(400).send('This link expired. Go back to Kuadra and try again.');
    try {
      const t = await tokenRequest({ grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: redirect });
      const prof = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${t.access_token}` } }).then(r => r.json()).catch(() => ({}));
      const { data: old } = await sb.from('secrets').select('value').eq('key', 'google').maybeSingle();
      const value = { refresh_token: t.refresh_token || old?.value?.refresh_token, access_token: t.access_token, expires_at: Date.now() + (t.expires_in || 3500) * 1000, email: prof.emailAddress || '', connected_by: st.email };
      if (!value.refresh_token) return res.status(400).send('Google did not return a refresh token. Remove Kuadra at myaccount.google.com/permissions and connect again.');
      await sb.from('secrets').upsert({ key: 'google', value, updated_at: new Date().toISOString() });
      return res.redirect(302, '/#email');
    } catch (e) { return res.status(400).send('Could not connect Gmail: ' + (e.message || 'error')); }
  }

  const user = await requireUser(req, res); if (!user) return;
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: 'code', scope: SCOPES, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: signState({ email: user.email }) }).toString();
  res.redirect(302, url.toString());
}
