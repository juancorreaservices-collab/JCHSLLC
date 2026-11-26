import { sendGmail } from './mail.js';

// Server-side twin of what the app does when it notices a Commas payment, so it also happens while the app is closed:
// confirm with Commas, record the payment on the invoice (and its project), email the receipt.
const N = v => { const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };
const money = n => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const h = x => String(x ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const todayET = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const dateEn = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][+m - 1] + ' ' + (+d) + ', ' + y; };

export function totals(d) {
  const base = (d.items || []).reduce((a, x) => a + N(x.qty || 1) * N(x.rate), 0);
  const disc = d.showDisc ? Math.min(base, d.discType === '%' ? base * N(d.discount) / 100 : N(d.discount)) : 0;
  const net = base - disc; const sub = net + (d.useMarkup ? net * N(d.markup) / 100 : 0);
  const total = Math.round((sub + sub * N(d.taxRate) / 100) * 100) / 100;
  const paid = (d.payments || []).reduce((a, x) => a + N(x.amount), 0);
  return { total, paid, balance: total - paid };
}

async function commasPaid(id) {
  const BASE = process.env.COMMAS_API_BASE || 'https://www.fanbasis.com/public-api';
  const r = await fetch(`${BASE}/checkout-sessions/${id}/transactions`, { headers: { 'x-api-key': process.env.COMMAS_API_KEY, Accept: 'application/json' } });
  if (!r.ok) return false; const j = await r.json().catch(() => ({})); const d = j?.data; const txs = Array.isArray(d) ? d : (d?.transactions || d?.items || []);
  return txs.length > 0;
}

function receipt(inv, pay, client, st, site) {
  const t = totals(inv); const first = String(client.name || '').split(' ')[0]; const where = inv.property || client.address || ''; const at = where ? ` for the work at ${where}` : '';
  const full = t.balance <= 0.004; const rno = `${inv.number}-R${Math.max(1, (inv.payments || []).indexOf(pay) + 1)}`;
  const intro = `Hi ${first},\n\nThank you! We received your payment of ${money(N(pay.amount))} for invoice ${inv.number}${at}.${full ? ' Your invoice is now paid in full. We appreciate your business.' : ` Your remaining balance is ${money(t.balance)}.`}`;
  const sign = ['Thank you,', st.ownerName, st.tradeName, st.phone, st.email].filter(Boolean).join('\n');
  const F = 'font-family:Arial,Helvetica,sans-serif;', INK = '#0B1B33', MUTE = '#8492A8', SOFT = '#44536B', LINE = '#E3E9F1';
  const para = x => `<div style="${F}font-size:15px;line-height:1.6;color:${INK};white-space:pre-wrap">${h(x)}</div>`;
  const row = (a, b) => `<tr><td style="${F}padding:8px 0;color:${SOFT};font-size:13px;border-top:1px solid ${LINE}">${a}</td><td align="right" style="${F}padding:8px 0;font-size:13px;font-weight:bold;color:${INK};border-top:1px solid ${LINE}">${b}</td></tr>`;
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F4F7FB" style="background-color:#F4F7FB"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid ${LINE};border-top:4px solid ${INK};border-radius:10px">
   <tr><td style="padding:28px 32px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td valign="top"><img src="${h(site)}/logo.jpg" alt="${h(st.tradeName || '')}" width="130" style="display:block;width:130px;height:auto;border:0"></td>
    <td valign="top" align="right"><div style="${F}font-size:22px;letter-spacing:6px;color:${INK}">RECEIPT</div><div style="${F}font-size:12px;color:${MUTE};letter-spacing:1.5px;margin-top:6px">${h(rno)}</div></td></tr></table></td></tr>
   <tr><td style="padding:4px 32px 0">${para(intro)}</td></tr>
   <tr><td style="padding:20px 32px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${LINE};border-radius:10px"><tr><td style="padding:22px">
    <div style="${F}font-size:11px;letter-spacing:1.6px;color:${MUTE};text-transform:uppercase">Payment received</div><div style="${F}font-size:32px;font-weight:bold;color:#1e7a4c;margin:4px 0 14px">${money(N(pay.amount))}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${row('Receipt', h(rno))}${row('Date', dateEn(pay.date))}${row('Method', 'Card · online payment')}${row('Invoice', h(inv.number))}${where ? row('Property', h(where)) : ''}${row('Invoice total', money(t.total))}${row('Total paid', money(t.paid))}${row(full ? 'Balance' : 'Remaining balance', full ? 'Paid in full' : money(t.balance))}</table></td></tr></table></td></tr>
   <tr><td style="padding:22px 32px 26px">${para(sign)}</td></tr>
  </table></td></tr></table>`;
  return { subject: `Receipt - Payment of ${money(N(pay.amount))} - Invoice ${inv.number} - ${st.tradeName || ''}`.replace(/ - $/, ''), text: `${intro}\n\nReceipt ${rno}\nDate: ${dateEn(pay.date)}\nInvoice total: ${money(t.total)}\nTotal paid: ${money(t.paid)}\n${full ? 'Balance: Paid in full' : 'Remaining balance: ' + money(t.balance)}\n\n${sign}`, html };
}

export async function reconcile(sb, site) {
  const out = { checked: 0, recorded: [], receipts: 0, errors: [] };
  if (!process.env.COMMAS_API_KEY) return out;
  const { data: rows } = await sb.from('docs').select('coll,id,data').in('coll', ['invoices', 'settings']);
  const st = rows.find(r => r.coll === 'settings' && r.id === 'main')?.data || {};
  for (const r of rows.filter(x => x.coll === 'invoices')) {
    const inv = r.data; if (!inv.commasId || (inv.payments || []).some(p => p.commasId === inv.commasId)) continue;
    if (totals(inv).balance < 0.005) continue;
    out.checked++;
    try {
      if (!(await commasPaid(inv.commasId))) continue;
      // read again right before writing: the app may have recorded it in the meantime
      const { data: fresh } = await sb.from('docs').select('data').eq('coll', 'invoices').eq('id', r.id).maybeSingle();
      const cur = fresh?.data || inv; if ((cur.payments || []).some(p => p.commasId === cur.commasId)) continue;
      const pay = { date: todayET(), amount: N(cur.commasAmt), method: 'Card (Commas) · online payment', commasId: cur.commasId };
      cur.payments = [...(cur.payments || []), pay]; cur.payLink = ''; cur.commasUrl = ''; cur.updatedAt = new Date().toISOString();
      let client = null; if (cur.clientId) { const c = await sb.from('docs').select('data').eq('coll', 'clients').eq('id', cur.clientId).maybeSingle(); client = c.data?.data || null; }
      if (st.autoReceipt !== '' && client?.email) {
        try { const m = receipt(cur, pay, client, st, site); await sendGmail(sb, { to: client.email, subject: m.subject, text: m.text, html: m.html }); pay.receiptAt = new Date().toISOString(); pay.receiptTo = client.email; out.receipts++; }
        catch (e) { out.errors.push('receipt ' + cur.number + ': ' + e.message); }
      }
      await sb.from('docs').upsert({ coll: 'invoices', id: r.id, data: cur, updated_at: cur.updatedAt });
      if (cur.projectId) {
        const p = await sb.from('docs').select('data').eq('coll', 'projects').eq('id', cur.projectId).maybeSingle();
        if (p.data?.data) { const pr = p.data.data; pr.payments = (pr.payments || []).filter(x => x.invoiceId !== r.id); cur.payments.forEach(x => { if (N(x.amount)) pr.payments.push({ date: x.date, amount: x.amount, note: `${cur.number}${x.method ? ' · ' + x.method : ''}`, invoiceId: r.id }); }); pr.updatedAt = cur.updatedAt; await sb.from('docs').upsert({ coll: 'projects', id: cur.projectId, data: pr, updated_at: cur.updatedAt }); }
      }
      out.recorded.push(cur.number);
      try { await sendGmail(sb, { subject: `Paid: ${money(N(pay.amount))} on invoice ${cur.number}${client?.name ? ' - ' + client.name : ''}`, text: `${client?.name || 'Your client'} paid ${money(N(pay.amount))} on invoice ${cur.number}. Kuadra recorded the payment${pay.receiptAt ? ' and emailed the receipt' : ''}.\n\n${site}/#facturas`, html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#0B1B33"><p style="font-size:16px"><b>${h(client?.name || 'Your client')}</b> paid <b>${money(N(pay.amount))}</b> on invoice <b>${h(cur.number)}</b>.</p><p style="font-size:14px;color:#44536B">Kuadra recorded the payment${pay.receiptAt ? ' and emailed the receipt' : ''}.</p><p><a href="${h(site)}/#facturas">Open Kuadra</a></p></div>` }); } catch (_) {}
    } catch (e) { out.errors.push((inv.number || r.id) + ': ' + e.message); }
  }
  return out;
}
