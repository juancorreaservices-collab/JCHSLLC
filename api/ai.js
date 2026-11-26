import Anthropic from '@anthropic-ai/sdk';
import { requireUser } from '../lib/auth.js';

const MODEL = process.env.KUADRA_AI_MODEL || 'claude-opus-5-5';

// One model round. The browser owns the tool loop: it runs the tools Claude asks for
// (catalog search) and calls again with the results, sending earlier content back unchanged.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ code: 'invalid_request' });
  const user = await requireUser(req, res); if (!user) return;

  // The key can live in Vercel (ANTHROPIC_API_KEY) or be pasted once inside Kuadra (Account → Connections),
  // where it is kept in a server-only table the browser cannot read.
  if (req.body?.action === 'set_key') {
    const key = String(req.body.key || '').trim();
    if (!/^sk-ant-[\w-]{20,}$/.test(key)) return res.status(400).json({ code: 'invalid_request', message: 'That does not look like an Anthropic API key. It starts with sk-ant-' });
    try { await new Anthropic({ apiKey: key }).models.list({ limit: 1 }); }
    catch (e) { return res.status(400).json({ code: 'invalid_request', message: e instanceof Anthropic.AuthenticationError ? 'Anthropic rejected this key. Copy it again from the console.' : 'Could not check the key with Anthropic: ' + (e?.message || 'error') }); }
    await user.sb.from('secrets').upsert({ key: 'anthropic', value: { key }, updated_at: new Date().toISOString() });
    return res.status(200).json({ ok: true });
  }
  if (req.body?.action === 'clear_key') { await user.sb.from('secrets').delete().eq('key', 'anthropic'); return res.status(200).json({ ok: true }); }

  let apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) { const { data } = await user.sb.from('secrets').select('value').eq('key', 'anthropic').maybeSingle(); apiKey = data?.value?.key || ''; }
  if (!apiKey) return res.status(503).json({ code: 'sampling_disabled', message: 'The Claude API key is not set' });

  const { messages, tools } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ code: 'invalid_request' });

  const client = new Anthropic({ apiKey });
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      ...(Array.isArray(tools) && tools.length ? { tools } : {}),
      messages,
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') return res.status(422).json({ code: 'refused', message: 'Claude declined this request' });
    res.status(200).json({ content: msg.content, stop_reason: msg.stop_reason, model: msg.model });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ code: 'rate_limited', message: e.message });
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return res.status(503).json({ code: 'sampling_disabled', message: 'The Claude API key was rejected' });
    if (e instanceof Anthropic.BadRequestError) {
      const big = /too long|too large|exceed/i.test(e.message || '');
      return res.status(400).json({ code: big ? 'prompt_too_large' : 'invalid_request', message: e.message });
    }
    if (e instanceof Anthropic.APIError) return res.status(502).json({ code: 'upstream_error', message: e.message });
    res.status(500).json({ code: 'upstream_error', message: String(e?.message || e) });
  }
}
