import type { RecordingReport } from './types.js';

const QUEUE_KEY = '__rld_queue';

export async function sendReport(report: RecordingReport, dashboardUrl: string): Promise<void> {
  const ok = await tryPost(report, dashboardUrl);
  if (!ok) enqueue(report);
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
  const q = readQueue();
  q.push(report);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

function readQueue(): RecordingReport[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]'); }
  catch { return []; }
}

export async function flushQueue(dashboardUrl: string): Promise<void> {
  const q = readQueue();
  if (q.length === 0) return;
  const remaining: RecordingReport[] = [];
  for (const report of q) {
    const ok = await tryPost(report, dashboardUrl);
    if (!ok) remaining.push(report);
  }
  localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
}
