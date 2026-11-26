import { requireUser, origin } from '../lib/auth.js';

const BASE = process.env.COMMAS_API_BASE || 'https://www.fanbasis.com/public-api';

async function commas(path, init = {}) {
  const r = await fetch(BASE + path, { ...init, headers: { 'x-api-key': process.env.COMMAS_API_KEY, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j?.message || `Commas ${r.status}`); e.status = r.status; throw e; }
  return j;
}

// POST {action:'create', number, amount, title, description, invoiceId} → {id, url}
// POST {action:'status', id}                                            → {paid, count, transactions}
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ code: 'invalid_request' });
  const user = await requireUser(req, res); if (!user) return;
  if (!process.env.COMMAS_API_KEY) return res.status(503).json({ code: 'not_configured', message: 'COMMAS_API_KEY is not set' });
  const b = req.body || {};
  try {
    if (b.action === 'create') {
      const cents = Math.round(Number(b.amount) * 100);
      if (!(cents >= 50)) return res.status(400).json({ code: 'invalid_request', message: 'Amount too small' });
      const r = await commas('/checkout-sessions', { method: 'POST', body: JSON.stringify({
        product: { title: String(b.title || `Invoice ${b.number || ''}`).slice(0, 120), description: String(b.description || '').slice(0, 500) || null },
        amount_cents: cents,
        type: 'onetime_non_reusable',
        metadata: { invoice: String(b.number || ''), invoice_id: String(b.invoiceId || ''), source: 'kuadra' },
        success_url: `${origin(req)}/gracias.html`,
        ...(process.env.COMMAS_HOOK_SECRET ? { webhook_url: `${process.env.KUADRA_SITE || origin(req)}/api/pub?fn=hook&s=${process.env.COMMAS_HOOK_SECRET}` } : {}),
      }) });
      const id = r?.data?.checkout_session_id, url = r?.data?.payment_link;
      if (!url) return res.status(502).json({ code: 'upstream_error', message: 'Commas did not return a payment link' });
      return res.status(200).json({ id: id != null ? String(id) : '', url });
    }
    if (b.action === 'status') {
      const id = String(b.id || ''); if (!/^[\w-]+$/.test(id)) return res.status(400).json({ code: 'invalid_request' });
      const r = await commas(`/checkout-sessions/${id}/transactions`);
      const d = r?.data; const txs = Array.isArray(d) ? d : (d?.transactions || d?.items || []);
      return res.status(200).json({ paid: txs.length > 0, count: txs.length, transactions: txs.slice(0, 5) });
    }
    return res.status(400).json({ code: 'invalid_request' });
  } catch (e) {
    const code = e.status === 401 || e.status === 403 ? 'not_configured' : e.status === 404 ? 'not_found' : 'upstream_error';
    res.status(e.status === 404 ? 404 : 502).json({ code, message: e.message });
  }
}
