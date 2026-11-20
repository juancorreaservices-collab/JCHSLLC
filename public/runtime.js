/* Kuadra standalone runtime.
   The app talks to `window.claude.use(name)`. On Vercel this file provides that
   interface on top of Supabase (login, data, files) and the /api functions
   (AI, Gmail, Commas). */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const err = (code, message) => Object.assign(new Error(message || code), { code });
  let sb = null, cfg = null, session = null;
  let readyResolve; const ready = new Promise(r => (readyResolve = r));

  /* ---------- Login screen ---------- */
  const K_ICON = '<svg viewBox="0 0 1254 1254" width="64" height="64" aria-hidden="true"><defs><linearGradient id="lbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#03112e"/><stop offset="1" stop-color="#01040d"/></linearGradient><linearGradient id="lst" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2fc3ff"/><stop offset=".45" stop-color="#1683ff"/><stop offset=".75" stop-color="#0638d6"/><stop offset="1" stop-color="#0a1a8a"/></linearGradient><linearGradient id="llg" x1=".15" y1=".2" x2="1" y2="1"><stop offset="0" stop-color="#06107a"/><stop offset=".3" stop-color="#0b4fe6"/><stop offset=".65" stop-color="#18a6ff"/><stop offset="1" stop-color="#5ff0ff"/></linearGradient><linearGradient id="lar" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#1a8cff"/><stop offset=".5" stop-color="#22b8ff"/><stop offset="1" stop-color="#7ef6ff"/></linearGradient></defs><rect x="30" y="30" width="1194" height="1194" rx="250" fill="url(#lbg)"/><path d="M463 310 L465 950 L277 950 L277 465 C277 425 295 395 325 380 Z" fill="url(#lst)"/><path d="M277 950 C290 800 450 628 650 624 C740 622 790 660 820 690 L1043 933 L822 933 C780 933 752 918 730 896 L578 745 L452 872 C400 922 350 950 292 950 Z" fill="url(#llg)"/><path d="M465 640 C560 560 720 470 843 381 L752 367 L1003 302 L1003 505 L948 445 C870 515 790 595 690 612 C610 624 530 622 465 640 Z" fill="url(#lar)"/></svg>';
  const css = document.createElement('style');
  css.textContent = `
  #kgate{position:fixed;inset:0;z-index:1000;background:#0b1b33;display:flex;align-items:center;justify-content:center;padding:20px;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;color:#e9eef7}
  #kgate .box{width:min(380px,100%);display:flex;flex-direction:column;gap:14px;align-items:stretch}
  #kgate .logo{display:flex;align-items:center;gap:14px;justify-content:center;margin-bottom:10px}
  #kgate .logo span{font-weight:300;font-size:26px;letter-spacing:.32em}
  #kgate label{display:flex;flex-direction:column;gap:6px;font-size:13px;color:#a9b8d0}
  #kgate input{font:inherit;font-size:16px;padding:12px 14px;border-radius:10px;border:1px solid #2a3e5f;background:#0f2443;color:#fff;outline:none}
  #kgate input:focus{border-color:#3d7bff}
  #kgate button{font:inherit;font-size:15px;font-weight:600;padding:12px 14px;border-radius:10px;border:0;cursor:pointer}
  #kgate .go{background:#2f6bff;color:#fff}
  #kgate .go:disabled{opacity:.6;cursor:default}
  #kgate .alt{background:none;color:#9fb6de;font-weight:500;font-size:14px;padding:6px}
  #kgate .msg{font-size:14px;line-height:1.45;border-radius:10px;padding:10px 12px;background:#132a4d;color:#dbe6f7}
  #kgate .msg.bad{background:#3a1820;color:#ffc9d0}
  #kgate .msg:empty{display:none}
  #kacct{position:fixed;inset:0;z-index:900;background:rgba(5,12,25,.55);display:flex;align-items:center;justify-content:center;padding:16px}
  #kacct .box{background:var(--surface,#fff);color:var(--ink,#15171a);border-radius:14px;width:min(460px,100%);max-height:90vh;overflow:auto;padding:20px;display:flex;flex-direction:column;gap:14px;box-shadow:0 20px 60px rgba(0,0,0,.3)}
  #kacct h3{margin:0;font-size:18px}
  #kacct h4{margin:6px 0 0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3,#7b828c)}
  #kacct .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  #kacct .row>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:14px}
  #kacct small{color:var(--ink-3,#7b828c);font-size:13px;line-height:1.4}
  .kacct-btn{display:flex;align-items:center;gap:8px;width:100%;background:none;border:0;padding:6px 2px;font:inherit;font-size:12px;color:var(--ink-3,#7b828c);cursor:pointer;text-align:left}
  .kacct-btn:hover{color:var(--ink,#15171a)}
  .kacct-btn b{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`;
  document.head.appendChild(css);

  function gate(html) {
    let g = $('#kgate');
    if (!g) { g = document.createElement('div'); g.id = 'kgate'; document.body.appendChild(g); }
    g.innerHTML = `<div class="box"><div class="logo">${K_ICON}<span>KUADRA</span></div>${html}</div>`;
    return g;
  }
  const ungate = () => $('#kgate')?.remove();

  function loginScreen(mode = 'in', note = '') {
    const title = { in: 'Sign in', up: 'Create account', reset: 'Send link', newpw: 'Save password' }[mode];
    const g = gate(`
      <form id="kform" style="display:flex;flex-direction:column;gap:14px">
        ${mode !== 'newpw' ? '<label>Email<input id="kemail" type="email" autocomplete="username" required></label>' : ''}
        ${mode !== 'reset' ? `<label>${mode === 'newpw' ? 'New password' : 'Password'}<input id="kpass" type="password" autocomplete="${mode === 'in' ? 'current-password' : 'new-password'}" minlength="8" required></label>` : ''}
        <div class="msg" id="kmsg">${note}</div>
        <button class="go" type="submit">${title}</button>
      </form>
      ${mode === 'in' ? (cfg && cfg.hasOwner === false ? '<button class="alt" data-m="up">First time: create my account</button>' : '') + '<button class="alt" data-m="reset">Forgot my password</button>' : mode === 'newpw' ? '' : '<button class="alt" data-m="in">I already have an account: sign in</button>'}`);
    g.querySelectorAll('.alt').forEach(b => (b.onclick = () => loginScreen(b.dataset.m)));
    const msg = (t, bad) => { const m = $('#kmsg'); m.textContent = t; m.className = 'msg' + (bad ? ' bad' : ''); };
    $('#kform').onsubmit = async ev => {
      ev.preventDefault();
      const btn = g.querySelector('.go'); btn.disabled = true; msg('One moment…');
      const email = $('#kemail')?.value.trim(), password = $('#kpass')?.value;
      try {
        if (mode === 'in') { const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; }
        else if (mode === 'up') {
          const r = await fetch('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.message || 'Could not create the account.');
          const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error;
        } else if (mode === 'reset') {
          const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
          if (error) throw error; msg('Si ese email tiene cuenta, te llegó un enlace para cambiar la contraseña.'); btn.disabled = false; return;
        } else if (mode === 'newpw') {
          const { error } = await sb.auth.updateUser({ password }); if (error) throw error;
          history.replaceState(null, '', location.pathname); await enter(); return;
        }
      } catch (e) {
        const t = /invalid login/i.test(e.message) ? 'Email o contraseña incorrectos.' : /not confirmed/i.test(e.message) ? 'Confirma tu email primero: revisa tu correo.' : /already registered/i.test(e.message) ? 'Ese email ya tiene cuenta. Toca "Ya tengo cuenta".' : /rate limit|security purposes/i.test(e.message) ? 'Demasiados intentos. Espera un minuto y prueba otra vez.' : (e.message || 'No se pudo entrar.');
        msg(t, true); btn.disabled = false;
      }
    };
    ($('#kemail') || $('#kpass'))?.focus();
  }

  function setCookie(tok) {
    document.cookie = tok ? `kuadra_token=${encodeURIComponent(tok)}; Path=/; Max-Age=3600; SameSite=Lax; Secure` : 'kuadra_token=; Path=/; Max-Age=0; SameSite=Lax; Secure';
  }

  let entered = false;
  async function enter() {
    const { data } = await sb.auth.getSession(); session = data.session;
    if (!session) return loginScreen(cfg.hasOwner === false ? 'up' : 'in', cfg.hasOwner === false ? 'Bienvenido. Crea tu cuenta de dueño: escribe tu email y una contraseña de 8 letras o más.' : '');
    setCookie(session.access_token);
    const { data: ok, error } = await sb.rpc('claim_owner');
    if (error) return gate(`<div class="msg bad">La base de datos todavía no está lista (${error.message}). Falta correr el archivo supabase/schema.sql en Supabase.</div><button class="alt" id="kout">Cerrar sesión</button>`).querySelector('#kout').addEventListener('click', signOut);
    if (!ok) return gate(`<div class="msg bad">La cuenta ${session.user.email} no tiene acceso a esta Kuadra. Pídele al dueño que te agregue en Cuenta → Usuarios.</div><button class="alt" id="kout">Entrar con otra cuenta</button>`).querySelector('#kout').addEventListener('click', signOut);
    ungate();
    if (!entered) { entered = true; readyResolve(); accountButton(); }
  }
  async function signOut() { await sb.auth.signOut(); setCookie(''); location.reload(); }

  async function api(path, body) {
    const { data } = await sb.auth.getSession(); const tok = data.session?.access_token;
    let r;
    try { r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify(body || {}) }); }
    catch (_) { throw err('server_unavailable', 'Sin conexión'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw err(j.code || (r.status === 413 ? 'prompt_too_large' : 'upstream_error'), j.message || `HTTP ${r.status}`);
    return j;
  }

  /* ---------- db: Supabase table `docs` with live sync ---------- */
  function makeDb() {
    const cache = {}, subs = {}, loaded = {}, timers = {};
    const snap = c => ({ docs: [...(cache[c] || new Map())].map(([id, d]) => ({ id, exists: true, data: () => d, metadata: { fromCache: false } })), metadata: { fromCache: false } });
    const notify = c => { clearTimeout(timers[c]); timers[c] = setTimeout(() => (subs[c] || []).forEach(f => { try { f(); } catch (e) { console.error(e); } }), 40); };
    async function load(c) {
      if (loaded[c]) return loaded[c];
      return (loaded[c] = (async () => {
        const m = new Map();
        for (let from = 0; ; from += 1000) {
          const { data, error } = await sb.from('docs').select('id,data').eq('coll', c).range(from, from + 999);
          if (error) { loaded[c] = null; throw err('unavailable', error.message); }
          data.forEach(r => m.set(r.id, r.data));
          if (data.length < 1000) break;
        }
        cache[c] = m;
      })());
    }
    sb.channel('kuadra-docs').on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, p => {
      const row = p.eventType === 'DELETE' ? p.old : p.new; const c = row?.coll; if (!c || !cache[c]) return;
      if (p.eventType === 'DELETE') cache[c].delete(row.id);
      else { if (JSON.stringify(cache[c].get(row.id)) === JSON.stringify(row.data)) return; cache[c].set(row.id, row.data); }
      notify(c);
    }).subscribe();
    const wErr = e => err(/row-level|permission|JWT/i.test(e.message) ? 'invalid_argument' : 'unavailable', e.message);
    const docRef = (c, id) => ({
      async set(d) { const data = JSON.parse(JSON.stringify(d)); cache[c]?.set(id, data); const { error } = await sb.from('docs').upsert({ coll: c, id, data, updated_at: new Date().toISOString() }); if (error) throw wErr(error); },
      async delete() { cache[c]?.delete(id); const { error } = await sb.from('docs').delete().eq('coll', c).eq('id', id); if (error) throw wErr(error); },
      onSnapshot(cb, onErr) {
        const fire = () => { const d = cache[c]?.get(id); cb({ id, exists: d !== undefined, data: () => d, metadata: { fromCache: false } }); };
        (subs[c] ||= []).push(fire); load(c).then(fire).catch(e => onErr?.(e));
        return () => { subs[c] = subs[c].filter(f => f !== fire); };
      },
    });
    return {
      collection: c => ({
        doc: id => docRef(c, id),
        onSnapshot(cb, onErr) {
          const fire = () => cb(snap(c));
          (subs[c] ||= []).push(fire); load(c).then(fire).catch(e => onErr?.(e));
          return () => { subs[c] = subs[c].filter(f => f !== fire); };
        },
      }),
      doc: path => { const [c, id] = path.split('/'); return docRef(c, id); },
      _all: async () => { const out = {}; for (let from = 0; ; from += 1000) { const { data, error } = await sb.from('docs').select('coll,id,data').range(from, from + 999); if (error) throw wErr(error); data.forEach(r => ((out[r.coll] ||= {})[r.id] = r.data)); if (data.length < 1000) break; } return out; },
      _import: async all => { const rows = []; for (const [coll, docs] of Object.entries(all)) for (const [id, data] of Object.entries(docs || {})) rows.push({ coll, id, data, updated_at: new Date().toISOString() }); for (let i = 0; i < rows.length; i += 200) { const { error } = await sb.from('docs').upsert(rows.slice(i, i + 200)); if (error) throw wErr(error); } return rows.length; },
    };
  }

  /* ---------- mcp: Gmail through /api/gmail ---------- */
  function makeMcp() {
    const watchers = new Set();
    const raw = (server, tool, input) => api('/api/gmail', { tool, input });
    // Reads are shared: the same search asked several times at once becomes one request,
    // and its answer is reused for a minute.
    const READS = new Set(['search_threads', 'get_thread', 'status']);
    const cache = new Map();
    const cached = (server, tool, input, maxAge = 60000, force = false) => {
      const k = tool + '|' + JSON.stringify(input || {}); const hit = cache.get(k);
      if (hit && (hit.pending || (hit.failed ? Date.now() - hit.at < 15000 : !force && Date.now() - hit.at < maxAge))) return hit.p;
      const e = { at: Date.now(), pending: true };
      // a failure is remembered for 15 seconds, so redraws of the screen do not hammer Gmail
      e.p = raw(server, tool, input).then(r => { e.pending = false; e.at = Date.now(); return r; }, err => { e.pending = false; e.failed = true; e.at = Date.now(); throw err; });
      e.p.catch(() => {});
      cache.set(k, e); if (cache.size > 60) cache.delete(cache.keys().next().value);
      return e.p;
    };
    const callTool = (server, tool, input) => READS.has(tool) ? cached(server, tool, input, 20000) : raw(server, tool, input).then(r => { cache.clear(); return r; });
    return {
      callTool,
      watchTool(server, tool, input, cb, opts = {}) {
        let alive = true, timer;
        const run = async (force) => {
          if (!alive) return;
          let failed = false;
          try { const result = await cached(server, tool, input, opts.cache?.staleTime ?? 60000, force === true); if (alive) cb({ type: 'data', result }); }
          catch (error) { failed = true; if (alive) cb({ type: 'error', error }); }
          // after an error wait longer, so a busy Gmail is not hit again right away
          if (alive && opts.refetchInterval) { clearTimeout(timer); timer = setTimeout(() => run(true), failed ? Math.max(opts.refetchInterval, 180000) : opts.refetchInterval); }
        };
        const w = { run }; watchers.add(w); run();
        return () => { alive = false; clearTimeout(timer); watchers.delete(w); };
      },
      async invalidate() { cache.clear(); watchers.forEach(w => w.run(true)); },
    };
  }

  /* ---------- sample: Claude through /api/ai (tool loop runs here) ---------- */
  async function toJpegB64(blob) {
    const bmp = await createImageBitmap(blob).catch(() => null);
    if (!bmp) throw err('image_rejected', 'Unreadable image');
    const sc = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8).split(',')[1];
  }
  function makeSample() {
    async function run(input, opts = {}) {
      const signal = opts.signal; const stop = () => { if (signal?.aborted) throw err('cancelled'); };
      const turns = typeof input === 'string' ? [{ role: 'user', content: input }] : input.map(t => ({ role: t.role, content: t.content }));
      const imgs = opts.images ? [].concat(opts.images instanceof FileList ? [...opts.images] : opts.images) : [];
      if (imgs.length) {
        const last = turns[turns.length - 1]; const blocks = [];
        for (const b of imgs.slice(0, 6)) blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await toJpegB64(b) } });
        last.content = [...blocks, { type: 'text', text: String(last.content) }];
      }
      const tools = (opts.tools || []).map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema || { type: 'object', properties: {} } }));
      let text = '';
      for (let round = 0; round < 8; round++) {
        stop();
        const r = await api('/api/ai', { messages: turns, tools });
        stop();
        text = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
        if (text) opts.onText?.({ text, delta: text });
        const calls = (r.content || []).filter(b => b.type === 'tool_use');
        if (r.stop_reason !== 'tool_use' || !calls.length) return { text, truncated: r.stop_reason === 'max_tokens' };
        turns.push({ role: 'assistant', content: r.content });
        const results = [];
        for (const c of calls) {
          const t = (opts.tools || []).find(x => x.name === c.name);
          try { const out = t ? await t.execute(c.input, { signal }) : 'Unknown tool'; results.push({ type: 'tool_result', tool_use_id: c.id, content: typeof out === 'string' ? out : JSON.stringify(out ?? null) }); }
          catch (e) { results.push({ type: 'tool_result', tool_use_id: c.id, content: String(e?.message || e), is_error: true }); }
        }
        turns.push({ role: 'user', content: results });
      }
      return { text, truncated: true };
    }
    const sample = (input, opts) => run(input, opts);
    sample.json = async (input, opts) => {
      const { text } = await run(input, opts);
      if (!text.trim()) throw err('empty_completion');
      const t = text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '');
      const a = t.indexOf('{'), b = t.lastIndexOf('}');
      try { return JSON.parse(a >= 0 && b > a ? t.slice(a, b + 1) : t); } catch (_) { throw Object.assign(err('invalid_json'), { text }); }
    };
    sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 6, maxInputBytes: 20e6, mediaTypes: ['image/jpeg', 'image/png', 'image/webp'] }, tools: { maxCount: 8 } });
    return sample;
  }

  /* ---------- dictation: the browser's speech recognition ---------- */
  function makeDictation() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return null;
    const on = { partial: [], final: [], state: [] }; let rec = null, want = false;
    const emit = (k, v) => on[k].forEach(f => { try { f(v); } catch (_) {} });
    const sub = k => f => { on[k].push(f); return () => { on[k] = on[k].filter(x => x !== f); }; };
    return {
      onPartial: sub('partial'), onFinal: sub('final'), onState: sub('state'), active: () => want,
      start() {
        return new Promise((ok, bad) => {
          if (want) return ok();
          rec = new SR(); rec.lang = (navigator.language || '').startsWith('en') ? 'en-US' : 'es-US'; rec.continuous = true; rec.interimResults = true; want = true;
          let started = false;
          rec.onstart = () => { started = true; emit('state', { state: 'listening' }); ok(); };
          rec.onresult = ev => { let interim = ''; for (let i = ev.resultIndex; i < ev.results.length; i++) { const r = ev.results[i]; if (r.isFinal) emit('final', { text: r[0].transcript.trim() }); else interim += r[0].transcript; } emit('partial', { text: interim }); };
          rec.onerror = ev => { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { want = false; if (!started) bad(err('not_granted')); } };
          rec.onend = () => { if (want && started) { try { rec.start(); return; } catch (_) {} } want = false; emit('state', { state: 'idle', reason: 'stopped' }); if (!started) bad(err('unavailable')); };
          try { rec.start(); } catch (e) { want = false; bad(err('unavailable')); }
        });
      },
      async stop() { want = false; try { rec?.stop(); } catch (_) {} },
    };
  }

  /* ---------- assets: private Supabase Storage bucket ---------- */
  function makeAssets() {
    return {
      async upload(blob, o = {}) {
        const id = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now()).replace(/-/g, '');
        const contentType = o.type || blob.type || 'application/octet-stream';
        if (blob.size > 25e6) throw err('too_large');
        const { error } = await sb.storage.from('files').upload(id, blob, { contentType, upsert: false });
        if (error) throw err(/size|large/i.test(error.message) ? 'too_large' : /mime|type/i.test(error.message) ? 'unsupported_type' : /row-level|polic/i.test(error.message) ? 'not_granted' : 'quota_or_state', error.message);
        return { id, url: '/_blob/' + id, contentType, sizeBytes: blob.size };
      },
      async delete(id) { await sb.storage.from('files').remove([String(id).replace(/^.*\/_blob\//, '')]); },
    };
  }

  const downloads = { async save({ filename, data }) { const b = data instanceof Blob ? data : new Blob([data], { type: 'text/plain;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = filename || 'kuadra'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); } };

  const commas = {
    create: p => api('/api/commas', { action: 'create', ...p }),
    status: id => api('/api/commas', { action: 'status', id }),
  };

  /* ---------- Account panel: users, Gmail, backup, sign out ---------- */
  let db = null;
  function accountButton() {
    const foot = $('.side-foot'); if (!foot || $('.kacct-btn')) return;
    const b = document.createElement('button'); b.className = 'kacct-btn'; b.type = 'button';
    b.innerHTML = `<b>${session.user.email}</b>`; b.title = 'Cuenta'; b.onclick = accountPanel; foot.prepend(b);
    const mob = $('.mob-top .dbstate'); if (mob) { mob.style.cursor = 'pointer'; mob.onclick = accountPanel; }
  }
  const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function accountPanel() {
    $('#kacct')?.remove();
    const w = document.createElement('div'); w.id = 'kacct'; document.body.appendChild(w);
    w.onclick = e => { if (e.target === w) w.remove(); };
    const { data: users } = await sb.from('kuadra_users').select('email').order('added_at');
    let gmail = null; if (cfg.features.gmail) { try { gmail = (await api('/api/gmail', { tool: 'status' })).payload; } catch (e) { gmail = { connected: false, code: e.code }; } }
    const f = cfg.features;
    w.innerHTML = `<div class="box">
      <div class="row"><h3 style="flex:1">Cuenta</h3><button class="btn sm" data-a="close">Cerrar</button></div>
      <div class="row"><span>${escH(session.user.email)}</span><button class="btn sm" data-a="out">Cerrar sesión</button></div>
      <h4>Usuarios con acceso</h4>
      ${(users || []).map(u => `<div class="row"><span>${escH(u.email)}</span>${u.email.toLowerCase() !== session.user.email.toLowerCase() ? `<button class="btn sm ghost" data-a="deluser" data-e="${escH(u.email)}">Quitar</button>` : ''}</div>`).join('')}
      <div class="row"><input class="in" id="knew" type="email" placeholder="email@ejemplo.com" style="flex:1"><button class="btn sm" data-a="adduser">Agregar</button></div>
      <small>Por ahora las cuentas nuevas están bloqueadas: nadie más puede crear una cuenta.</small>
      <h4>Conexiones</h4>
      <div class="row"><span>Gmail: ${!f.gmail ? 'falta configurar Google en Vercel' : gmail?.connected ? 'conectado · ' + escH(gmail.email) : gmail?.code === 'needs_reauth' ? 'Google rechazó la contraseña de aplicación' : 'sin conectar'}</span>${f.gmail && f.gmailMode !== 'app_password' ? `<button class="btn sm" data-act="gmail-connect">${gmail?.connected ? 'Reconectar' : 'Conectar Gmail'}</button>` : ''}</div>
      <div class="row"><span>IA (Claude): ${f.ai ? 'activa' : 'falta la clave en Vercel'}</span></div>
      <div class="row"><span>Commas (pagos): ${f.commas ? 'conectado' : 'falta la clave en Vercel'}</span></div>
      <h4>Respaldo</h4>
      <div class="row"><button class="btn sm" data-a="export">Descargar respaldo</button><label class="btn sm">Importar respaldo<input type="file" id="kimp" accept="application/json,.json" hidden></label></div>
      <small id="kamsg">El respaldo guarda todos tus datos en un archivo. Importar agrega y actualiza; no borra nada.</small>
    </div>`;
    const say = t => ($('#kamsg').textContent = t);
    w.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
      if (a === 'close') w.remove();
      if (a === 'out') signOut();
      if (a === 'adduser') { const em = $('#knew').value.trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return say('Escribe un email válido.'); const { error } = await sb.from('kuadra_users').upsert({ email: em }); if (error) return say(error.message); accountPanel(); }
      if (a === 'deluser') { await sb.from('kuadra_users').delete().eq('email', e.target.closest('[data-e]').dataset.e); accountPanel(); }
      if (a === 'export') { try { const all = await db._all(); await downloads.save({ filename: `kuadra-respaldo-${new Date().toISOString().slice(0, 10)}.json`, data: new Blob([JSON.stringify({ kuadra: 1, at: new Date().toISOString(), data: all })], { type: 'application/json' }) }); say('Respaldo descargado.'); } catch (x) { say('No se pudo descargar: ' + x.message); } }
    });
    $('#kimp').onchange = async ev => {
      const file = ev.target.files[0]; if (!file) return;
      try { const j = JSON.parse(await file.text()); const data = j.data || j; if (typeof data !== 'object') throw new Error('archivo inválido'); say('Importando…'); const n = await db._import(data); say(`Listo: ${n} registros importados. Recargando…`); setTimeout(() => location.reload(), 900); }
      catch (x) { say('No se pudo importar: ' + x.message); }
    };
  }
  document.addEventListener('click', async e => {
    if (!e.target.closest('[data-act="gmail-connect"]')) return;
    const { data } = await sb.auth.getSession(); setCookie(data.session?.access_token || '');
    location.href = '/api/google';
  });

  /* ---------- window.claude ---------- */
  window.claude = {
    standalone: true,
    async use(name) {
      await ready;
      switch (name) {
        case 'db': return (db ||= makeDb());
        case 'mcp': return cfg.features.gmail ? (window.claude._mcp ||= makeMcp()) : null;
        case 'sample': return cfg.features.ai ? (window.claude._sample ||= makeSample()) : null;
        case 'dictation': return (window.claude._dict ||= makeDictation());
        case 'assets': return makeAssets();
        case 'downloads': return downloads;
        case 'commas': return cfg.features.commas ? commas : null;
        default: return null;
      }
    },
  };

  (async () => {
    gate('<div class="msg">Cargando…</div>');
    try { cfg = await fetch('/api/config', { cache: 'no-store' }).then(r => r.json()); } catch (_) { cfg = null; }
    if (!cfg?.supabaseUrl || !cfg?.supabaseAnonKey || !window.supabase) {
      return gate('<div class="msg bad">Kuadra todavía no está conectada a su base de datos. Faltan SUPABASE_URL y SUPABASE_ANON_KEY en Vercel → Settings → Environment Variables.</div>');
    }
    if (!cfg.schema) {
      gate('<div class="msg">Preparando Kuadra por primera vez…</div>');
      const r = await fetch('/api/setup', { method: 'POST' }).then(async x => ({ ok: x.ok, j: await x.json().catch(() => ({})) })).catch(() => ({ ok: false, j: {} }));
      if (!r.ok) return gate(`<div class="msg bad">No se pudo preparar la base de datos${r.j.message ? ': ' + r.j.message : '.'}</div>`);
      cfg = await fetch('/api/config', { cache: 'no-store' }).then(x => x.json());
      if (cfg.hasOwner == null) cfg.hasOwner = false;
    }
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    const recovering = /type=recovery/.test(location.hash);
    sb.auth.onAuthStateChange((ev, s) => {
      session = s; setCookie(s?.access_token || '');
      if (ev === 'PASSWORD_RECOVERY') loginScreen('newpw', 'Escribe tu nueva contraseña.');
      else if (ev === 'SIGNED_IN' && !entered && !recovering) setTimeout(enter, 0);
      else if (ev === 'SIGNED_OUT' && entered) location.reload();
    });
    if (!recovering) await enter();
  })();
})();
