import { admin } from '../lib/auth.js';
import { gmailAccessToken } from '../lib/google.js';

// Public endpoint behind the page a client opens to review and sign an estimate.
// It only knows the snapshot stored under the random token in the link.
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

async function load(sb, token) {
  const { data } = await sb.from('docs').select('data').eq('coll', 'shares').eq('id', token).maybeSingle();
  return data?.data || null;
}

async function notifyOwner(sb, share, name) {
  try {
    const { token, email } = await gmailAccessToken(sb); if (!email) return;
    const subject = `Signed: Estimate ${share.number} - ${name}`;
    const text = `${name} reviewed and signed estimate ${share.number}${share.property ? ' for ' + share.property : ''} (total ${share.total}).\r\n\r\nOpen Kuadra to see the signature and create the invoice.`;
    const raw = Buffer.from(`To: ${email}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${text}`, 'utf8').toString('base64url');
    await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }) });
  } catch (_) { /* the signature is saved either way */ }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const sb = admin(); if (!sb) return res.status(503).json({ code: 'not_configured' });
  const token = String((req.method === 'GET' ? req.query.token : req.body?.token) || '');
  if (!/^[a-f0-9]{32,64}$/.test(token)) return res.status(404).json({ code: 'not_found' });
  const share = await load(sb, token);
  if (!share) return res.status(404).json({ code: 'not_found' });

  if (req.method === 'GET') return res.status(200).json(share);
  if (req.method !== 'POST') return res.status(405).json({ code: 'invalid_request' });

  if (share.signed) return res.status(409).json({ code: 'already_signed', signed: share.signed });
  const name = clean(req.body?.name, 120);
  const image = String(req.body?.signature || '');
  if (name.length < 2) return res.status(400).json({ code: 'invalid_request', message: 'Please type your full name.' });
  if (!req.body?.agree) return res.status(400).json({ code: 'invalid_request', message: 'Please confirm that you agree.' });
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 300000 || image.length < 800) return res.status(400).json({ code: 'invalid_request', message: 'Please draw your signature.' });

  const ip = clean(String(req.headers['x-forwarded-for'] || '').split(',')[0], 60);
  const signed = { name, at: new Date().toISOString(), ip, ua: clean(req.headers['user-agent'], 200), image };

  // The estimate must still point at this link.
  const { data: row } = await sb.from('docs').select('data').eq('coll', 'estimates').eq('id', share.estimateId).maybeSingle();
  const est = row?.data;
  if (!est || est.shareToken !== token) return res.status(410).json({ code: 'gone', message: 'This estimate is no longer available. Please contact us.' });

  const now = signed.at;

  // A signed estimate becomes a project right away, unless it already belongs to one.
  let projectId = est.projectId || '';
  if (!projectId) {
    const { data: rows } = await sb.from('docs').select('id,data').eq('coll', 'projects');
    const nums = (rows || []).map(r => Number(r.data?.num) || 0);
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
    const groups = (share.groups || []).filter(g => g && g.area);
    const who = clean(share.client?.name, 60) || name;
    projectId = 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const project = {
      num: (nums.length ? Math.max(...nums) : 0) + 1,
      name: clean(`${who} – ${share.summary || groups[0]?.area || 'Project'}`, 60),
      type: clean(groups.map(g => g.area).join(', '), 80), clientId: est.clientId || '', owner: who, location: clean(share.property, 120),
      month, order: Date.now(), start: '', end: '', status: 'No comenzado', price: Number(share.totalNumber) || 0, down: '', downDate: '',
      payments: [], purchases: [], subs: [], profitNote: '',
      tasks: groups.map(g => ({ text: clean(g.area, 80), status: 'Pendiente', notes: clean((g.items || []).map(i => i.desc).join('; '), 300) })),
      notes: `Creado al firmarse el estimado ${share.number} (${name}, ${now.slice(0, 10)}).`, fromEstimate: share.estimateId, createdAt: now, updatedAt: now,
    };
    const ins = await sb.from('docs').insert({ coll: 'projects', id: projectId, data: project, updated_at: now });
    if (ins.error) projectId = '';   // the signature still counts; the owner can create the project by hand
  }

  const next = { ...est, ...(projectId ? { projectId } : {}), status: 'Aceptado', acceptedAt: now, acceptedBy: name, sign: { name, at: now, ip, image }, signedSnapshot: { total: share.total, plan: share.plan, contract: share.contract },
    replies: [...(est.replies || []), { id: 'sign-' + token.slice(0, 12), threadId: '', type: 'accepted', at: now, from: name, email: '', subject: '', snippet: 'Reviewed and signed online.', unread: '1' }], updatedAt: now };
  const a = await sb.from('docs').update({ data: next, updated_at: now }).eq('coll', 'estimates').eq('id', share.estimateId);
  if (a.error) return res.status(500).json({ code: 'failed', message: 'Could not save the signature. Please try again.' });
  await sb.from('docs').update({ data: { ...share, signed }, updated_at: now }).eq('coll', 'shares').eq('id', token);
  await notifyOwner(sb, share, name);
  res.status(200).json({ ok: true, signed });
}
