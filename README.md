# github-dashboard-backend

Collects **push** and **pull-request** activity from your GitHub repos and serves it as JSON for the [dashboard frontend](../github-dashboard-frontend). Data arrives two ways:

- **Webhooks** — GitHub POSTs to `/webhook` in real time.
- **Polling** — every minute the server pulls the GitHub Events API to backfill anything missed.

Plain Node + Express. Only two dependencies (`express`, `cors`). No database — events live in memory (see note below).

## API

| Route | Purpose |
|---|---|
| `GET /api/health` | Liveness + configured repos |
| `GET /api/stats` | Open PRs, merged/pushes/commits today, contributors |
| `GET /api/series` | Hourly push vs PR counts for the last 24h (chart) |
| `GET /api/messages` | Higher-signal items (merges, force-pushes, new PRs) |
| `GET /api/events?limit=&type=` | Recent normalized events (`type` = `push` \| `pull_request`) |
| `POST /webhook` | GitHub webhook receiver (verifies the signature) |

## Environment variables

Set these in **Render → your service → Environment**. Never commit them. See `.env.example`.

| Var | Required | Notes |
|---|---|---|
| `GITHUB_TOKEN` | for private repos | Fine-grained PAT, read-only |
| `WEBHOOK_SECRET` | recommended | Must match the secret on the GitHub webhook |
| `REPOS` | yes (for polling) | `owner/name,owner/name` |
| `ALLOWED_ORIGIN` | recommended | Your frontend URL, locks down CORS |
| `POLL_INTERVAL` | no | Milliseconds, default `60000` |
| `PORT` | no | Render sets this automatically |

## Run locally

```bash
cp .env.example .env     # then fill in real values
npm install
npm run dev              # auto-restarts on change
# open http://localhost:10000/api/health
```

## Note on persistence

Events are stored in RAM, so they reset on restart — and on Render's free tier the
service spins down after 15 minutes idle. That's fine for a live activity board.
For durable history, replace the functions in `src/store.js` with a
[Render Postgres](https://render.com/docs/databases) datastore; nothing else needs to change.

Full setup walkthrough: see **GUIDE.md** in the frontend repo (or wherever you saved it).
