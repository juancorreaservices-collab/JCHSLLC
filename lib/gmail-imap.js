// Gmail through an app password: IMAP to read and search, SMTP to send.
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';

const fail = (code, message) => Object.assign(new Error(message), { code });
const PASS = () => (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
export const appPasswordSet = () => !!PASS();

function mapErr(e) {
  if (e.code && ['server_not_connected', 'needs_reauth', 'tool_error', 'server_unavailable'].includes(e.code)) return e;
  const m = String(e.responseText || e.response || e.message || e);
  if (e.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|Username and Password not accepted|535/i.test(m)) return fail('needs_reauth', 'Google rejected the app password');
  if (/timeout|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(m)) return fail('server_unavailable', m);
  return fail('tool_error', m);
}

async function withImap(user, fn) {
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass: PASS() }, logger: false, connectionTimeout: 15000, socketTimeout: 45000 });
  client.on('error', () => {});
  try {
    await client.connect();
    const boxes = await client.list();
    const box = use => boxes.find(b => b.specialUse === use)?.path;
    return await fn(client, { all: box('\\All') || '[Gmail]/All Mail', drafts: box('\\Drafts') || '[Gmail]/Drafts' });
  } catch (e) { throw mapErr(e); }
  finally { try { await client.logout(); } catch (_) { try { client.close(); } catch (_) {} } }
}

// First text/plain part of a message (falls back to text/html).
function textPart(node, want = 'text/plain') {
  if (!node) return null;
  if (!node.childNodes && node.type === want && (node.disposition || 'inline') !== 'attachment') return node.part || '1';
  for (const c of node.childNodes || []) { const p = textPart(c, want); if (p) return p; }
  return null;
}
async function readPart(client, uid, structure, maxBytes) {
  let part = textPart(structure), html = false;
  if (!part) { part = textPart(structure, 'text/html'); html = true; }
  if (!part) return '';
  const { content } = await client.download(String(uid), part, { uid: true, maxBytes });
  const chunks = []; for await (const c of content) chunks.push(c);
  let t = Buffer.concat(chunks).toString('utf8');
  if (html) t = t.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  return t.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const addr = a => ({ emailAddress: a?.address || '', displayName: a?.name || a?.address || '' });
function shape(m, extra = {}) {
  const env = m.envelope || {}; const from = addr((env.from || [])[0]);
  const labels = [...(m.labels || [])].map(l => String(l).replace(/^\\/, '').toUpperCase());
  if (!(m.flags || new Set()).has('\\Seen')) labels.push('UNREAD');
  return { id: String(m.emailId || m.uid), threadId: String(m.threadId || ''), sender: from.emailAddress, subject: env.subject || '', date: (m.internalDate || env.date) ? new Date(m.internalDate || env.date).toISOString() : '', labelIds: labels,
    addressDisplayNames: [from, ...(env.to || []).map(addr)], snippet: '', ...extra };
}
const FETCH = { uid: true, envelope: true, flags: true, labels: true, threadId: true, emailId: true, internalDate: true, bodyStructure: true };

export function imapTools(user) {
  return {
    async status() { return withImap(user, async () => ({ payload: { connected: true, email: user } })); },

    async search_threads(i) {
      return withImap(user, async (client, box) => {
        const lock = await client.getMailboxLock(box.all, { readOnly: true });
        try {
          const n = Math.min(Number(i.pageSize) || 25, 40);
          const uids = (await client.search({ gmailraw: i.query || 'in:inbox' }, { uid: true })) || [];
          const pick = uids.slice(-n * 2); // newest have the highest numbers
          const msgs = []; if (pick.length) for await (const m of client.fetch(pick, FETCH, { uid: true })) msgs.push(m);
          msgs.sort((a, b) => new Date(b.internalDate) - new Date(a.internalDate));
          const threads = new Map();
          for (const m of msgs) { const k = String(m.threadId || m.uid); if (!threads.has(k)) threads.set(k, []); threads.get(k).push(m); }
          const out = [];
          for (const [id, list] of [...threads].slice(0, n)) {
            const shaped = [];
            for (const m of list.slice(0, 4)) { let snippet = ''; try { snippet = (await readPart(client, m.uid, m.bodyStructure, 700)).replace(/\s+/g, ' ').slice(0, 300); } catch (_) {} shaped.push(shape(m, { snippet })); }
            out.push({ id, messageCount: list.length, messages: shaped });
          }
          return { payload: { threads: out } };
        } finally { lock.release(); }
      });
    },

    async get_thread(i) {
      return withImap(user, async (client, box) => {
        const lock = await client.getMailboxLock(box.all, { readOnly: true });
        try {
          const uids = (await client.search({ threadId: String(i.threadId) }, { uid: true })) || [];
          const msgs = []; if (uids.length) for await (const m of client.fetch(uids, FETCH, { uid: true })) msgs.push(m);
          msgs.sort((a, b) => new Date(a.internalDate) - new Date(b.internalDate));
          const out = [];
          for (const m of msgs.slice(-25)) { let text = ''; try { text = await readPart(client, m.uid, m.bodyStructure, 60000); } catch (_) {} out.push(shape(m, { plaintextBody: text, snippet: text.replace(/\s+/g, ' ').slice(0, 300) })); }
          let hex = ''; try { hex = BigInt(String(i.threadId)).toString(16); } catch (_) {}
          return { payload: { id: String(i.threadId), messages: out, viewUrl: hex ? `https://mail.google.com/mail/u/0/#all/${hex}` : 'https://mail.google.com/' } };
        } finally { lock.release(); }
      });
    },

    async send_message(i) { return send(user, i, false); },
    async create_draft(i) { return send(user, i, true); },
  };
}

export function mailOptions(user, i, reply = {}) {
  const to = [].concat(i.to || []).filter(Boolean);
  if (!to.length) throw fail('tool_error', 'Missing recipient');
  return { from: user, to, subject: String(i.subject || ''), text: String(i.body || ''), ...(i.htmlBody ? { html: String(i.htmlBody) } : {}), ...reply,
    attachments: (i.attachments || []).map((a, n) => ({ filename: a.filename || 'file', content: Buffer.from(String(a.content || ''), 'base64'), contentType: a.mimeType || 'application/octet-stream', ...(a.inline ? { cid: `att${n}`, contentDisposition: 'inline' } : {}) })) };
}

async function send(user, i, draft) {
  let reply = {};
  if (i.replyThreadId || draft) {
    return withImap(user, async (client, box) => {
      if (i.replyThreadId) {
        const lock = await client.getMailboxLock(box.all, { readOnly: true });
        try {
          const uids = (await client.search({ threadId: String(i.replyThreadId) }, { uid: true })) || [];
          if (uids.length) { const m = await client.fetchOne(String(uids[uids.length - 1]), { envelope: true }, { uid: true }); const id = m?.envelope?.messageId; if (id) reply = { inReplyTo: id, references: [id] }; }
        } finally { lock.release(); }
      }
      const opts = mailOptions(user, i, reply);
      if (!draft) return smtp(user, opts);
      const raw = await new MailComposer(opts).compile().build();
      const r = await client.append(box.drafts, raw, ['\\Draft']);
      return { payload: { id: String(r?.uid || '') } };
    });
  }
  return smtp(user, mailOptions(user, i, reply));
}
async function smtp(user, opts) {
  const tx = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass: PASS() }, connectionTimeout: 15000 });
  try { const r = await tx.sendMail(opts); return { payload: { id: r.messageId || '' } }; }
  catch (e) { throw mapErr(e); }
}
