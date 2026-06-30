# GitHub Activity Dashboard — End-to-End Setup Guide

A two-part system that shows your repos' **push** and **pull-request** activity on a live dashboard with interactive tiles and charts that refresh every 30 seconds.

```
                       (1) events happen
        ┌─────────────────────────────────────────────┐
        │                  GitHub                       │
        │   pushes • pull requests • merges             │
        └───────────────┬───────────────┬──────────────┘
                        │ webhook        │ API polling
                        │ (real time)    │ (every 60s, backfill)
                        ▼                ▼
              ┌──────────────────────────────────┐
              │   BACKEND  (Node + Express)        │   ← deployed on Render
              │   • receives + normalizes events   │      as a Web Service
              │   • holds GITHUB_TOKEN (secret)    │      repo: dashboard-backend
              │   • serves /api/* JSON             │
              └──────────────┬─────────────────────┘
                             │ HTTPS, polled every 30s
                             ▼
              ┌──────────────────────────────────┐
              │   FRONTEND  (HTML/CSS/JS)          │   ← deployed on Render
              │   • tiles, charts, live feed       │      as a Static Site
              │   • knows only the backend URL     │      repo: dashboard-frontend
              └──────────────────────────────────┘
```

### One thing to clear up first

You mentioned hosting the dashboard on Render and the backend on GitHub. Those are two different jobs:

- **GitHub stores your source code** (the two repos).
- **Render runs the deployed apps** (it pulls each repo from GitHub and serves it at a live URL).

So both repos live on GitHub, and **both** get deployed to Render — the backend as a *Web Service*, the frontend as a *Static Site*. That's the standard split, and it's what this guide sets up.

---

## 0. Tools to install

| Tool | Why | Get it |
|---|---|---|
| **Git** | Push code to GitHub | https://git-scm.com/downloads |
| **Node.js LTS (≥ 20)** | Run/test the backend locally; includes `npm` | https://nodejs.org |
| **A code editor** (VS Code) | Edit `config.js`, env files | https://code.visualstudio.com |
| **GitHub account** | Host the two repos | https://github.com |
| **Render account** | Host both deployed apps (free, no card) | https://render.com |
| **GitHub CLI `gh`** *(optional)* | Create repos from the terminal | https://cli.github.com |

Check your installs:

```bash
git --version
node --version   # v20+ 
npm --version
```

---

## 1. Get the two projects onto your machine

You have two folders: `github-dashboard-backend` and `github-dashboard-frontend`. Put them side by side somewhere, e.g. `~/projects/`.

---

## 2. Create two GitHub repositories

You want **two separate repos** — one per folder.

### Option A — GitHub CLI (fastest)

From inside **each** folder:

```bash
# backend
cd github-dashboard-backend
git init && git add . && git commit -m "Initial backend"
gh repo create github-dashboard-backend --private --source=. --push

# frontend
cd ../github-dashboard-frontend
git init && git add . && git commit -m "Initial frontend"
gh repo create github-dashboard-frontend --public --source=. --push
```

### Option B — GitHub website

1. Go to https://github.com/new → name it `github-dashboard-backend` → **Create repository** (leave it empty, no README).
2. Back in the folder:
   ```bash
   cd github-dashboard-backend
   git init
   git add .
   git commit -m "Initial backend"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/github-dashboard-backend.git
   git push -u origin main
   ```
3. Repeat for `github-dashboard-frontend`.

> **The `.gitignore` already excludes `.env`,** so your secrets never get pushed even if you create a local `.env`. Verify with `git status` before committing — you should *not* see `.env` listed.

---

## 3. Create the GitHub token (this is "the API key")

The backend reads your repos' activity using a **fine-grained Personal Access Token**.

1. GitHub → click your avatar → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. **Repository access** → *Only select repositories* → pick the repo(s) you want to monitor.
3. **Repository permissions** (read-only is all you need):
   - **Metadata**: Read
   - **Contents**: Read
   - **Pull requests**: Read
4. **Generate token** → **copy it now** (GitHub shows it once). It looks like `github_pat_...`.

> Monitoring only **public** repos? A token is optional for reading them, but without one you're capped at 60 API requests/hour. With a token you get 5,000/hour, so create one anyway.

**You do not paste this token into any file or repo.** It goes into Render in the next step.

---

## 4. Deploy the backend to Render

1. Sign in at https://render.com → **New +** → **Web Service**.
2. **Connect your GitHub** and pick the **`github-dashboard-backend`** repo.
3. Fill in the form:
   - **Language**: Node
   - **Build command**: `npm install`
   - **Start command**: `npm start`
   - **Instance type**: **Free**
4. Open the **Advanced / Environment Variables** section and add — **this is where the API key goes:**

   | Key | Value |
   |---|---|
   | `GITHUB_TOKEN` | the `github_pat_...` you copied in step 3 |
   | `WEBHOOK_SECRET` | invent a long random string (keep it for step 5) |
   | `REPOS` | `your-username/your-repo,your-org/another-repo` |
   | `ALLOWED_ORIGIN` | leave blank for now; you'll set it in step 6 |
   | `POLL_INTERVAL` | `60000` |

5. **Create Web Service.** Render builds and deploys, then gives you a URL like
   `https://github-dashboard-backend.onrender.com`. **Copy it.**
6. Confirm it's alive: open `https://…onrender.com/api/health` — you should see JSON with `"ok": true`.

> Render injects `PORT` automatically; the app already binds to it on `0.0.0.0`, so you don't set a port yourself.

*(Shortcut: because the repo includes a `render.yaml`, you can instead choose **New + → Blueprint**, point it at the repo, and Render reads the service config from that file — it'll still prompt you to paste the secret values.)*

---

## 5. Point a GitHub webhook at the backend (real-time updates)

Polling already works, but webhooks make the dashboard update the instant something happens.

For **each** repo you're monitoring:

1. Repo → **Settings** → **Webhooks** → **Add webhook**.
2. **Payload URL**: `https://github-dashboard-backend.onrender.com/webhook`
3. **Content type**: `application/json`
4. **Secret**: paste the **same** `WEBHOOK_SECRET` you set in Render.
5. **Which events?** → *Let me select individual events* → tick **Pushes** and **Pull requests**.
6. **Add webhook.** GitHub sends a `ping`; the green check means it reached your backend.

> On Render's free tier the backend sleeps after 15 minutes idle, so the first webhook after a quiet spell takes ~30–60s to wake it (GitHub auto-retries). For an always-on backend, upgrade to the $7/mo Starter instance.

---

## 6. Deploy the frontend to Render

1. **Edit `config.js`** in the frontend repo so it points at your backend:
   ```js
   window.DASHBOARD_CONFIG = {
     BACKEND_URL: 'https://github-dashboard-backend.onrender.com',
     POLL_SECONDS: 30,
   };
   ```
   Commit and push:
   ```bash
   git commit -am "Point frontend at backend"
   git push
   ```
2. Render → **New +** → **Static Site** → pick **`github-dashboard-frontend`**.
3. **Publish directory**: `.` &nbsp; (build command stays empty — there's nothing to build).
4. **Create Static Site.** You get a URL like `https://github-dashboard-frontend.onrender.com`.
5. **Close the CORS loop:** go back to the **backend** service → **Environment** → set
   `ALLOWED_ORIGIN` to your frontend URL → save (Render redeploys automatically).

---

## 7. Verify the whole loop

1. Open the frontend URL. The status dot should turn green ("live").
2. In a monitored repo, push a commit or open a pull request.
3. Within ~30 seconds (instantly if the webhook fired), a new row appears in the activity stream, the tiles bump, and the charts move.
4. Click a tile (e.g. **Pushes today**) — the stream filters to that type. Click again to clear.

---

## 8. Where the API key lives (recap)

| Place | Holds the token? |
|---|---|
| Backend repo on GitHub | ❌ never — `.gitignore` blocks `.env` |
| Frontend repo / `config.js` | ❌ never — it only knows the public backend URL |
| **Render backend → Environment** | ✅ **the only place**, as `GITHUB_TOKEN` |
| Your local machine (`.env`) | ✅ optional, for local dev — and git-ignored |

The frontend talks only to your backend; it never sees the GitHub token. If the token ever leaks, revoke it in GitHub Developer settings and paste a new one into Render — no code change needed.

---

## 9. Local development (optional)

```bash
# Terminal 1 — backend
cd github-dashboard-backend
cp .env.example .env          # fill in GITHUB_TOKEN, REPOS, WEBHOOK_SECRET
npm install
npm run dev                   # http://localhost:10000

# Terminal 2 — frontend
cd github-dashboard-frontend
# set BACKEND_URL to http://localhost:10000 in config.js
npx serve .                   # http://localhost:3000
```

To test webhooks locally, expose your local backend with a tunnel (e.g. `smee.io` or `ngrok`) and use that URL as the webhook payload URL. For everyday work, polling against `REPOS` is enough.

---

## 10. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Status dot red, "backend unreachable" | `BACKEND_URL` wrong in `config.js`, or backend asleep — refresh and wait ~60s |
| Tiles all zero | No events yet. Push a commit, or check `REPOS` spelling (`owner/name`) |
| Webhook shows red ✗ in GitHub | `WEBHOOK_SECRET` mismatch between GitHub and Render, or backend still waking |
| Browser console: CORS error | Set `ALLOWED_ORIGIN` on the backend to your exact frontend URL |
| `/api/health` returns repos `[]` | `REPOS` not set on the backend — add it in Render's Environment tab |
| First request after idle is slow | Free-tier spin-up (~30–60s). Expected; upgrade for always-on |

---

## Free-tier reality check

- **Static site (frontend):** free, CDN-served, no spin-down.
- **Web service (backend):** free with 750 instance-hours/month; **spins down after 15 min idle** with a ~30–60s cold start; ~512 MB RAM. No credit card required.
- **History:** in-memory, so it resets on restart. Add Render Postgres (see backend README) if you need it to persist.

That's the whole system. Push code, watch it light up.
