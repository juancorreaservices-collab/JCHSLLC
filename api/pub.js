// One function for the small public endpoints (the Hobby plan allows 12 functions per deployment):
//   fn=track  the 1x1 image in emails and the Pay Now redirect   (/o/<token>, /p/<token>)
//   fn=hook   Commas tells Kuadra a checkout was paid
//   fn=cron   the daily job (payments, backup, overdue digest)
import track from '../lib/h/track.js';
import hook from '../lib/h/hook.js';
import cron from '../lib/h/cron.js';

export default async function handler(req, res) {
  const fn = String(req.query.fn || '');
  if (fn === 'track') return track(req, res);
  if (fn === 'hook') return hook(req, res);
  if (fn === 'cron') return cron(req, res);
  res.status(404).end();
}
