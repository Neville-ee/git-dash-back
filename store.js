// src/store.js
// In-memory store for normalized GitHub events.
//
// This keeps things zero-dependency and easy to deploy. The trade-off:
// data lives in RAM, so it resets whenever the service restarts or (on
// Render's free tier) spins down after 15 minutes of inactivity. For
// durable history, swap these functions for a Render Postgres datastore —
// the rest of the app only talks to the exported functions below, so that
// change stays contained to this file.

const MAX_EVENTS = 500;

/** @type {Array<NormalizedEvent>} newest first */
let events = [];
const seenIds = new Set();

/**
 * @typedef {Object} NormalizedEvent
 * @property {string} id          unique id (used for dedupe)
 * @property {'push'|'pull_request'} type
 * @property {string} repo        owner/name
 * @property {string} actor       github login
 * @property {string} title       human-readable summary
 * @property {string} [branch]
 * @property {string} [action]    PR action: opened | merged | closed | synchronize
 * @property {number} [commits]   push: number of commits
 * @property {'info'|'success'|'warn'} severity
 * @property {string} url         link back to GitHub
 * @property {string} timestamp   ISO string
 */

export function addEvent(/** @type {NormalizedEvent} */ ev) {
  if (!ev || !ev.id || seenIds.has(ev.id)) return false;
  seenIds.add(ev.id);
  events.unshift(ev);
  if (events.length > MAX_EVENTS) {
    const removed = events.pop();
    if (removed) seenIds.delete(removed.id);
  }
  return true;
}

export function getEvents({ limit = 50, type } = {}) {
  let list = events;
  if (type) list = list.filter((e) => e.type === type);
  return list.slice(0, limit);
}

function isToday(iso) {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
}

export function getStats() {
  const openPRs = new Set();
  const closedPRs = new Set();
  const contributors = new Set();
  let pushesToday = 0;
  let commitsToday = 0;
  let mergedToday = 0;

  for (const e of events) {
    contributors.add(e.actor);
    if (e.type === 'pull_request') {
      if (e.action === 'opened') openPRs.add(`${e.repo}#${e.title}`);
      if (e.action === 'merged') {
        closedPRs.add(`${e.repo}#${e.title}`);
        if (isToday(e.timestamp)) mergedToday += 1;
      }
      if (e.action === 'closed') closedPRs.add(`${e.repo}#${e.title}`);
    }
    if (e.type === 'push' && isToday(e.timestamp)) {
      pushesToday += 1;
      commitsToday += e.commits || 0;
    }
  }

  // PRs that were opened but not later closed/merged in our window
  for (const k of closedPRs) openPRs.delete(k);

  return {
    openPRs: openPRs.size,
    mergedToday,
    pushesToday,
    commitsToday,
    activeContributors: contributors.size,
    totalEvents: events.length,
    lastUpdated: new Date().toISOString(),
  };
}

/** Hourly buckets for the last 24h, split by event type. */
export function getSeries() {
  const hours = 24;
  const now = new Date();
  const buckets = [];
  for (let i = hours - 1; i >= 0; i--) {
    const slot = new Date(now.getTime() - i * 3600_000);
    buckets.push({
      label: `${String(slot.getUTCHours()).padStart(2, '0')}:00`,
      hourKey: `${slot.getUTCFullYear()}-${slot.getUTCMonth()}-${slot.getUTCDate()}-${slot.getUTCHours()}`,
      push: 0,
      pull_request: 0,
    });
  }
  const index = new Map(buckets.map((b) => [b.hourKey, b]));
  for (const e of events) {
    const d = new Date(e.timestamp);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}`;
    const b = index.get(key);
    if (b) b[e.type] += 1;
  }
  return buckets.map(({ label, push, pull_request }) => ({ label, push, pull_request }));
}

/** Higher-signal items surfaced as "important messages" on the dashboard. */
export function getMessages({ limit = 20 } = {}) {
  return events
    .filter((e) => e.severity === 'warn' || e.severity === 'success' || e.action === 'opened')
    .slice(0, limit)
    .map((e) => ({
      id: e.id,
      severity: e.severity,
      repo: e.repo,
      actor: e.actor,
      text: e.title,
      url: e.url,
      timestamp: e.timestamp,
    }));
}
