import { gmailAccessToken } from './google.js';

// Sends an email from the owner's connected Gmail. `to` defaults to the owner. Attachments: [{name, type, data(Buffer)}].
export async function sendGmail(sb, { to, subject, text, html, attachments = [] }) {
  const { token, email } = await gmailAccessToken(sb);
  const rcpt = to || email; if (!rcpt) throw new Error('no recipient');
  const b64 = x => Buffer.from(x, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  const alt = 'kalt_' + Math.random().toString(36).slice(2), mix = 'kmix_' + Math.random().toString(36).slice(2);
  const body = `--${alt}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(text || '')}\r\n--${alt}\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(html || `<pre>${text || ''}</pre>`)}\r\n--${alt}--`;
  const head = `To: ${rcpt}\r\nSubject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=\r\nMIME-Version: 1.0\r\n`;
  let mime;
  if (!attachments.length) mime = `${head}Content-Type: multipart/alternative; boundary="${alt}"\r\n\r\n${body}`;
  else mime = `${head}Content-Type: multipart/mixed; boundary="${mix}"\r\n\r\n--${mix}\r\nContent-Type: multipart/alternative; boundary="${alt}"\r\n\r\n${body}\r\n` +
    attachments.map(a => `--${mix}\r\nContent-Type: ${a.type}; name="${a.name}"\r\nContent-Disposition: attachment; filename="${a.name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${a.data.toString('base64').replace(/(.{76})/g, '$1\r\n')}\r\n`).join('') + `--${mix}--`;
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: Buffer.from(mime, 'utf8').toString('base64url') }) });
  if (!r.ok) throw new Error('gmail ' + r.status);
  return { from: email };
}
