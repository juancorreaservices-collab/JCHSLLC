import { requireUser } from '../lib/auth.js';

// /_blob/<id> → short-lived signed URL of a private file (receipts, photos, PDFs).
export default async function handler(req, res) {
  const user = await requireUser(req, res); if (!user) return;
  const id = String(req.query.id || '');
  if (!/^[A-Za-z0-9_.-]{6,120}$/.test(id)) return res.status(400).json({ code: 'invalid_request' });
  const { data, error } = await user.sb.storage.from('files').createSignedUrl(id, 300);
  if (error || !data?.signedUrl) return res.status(404).json({ code: 'not_found' });
  res.setHeader('Cache-Control', 'private, no-store');
  res.redirect(302, data.signedUrl);
}
