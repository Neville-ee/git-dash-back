// src/server.js
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import {
  addEvent,
  getEvents,
  getStats,
  getSeries,
  getMessages,
} from './store.js';
import {
  pollAllRepos,
  normalizePushWebhook,
  normalizePullRequestWebhook,
  configuredRepos,
} from './github.js';

const app = express();
const PORT = process.env.PORT || 10000; // Render injects PORT (default 10000)
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL || 60_000);

// Only let your dashboard's origin read the API. Set ALLOWED_ORIGIN to your
// Render static-site URL in production; falls back to "*" for local testing.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({ origin: ALLOWED_ORIGIN }));

// We need the raw body to verify the webhook signature, so capture it here.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ---- Webhook receiver -----------------------------------------------------

function verifySignature(req) {
  if (!WEBHOOK_SECRET) return true; // no secret set => skip (not recommended)
  const sig = req.get('X-Hub-Signature-256') || '';
  const expected =
    'sha256=' +
    crypto.createHmac('sha256', WEBHOOK_SECRET).update(req.rawBody).digest('hex');
  // timingSafeEqual throws on length mismatch, so guard first.
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

app.post('/webhook', (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).json({ error: 'invalid signature' });
  }
  const event = req.get('X-GitHub-Event');
  try {
    if (event === 'push') {
      addEvent(normalizePushWebhook(req.body));
    } else if (event === 'pull_request') {
      addEvent(normalizePullRequestWebhook(req.body));
    } else if (event === 'ping') {
      return res.json({ ok: true, pong: true });
    }
    // Any other event type is acknowledged but ignored.
    res.json({ ok: true });
  } catch (err) {
    console.error('[webhook] error:', err.message);
    res.status(500).json({ error: 'processing failed' });
  }
});

// ---- Read API (the frontend polls these) ----------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, repos: configuredRepos, time: new Date().toISOString() });
});

app.get('/api/stats', (_req, res) => res.json(getStats()));
app.get('/api/series', (_req, res) => res.json(getSeries()));
app.get('/api/messages', (_req, res) => res.json(getMessages({ limit: 20 })));

app.get('/api/events', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const type = req.query.type; // optional: 'push' | 'pull_request'
  res.json(getEvents({ limit, type }));
});

app.get('/', (_req, res) =>
  res.json({ service: 'github-dashboard-backend', see: '/api/health' })
);

// ---- Start ----------------------------------------------------------------

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend listening on :${PORT}`);
  console.log(`Configured repos: ${configuredRepos.join(', ') || '(none)'}`);
  // Prime the store immediately, then poll on an interval.
  pollAllRepos();
  setInterval(pollAllRepos, POLL_INTERVAL);
});
