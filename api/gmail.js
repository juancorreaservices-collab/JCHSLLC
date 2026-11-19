import { requireUser } from '../lib/auth.js';
import { gmailAccessToken } from '../lib/google.js';
import { appPasswordSet, imapTools } from '../lib/gmail-imap.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function g(token, path, init = {}) {
  const r = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j?.error?.message || `Gmail ${r.status}`);
    e.code = r.status === 401 ? 'needs_reauth' : r.status === 403 && /scope|permission/i.test(e.message) ? 'needs_reauth' : r.status >= 500 || r.status === 429 ? 'server_unavailable' : 'tool_error';
    throw e;
  }
  return j;
}

const hdr = (m, name) => (m.payload?.headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
function parseAddrs(s) {
  return String(s || '').split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(x => x.trim()).filter(Boolean).map(x => {
    const m = /^(.*?)<([^>]+)>$/.exec(x);
    return m ? { emailAddress: m[2].trim(), displayName: m[1].trim().replace(/^"|"$/g, '') || m[2].trim() } : { emailAddress: x, displayName: x };
  });
}
const b64d = s => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
function plainText(p) {
  if (!p) return '';
  const find = (part, type) => {
    if (part.mimeType === type && part.body?.data) return b64d(part.body.data);
    for (const c of part.parts || []) { const t = find(c, type); if (t) return t; }
    return '';
  };
  const t = find(p, 'text/plain'); if (t) return t;
  const h = find(p, 'text/html');
  return h.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();
}
function shape(m, withBody) {
  const from = parseAddrs(hdr(m, 'From'))[0] || { emailAddress: '', displayName: '' };
  const d = Number(m.internalDate) ? new Date(Number(m.internalDate)).toISOString() : '';
  return { id: m.id, threadId: m.threadId, sender: from.emailAddress, subject: hdr(m, 'Subject'), snippet: m.snippet || '', date: d, labelIds: m.labelIds || [],
    addressDisplayNames: [from, ...parseAddrs(hdr(m, 'To'))], ...(withBody ? { plaintextBody: plainText(m.payload) } : {}) };
}

// ---- MIME ----
const enc = s => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
const wrap = b64 => b64.replace(/(.{76})/g, '$1\r\n');
const clean = s => String(s || '').replace(/[\r\n]+/g, ' ');
function buildMime({ from, to, subject, body, htmlBody, attachments = [], inReplyTo, references }) {
  const bd = n => `kuadra_${n}_${Math.random().toString(36).slice(2)}`;
  const text = `Content-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(Buffer.from(body || '', 'utf8').toString('base64'))}`;
  let core = text;
  if (htmlBody) {
    const b = bd('alt');
    const html = `Content-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(Buffer.from(htmlBody, 'utf8').toString('base64'))}`;
    core = `Content-Type: multipart/alternative; boundary="${b}"\r\n\r\n--${b}\r\n${text}\r\n--${b}\r\n${html}\r\n--${b}--`;
  }
  const part = (a, i) => `Content-Type: ${clean(a.mimeType || 'application/octet-stream')}; name="${enc(clean(a.filename || 'file'))}"\r\nContent-Transfer-Encoding: base64\r\n` +
    (a.inline ? `Content-ID: <att${i}>\r\nContent-Disposition: inline; filename="${enc(clean(a.filename || 'file'))}"` : `Content-Disposition: attachment; filename="${enc(clean(a.filename || 'file'))}"`) +
    `\r\n\r\n${wrap(String(a.content || '').replace(/\s+/g, ''))}`;
  const all = attachments.map((a, i) => ({ a, i }));
  const inline = all.filter(x => x.a.inline), files = all.filter(x => !x.a.inline);
  if (inline.length) { const b = bd('rel'); core = `Content-Type: multipart/related; boundary="${b}"\r\n\r\n--${b}\r\n${core}\r\n${inline.map(x => `--${b}\r\n${part(x.a, x.i)}`).join('\r\n')}\r\n--${b}--`; }
  if (files.length) { const b = bd('mix'); core = `Content-Type: multipart/mixed; boundary="${b}"\r\n\r\n--${b}\r\n${core}\r\n${files.map(x => `--${b}\r\n${part(x.a, x.i)}`).join('\r\n')}\r\n--${b}--`; }
  const head = [from ? `From: ${from}` : '', `To: ${to.map(clean).join(', ')}`, `Subject: ${enc(clean(subject))}`, 'MIME-Version: 1.0', inReplyTo ? `In-Reply-To: ${inReplyTo}` : '', references ? `References: ${references}` : ''].filter(Boolean).join('\r\n');
  return Buffer.from(`${head}\r\n${core}`, 'utf8').toString('base64url');
}

const TOOLS = {
  async status(token, _i, email) { return { payload: { connected: true, email } }; },
  async search_threads(token, i) {
    const n = Math.min(Number(i.pageSize) || 25, 40);
    const list = await g(token, `/threads?maxResults=${n}&q=${encodeURIComponent(i.query || 'in:inbox')}`);
    const threads = await Promise.all((list.threads || []).map(async t => {
      const th = await g(token, `/threads/${t.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`);
      const msgs = (th.messages || []).map(m => shape(m)).reverse(); // newest first
      return { id: th.id, messageCount: msgs.length, messages: msgs };
    }));
    return { payload: { threads } };
  },
  async get_thread(token, i) {
    const th = await g(token, `/threads/${encodeURIComponent(i.threadId)}?format=full`);
    return { payload: { id: th.id, messages: (th.messages || []).map(m => shape(m, true)), viewUrl: `https://mail.google.com/mail/u/0/#all/${th.id}` } };
  },
  async send_message(token, i, email) { return send(token, i, email, false); },
  async create_draft(token, i, email) { return send(token, i, email, true); },
};
async function send(token, i, email, draft) {
  const to = [].concat(i.to || []).filter(Boolean);
  if (!to.length) { const e = new Error('Missing recipient'); e.code = 'tool_error'; throw e; }
  let inReplyTo, references;
  if (i.replyThreadId) {
    try {
      const th = await g(token, `/threads/${encodeURIComponent(i.replyThreadId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`);
      const last = (th.messages || []).slice(-1)[0];
      inReplyTo = hdr(last, 'Message-ID'); references = [hdr(last, 'References'), inReplyTo].filter(Boolean).join(' ');
    } catch (_) {}
  }
  const raw = buildMime({ from: email, to, subject: i.subject || '', body: i.body || '', htmlBody: i.htmlBody, attachments: i.attachments || [], inReplyTo, references });
  const message = { raw, ...(i.replyThreadId ? { threadId: i.replyThreadId } : {}) };
  const r = draft ? await g(token, '/drafts', { method: 'POST', body: JSON.stringify({ message }) }) : await g(token, '/messages/send', { method: 'POST', body: JSON.stringify(message) });
  return { payload: { id: r.id || r.message?.id, threadId: r.threadId || r.message?.threadId } };
}

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ code: 'invalid_request' });
  const user = await requireUser(req, res); if (!user) return;
  const { tool, input } = req.body || {};
  if (appPasswordSet()) {
    // App-password mode: the mailbox is GMAIL_USER, or the owner's own sign-in email.
    let mailbox = process.env.GMAIL_USER || '';
    if (!mailbox) { const { data } = await user.sb.from('kuadra_users').select('email').order('added_at').limit(1); mailbox = data?.[0]?.email || user.email; }
    const t = imapTools(mailbox)[tool];
    if (!t) return res.status(400).json({ code: 'not_in_manifest', message: 'Unknown tool' });
    try { return res.status(200).json(await t(input || {})); }
    catch (e) { const code = e.code || 'tool_error'; return res.status(code === 'needs_reauth' ? 409 : code === 'server_unavailable' ? 503 : 400).json({ code, message: e.message }); }
  }
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(409).json({ code: 'server_not_connected', message: 'Gmail is not set up yet' });
  const fn = TOOLS[tool];
  if (!fn) return res.status(400).json({ code: 'not_in_manifest', message: 'Unknown tool' });
  try {
    const { token, email } = await gmailAccessToken(user.sb);
    res.status(200).json(await fn(token, input || {}, email));
  } catch (e) {
    const code = e.code || 'tool_error';
    res.status(code === 'server_not_connected' || code === 'needs_reauth' ? 409 : code === 'server_unavailable' ? 503 : 400).json({ code, message: e.message });
  }
}
