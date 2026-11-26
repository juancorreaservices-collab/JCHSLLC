import { admin } from '../auth.js';
import { reconcile } from '../payments.js';

// Commas calls this when a checkout is paid. The call itself is only a nudge: nothing in it is trusted.
// Kuadra then asks Commas, with its own key, which invoices were really paid.
export default async function handler(req, res) {
  const secret = process.env.COMMAS_HOOK_SECRET;
  if (!secret || req.query.s !== secret) return res.status(404).end();
  const sb = admin(); if (!sb) return res.status(503).end();
  const site = process.env.KUADRA_SITE || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  try { const r = await reconcile(sb, site); res.status(200).json({ ok: true, recorded: r.recorded.length }); }
  catch (e) { res.status(200).json({ ok: false }); }
}
