import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { admin, PG_URL } from '../lib/auth.js';

// Creates Kuadra's tables the first time the site is opened. It runs the fixed,
// repeat-safe file supabase/schema.sql and takes no input, so it is safe to call again.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ code: 'invalid_request' });
  const sb = admin();
  if (sb) { const { error } = await sb.from('kuadra_users').select('email').limit(1); if (!error) return res.status(200).json({ ok: true, already: true }); }
  if (!PG_URL) return res.status(503).json({ code: 'not_configured', message: 'No database connection string (POSTGRES_URL). Run supabase/schema.sql in the Supabase SQL Editor.' });
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase', 'schema.sql'), 'utf8');
  // Supabase signs its database certificates with its own CA, which Node does not ship;
  // the connection is still encrypted. Strip sslmode so the explicit ssl option applies.
  const u = new URL(PG_URL); u.searchParams.delete('sslmode');
  const client = new pg.Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  try {
    await client.connect();
    await client.query(sql);
    await client.query("notify pgrst, 'reload schema'");
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ code: 'setup_failed', message: String(e?.message || e) });
  } finally { await client.end().catch(() => {}); }
}
