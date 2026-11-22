// Records that a client opened an email or a link. Kept in its own collection ("views", one row per
// estimate or invoice) so it never overwrites the document the owner may be editing.
export async function recordView(sb, coll, docId, kind) {
  if (!coll || !docId) return;
  try {
    const { data } = await sb.from('docs').select('data').eq('coll', 'views').eq('id', docId).maybeSingle();
    const v = data?.data || { coll, count: 0, payClicks: 0, opens: [] };
    const now = new Date().toISOString();
    if (kind === 'pay') { v.payClicks = (v.payClicks || 0) + 1; v.lastPayClick = now; if (!v.first) v.first = now; }
    else {
      // mail apps often load the same image twice in a row: count it once
      if (v.last && Date.now() - new Date(v.last).getTime() < 30000) return;
      v.count = (v.count || 0) + 1; v.first = v.first || now; v.last = now; v.opens = [...(v.opens || []), now].slice(-20);
    }
    v.coll = coll;
    await sb.from('docs').upsert({ coll: 'views', id: docId, data: v, updated_at: now });
  } catch (_) { /* tracking must never break the page or the email */ }
}

export function shareTarget(share) {
  if (!share) return null;
  if (share.kind === 'track') return { coll: share.coll, docId: share.docId };
  if (share.estimateId) return { coll: 'estimates', docId: share.estimateId };
  return null;
}
