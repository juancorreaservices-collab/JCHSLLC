import { admin } from '../auth.js';
import { reconcile, totals, todayET } from '../payments.js';
import { sendGmail } from '../mail.js';

// Runs once a day (see vercel.json): catches payments, saves a backup, and tells the owner which invoices need a reminder.
const money = n => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const h = x => String(x ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(404).end();
  const sb = admin(); if (!sb) return res.status(503).end();
  const site = process.env.KUADRA_SITE || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  const out = {}; const today = todayET(); const dow = new Date(today + 'T12:00:00Z').getUTCDay();
  try { out.payments = await reconcile(sb, site); } catch (e) { out.payments = { error: e.message }; }

  // Backup: every row of the database as one JSON file, kept in private storage (last 14) and emailed on Sundays.
  try {
    const all = {}; let n = 0;
    for (let from = 0; ; from += 1000) { const { data, error } = await sb.from('docs').select('coll,id,data').range(from, from + 999); if (error) throw error; data.forEach(r => { if (r.coll !== 'shares') { (all[r.coll] ||= {})[r.id] = r.data; n++; } }); if (data.length < 1000) break; }
    const buf = Buffer.from(JSON.stringify({ app: 'kuadra', exportedAt: new Date().toISOString(), data: all }));
    await sb.storage.from('files').upload(`backups/kuadra-backup-${today}.json`, buf, { contentType: 'application/json', upsert: true });
    const { data: files } = await sb.storage.from('files').list('backups', { limit: 100, sortBy: { column: 'name', order: 'desc' } });
    const old = (files || []).slice(14).map(f => 'backups/' + f.name); if (old.length) await sb.storage.from('files').remove(old);
    out.backup = { rows: n, bytes: buf.length, kept: Math.min(14, (files || []).length) };
    if (dow === 0 && buf.length < 18e6) { await sendGmail(sb, { subject: `Kuadra backup - ${today}`, text: `Your weekly Kuadra backup is attached (${n} records). Keep this email. To restore it: Kuadra → Account → Backup → Import.`, html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#0B1B33"><p>Your weekly Kuadra backup is attached (${n} records).</p><p style="color:#44536B;font-size:14px">Keep this email. To restore it: Kuadra → Account → Backup → Import.</p></div>`, attachments: [{ name: `kuadra-backup-${today}.json`, type: 'application/json', data: buf }] }); out.backup.emailed = true; }
  } catch (e) { out.backup = { error: e.message }; }

  // Reminder digest: on the day an invoice turns 3 or 10 days overdue, and every Monday while anything is overdue.
  try {
    const { data: rows } = await sb.from('docs').select('coll,id,data').in('coll', ['invoices', 'clients']);
    const names = Object.fromEntries(rows.filter(r => r.coll === 'clients').map(r => [r.id, r.data.name]));
    const late = rows.filter(r => r.coll === 'invoices').map(r => r.data).filter(d => d.sentAt && d.due && totals(d).total > 0 && totals(d).balance > 0.004)
      .map(d => ({ d, days: Math.floor((new Date(today) - new Date(d.due)) / 86400000) })).filter(x => x.days > 0).sort((a, b) => b.days - a.days);
    out.overdue = late.length;
    if (late.length && (late.some(x => x.days === 3 || x.days === 10) || dow === 1)) {
      const lines = late.map(x => `${names[x.d.clientId] || 'Client'} - invoice ${x.d.number} - ${money(totals(x.d).balance)} - ${x.days} day${x.days === 1 ? '' : 's'} overdue${(x.d.reminders || []).length ? ` - ${(x.d.reminders || []).length} reminder(s) sent` : ''}`);
      await sendGmail(sb, { subject: `${late.length} invoice${late.length === 1 ? ' is' : 's are'} overdue - send reminders`, text: `These invoices are past due:\n\n${lines.join('\n')}\n\nOpen Kuadra to review and send the reminders:\n${site}/#recordatorios`,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#0B1B33;max-width:560px"><p style="font-size:16px;margin:0 0 12px"><b>${late.length} invoice${late.length === 1 ? ' is' : 's are'} past due.</b></p><table cellpadding="0" cellspacing="0" border="0" width="100%">${late.map(x => `<tr><td style="padding:8px 0;border-top:1px solid #E3E9F1;font-size:14px"><b>${h(names[x.d.clientId] || 'Client')}</b><br><span style="color:#8492A8;font-size:12px">${h(x.d.number)} · ${x.days} day${x.days === 1 ? '' : 's'} overdue${(x.d.reminders || []).length ? ` · ${(x.d.reminders || []).length} reminder(s) sent` : ''}</span></td><td align="right" style="padding:8px 0;border-top:1px solid #E3E9F1;font-size:14px;font-weight:bold">${money(totals(x.d).balance)}</td></tr>`).join('')}</table>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px"><tr><td bgcolor="#0B1B33" style="background-color:#0B1B33;border-radius:8px"><a href="${h(site)}/#recordatorios" style="display:block;padding:13px 20px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px">Review and send reminders</a></td></tr></table><p style="font-size:12px;color:#8492A8;margin-top:14px">Nothing is sent to your clients until you approve each reminder.</p></div>` });
      out.digest = true;
    }
  } catch (e) { out.digest = { error: e.message }; }
  res.status(200).json(out);
}
