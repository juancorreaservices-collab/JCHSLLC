import { admin } from '../auth.js';
import { recordView, shareTarget } from '../views.js';

// Public: /o/<token> is a 1x1 image placed in the email (tells the owner the email was opened);
// /p/<token> records a click on "Pay Now" and sends the client on to the payment page.
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const gif = res => { res.setHeader('Content-Type', 'image/gif'); res.setHeader('Cache-Control', 'no-store, max-age=0'); res.status(200).send(GIF); };

export default async function handler(req, res) {
  const token = String(req.query.t || '').replace(/\.gif$/, ''); const kind = req.query.k === 'pay' ? 'pay' : 'open';
  const ok = /^[a-f0-9]{32,64}$/.test(token); const sb = admin();
  let share = null;
  if (ok && sb) { try { const { data } = await sb.from('docs').select('data').eq('coll', 'shares').eq('id', token).maybeSingle(); share = data?.data || null; } catch (_) {} }
  const target = shareTarget(share);
  // the owner clicking around in their own browser is not the client
  const isOwner = /(?:^|;\s*)kuadra_token=/.test(req.headers.cookie || '');
  if (kind === 'open') { if (target && !isOwner) await recordView(sb, target.coll, target.docId, 'open'); return gif(res); }
  const url = String(share?.payUrl || '');
  if (!/^https:\/\//.test(url)) return res.status(404).send('This payment link is no longer available. Please contact us.');
  if (target && !isOwner) await recordView(sb, target.coll, target.docId, 'pay');
  res.setHeader('Cache-Control', 'no-store'); res.redirect(302, url);
}
