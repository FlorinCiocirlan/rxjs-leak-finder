import type { RecordingReport } from './types.js';

const QUEUE_KEY = '__rld_queue';

/**
 * POST a recording report to the dashboard. If the dashboard isn't reachable
 * the report is queued in localStorage and retried on the next page load via
 * {@link flushQueue}.
 */
export async function sendReport(report: RecordingReport, dashboardUrl: string): Promise<void> {
  const ok = await tryPost(report, dashboardUrl);
  if (!ok) enqueue(report);
}

/**
 * Try to deliver any queued reports left behind by a previous session. Called
 * at startup; safe to call repeatedly.
 */
export async function flushQueue(dashboardUrl: string): Promise<void> {
  const queue = readQueue();
  if (queue.length === 0) return;
  const remaining: RecordingReport[] = [];
  for (const report of queue) {
    const ok = await tryPost(report, dashboardUrl);
    if (!ok) remaining.push(report);
  }
  writeQueue(remaining);
}

async function tryPost(report: RecordingReport, dashboardUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${dashboardUrl}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function enqueue(report: RecordingReport): void {
  const queue = readQueue();
  queue.push(report);
  writeQueue(queue);
}

function readQueue(): RecordingReport[] {
  const storage = safeStorage();
  if (!storage) return [];
  try {
    return JSON.parse(storage.getItem(QUEUE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function writeQueue(queue: RecordingReport[]): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Quota exceeded or private-mode failure — best-effort only.
  }
}

/**
 * Returns localStorage if it's actually usable. Private browsing, web workers,
 * and some CSP configurations throw on access, so we probe with a write.
 */
function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = '__rld_probe';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}
