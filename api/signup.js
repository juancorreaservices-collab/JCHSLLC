import { admin } from '../lib/auth.js';

// Creates an account without the confirmation email. Allowed for the very first
// person (who becomes the owner) and for emails the owner listed under Cuenta → Usuarios.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ code: 'invalid_request' });
  const sb = admin();
  if (!sb) return res.status(503).json({ code: 'not_configured' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length < 8) return res.status(400).json({ code: 'invalid_request', message: 'Email o contraseña no válidos (mínimo 8 caracteres).' });
  const { data: users, error } = await sb.from('kuadra_users').select('email');
  if (error) return res.status(503).json({ code: 'not_configured', message: 'La base de datos todavía no está lista.' });
  const first = users.length === 0;
  // New accounts are closed for now: once the owner exists nobody else can sign up.
  // Set KUADRA_SIGNUP=invited in Vercel to let emails listed under Cuenta → Usuarios create theirs again.
  if (!first && process.env.KUADRA_SIGNUP !== 'invited') return res.status(403).json({ code: 'not_granted', message: 'Por ahora no se pueden crear cuentas nuevas.' });
  if (!first && !users.some(u => u.email.toLowerCase() === email)) return res.status(403).json({ code: 'not_granted', message: 'Ese email no está en la lista de usuarios. Pídele al dueño que te agregue en Cuenta → Usuarios.' });
  const { error: e2 } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
  if (e2) return res.status(/already|registered|exists/i.test(e2.message) ? 409 : 400).json({ code: 'exists', message: /already|registered|exists/i.test(e2.message) ? 'Ese email ya tiene cuenta. Toca "Ya tengo cuenta".' : e2.message });
  if (first) await sb.from('kuadra_users').upsert({ email });
  res.status(200).json({ ok: true, owner: first });
}
