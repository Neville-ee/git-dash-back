// src/github.js
// Two ways events get into the store:
//   1. Webhooks  — GitHub POSTs here in real time (handled in server.js).
//   2. Polling   — we periodically pull the repo Events API to backfill and
//                  to cover any webhook deliveries we missed.
// Both paths funnel into the same normalize* helpers so the store only ever
// sees one consistent shape.

import { addEvent } from './store.js';

const GH_API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN || '';
const REPOS = (process.env.REPOS || '')
  .split(',')
  .map((r) => r.trim())
  .filter(Boolean);

function ghHeaders() {
  const h = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'github-activity-dashboard',
  };
  // Bearer is required for fine-grained tokens. Public repos work without a
  // token but get the 60 req/hour unauthenticated limit, so a token is wise.
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

// ---- Normalizers ----------------------------------------------------------

/** Normalize a webhook `push` payload. */
export function normalizePushWebhook(p) {
  const repo = p.repository?.full_name || 'unknown';
  const branch = (p.ref || '').replace('refs/heads/', '');
  const commits = Array.isArray(p.commits) ? p.commits.length : 0;
  const forced = Boolean(p.forced);
  const actor = p.pusher?.name || p.sender?.login || 'unknown';
  return {
    id: `push:${p.after || p.head_commit?.id || Date.now()}`,
    type: 'push',
    repo,
    actor,
    branch,
    commits,
    title: forced
      ? `Force-pushed ${commits} commit${commits === 1 ? '' : 's'} to ${branch}`
      : `Pushed ${commits} commit${commits === 1 ? '' : 's'} to ${branch}`,
    severity: forced ? 'warn' : 'info',
    url: p.compare || p.repository?.html_url || '',
    timestamp: p.head_commit?.timestamp || new Date().toISOString(),
  };
}

/** Normalize a webhook `pull_request` payload. */
export function normalizePullRequestWebhook(p) {
  const pr = p.pull_request || {};
  const repo = p.repository?.full_name || 'unknown';
  const merged = p.action === 'closed' && pr.merged;
  const action = merged ? 'merged' : p.action; // opened | closed | synchronize | ...
  const sevByAction = { opened: 'info', merged: 'success', closed: 'warn' };
  return {
    id: `pr:${repo}:${pr.number}:${action}:${pr.updated_at || Date.now()}`,
    type: 'pull_request',
    repo,
    actor: pr.user?.login || p.sender?.login || 'unknown',
    action,
    branch: pr.head?.ref,
    title: `PR #${pr.number} ${action}: ${pr.title || ''}`.trim(),
    severity: sevByAction[action] || 'info',
    url: pr.html_url || '',
    timestamp: pr.updated_at || new Date().toISOString(),
  };
}

/** Normalize an item from GET /repos/{owner}/{repo}/events (polling path). */
function normalizeEventsApiItem(item, repoFullName) {
  const actor = item.actor?.login || 'unknown';
  if (item.type === 'PushEvent') {
    const branch = (item.payload?.ref || '').replace('refs/heads/', '');
    const commits = item.payload?.size ?? item.payload?.commits?.length ?? 0;
    return {
      id: `push:${item.id}`,
      type: 'push',
      repo: repoFullName,
      actor,
      branch,
      commits,
      title: `Pushed ${commits} commit${commits === 1 ? '' : 's'} to ${branch}`,
      severity: 'info',
      url: `https://github.com/${repoFullName}/commits/${branch}`,
      timestamp: item.created_at,
    };
  }
  if (item.type === 'PullRequestEvent') {
    const pr = item.payload?.pull_request || {};
    const merged = item.payload?.action === 'closed' && pr.merged;
    const action = merged ? 'merged' : item.payload?.action;
    const sevByAction = { opened: 'info', merged: 'success', closed: 'warn' };
    return {
      id: `pr:${item.id}`,
      type: 'pull_request',
      repo: repoFullName,
      actor,
      action,
      branch: pr.head?.ref,
      title: `PR #${pr.number} ${action}: ${pr.title || ''}`.trim(),
      severity: sevByAction[action] || 'info',
      url: pr.html_url || `https://github.com/${repoFullName}/pulls`,
      timestamp: item.created_at,
    };
  }
  return null; // ignore other event types
}

// ---- Polling --------------------------------------------------------------

async function pollRepo(repoFullName) {
  const url = `${GH_API}/repos/${repoFullName}/events?per_page=30`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) {
    console.warn(`[poll] ${repoFullName} -> ${res.status} ${res.statusText}`);
    return 0;
  }
  const items = await res.json();
  let added = 0;
  for (const item of items) {
    const norm = normalizeEventsApiItem(item, repoFullName);
    if (norm && addEvent(norm)) added += 1;
  }
  return added;
}

export async function pollAllRepos() {
  if (REPOS.length === 0) {
    console.warn('[poll] No REPOS configured — relying on webhooks only.');
    return;
  }
  for (const repo of REPOS) {
    try {
      const n = await pollRepo(repo);
      if (n) console.log(`[poll] ${repo}: +${n} new events`);
    } catch (err) {
      console.error(`[poll] ${repo} failed:`, err.message);
    }
  }
}

export const configuredRepos = REPOS;
