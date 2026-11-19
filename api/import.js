import crypto from 'node:crypto';
import { admin } from '../lib/auth.js';

// One-time data load, used when moving an existing Kuadra here. It only works while the
// KUADRA_IMPORT_KEY variable is set in Vercel, and the caller must present that key.
export default async function handler(req, res) {
  const key = process.env.KUADRA_IMPORT_KEY || '';
  const got = String(req.headers['x-import-key'] || '');
  if (!key || got.length !== key.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(key))) return res.status(404).json({ code: 'not_found' });
  if (req.method !== 'POST') return res.status(405).json({ code: 'invalid_request' });
  const sb = admin(); if (!sb) return res.status(503).json({ code: 'not_configured' });
  const rows = (req.body?.rows || []).filter(r => r && typeof r.coll === 'string' && typeof r.id === 'string' && r.data && typeof r.data === 'object')
    .map(r => ({ coll: r.coll, id: r.id, data: r.data, updated_at: new Date().toISOString() }));
  if (!rows.length) return res.status(400).json({ code: 'invalid_request' });
  const { error } = await sb.from('docs').upsert(rows);
  if (error) return res.status(500).json({ code: 'failed', message: error.message });
  const { count } = await sb.from('docs').select('*', { count: 'exact', head: true });
  res.status(200).json({ ok: true, written: rows.length, total: count });
}
