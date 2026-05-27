import '@rld/panel-ui';
import { classify, resolveStack, type SubscriptionTag, type LeakReport, type LeakEntry, type RecordingMeta } from '@rld/analyzer-core';
import type { RawSourceMap } from 'source-map';

type SessionListItem = {
  id: string;
  fileName: string;
  recordingId: string;
  createdAt: number;
  subscriptionCount: number;
};

type StoredReport = { meta: RecordingMeta; subscriptions: SubscriptionTag[] };

async function loadSessions(): Promise<SessionListItem[]> {
  const res = await fetch('/sessions');
  return res.json();
}

async function loadSession(id: string): Promise<StoredReport> {
  const res = await fetch(`/sessions/${id}`);
  return res.json();
}

async function fetchSourceMap(url: string): Promise<RawSourceMap | null> {
  try {
    const res = await fetch(`/source-maps?url=${encodeURIComponent(url + '.map')}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function buildReport(stored: StoredReport): Promise<LeakReport> {
  const scriptUrls = new Set<string>();
  for (const sub of stored.subscriptions) {
    for (const match of sub.stackRaw.matchAll(/at\s+(?:.+?\s+\()?(https?:\/\/[^\s):]+):/g)) {
      scriptUrls.add(match[1]!);
    }
  }
  const sourceMaps = new Map<string, RawSourceMap>();
  await Promise.all([...scriptUrls].map(async url => {
    const map = await fetchSourceMap(url);
    if (map) sourceMaps.set(url, map);
  }));

  const leaks: LeakEntry[] = [];
  let ignored = 0;
  let scanned = 0;

  for (const tag of stored.subscriptions) {
    if (tag.recordingId !== stored.meta.recordingId) continue;
    scanned++;
    const frames = await resolveStack(tag.stackRaw, sourceMaps);
    const verdict = classify({
      tag,
      frames,
      classification: { reachesApplicationRef: false, reachesWindow: true, passesThroughComponent: true },
      recording: stored.meta,
    });
    if (verdict === 'framework-noise') { ignored++; continue; }
    if (verdict !== 'leak') continue;
    const topUser = frames.find(f => !f.isFramework);
    leaks.push({
      id: tag.id,
      route: tag.route,
      observableKind: tag.observableKind,
      sourceLocation: topUser
        ? { file: topUser.file, line: topUser.line, column: topUser.column }
        : { file: 'unknown', line: 0, column: 0 },
      componentName: null,
      stack: frames,
      retainerChain: [],
    });
  }

  return {
    leaks,
    ignoredFrameworkSubscriptions: ignored,
    longLivedServiceSubscriptions: [],
    totalSubscriptionsScanned: scanned,
  };
}

const root = document.getElementById('root') as any;
const sessionsEl = document.getElementById('sessions')!;

async function refresh() {
  const sessions = await loadSessions();
  sessions.sort((a, b) => b.createdAt - a.createdAt);
  sessionsEl.innerHTML = '';
  for (const s of sessions) {
    const el = document.createElement('div');
    el.className = 'session';
    el.innerHTML = `<div>${new Date(s.createdAt).toLocaleString()}</div><div class="when">${s.subscriptionCount} subs · ${s.recordingId}</div>`;
    el.addEventListener('click', async () => {
      document.querySelectorAll('.session').forEach(n => n.classList.remove('active'));
      el.classList.add('active');
      const stored = await loadSession(s.id);
      root.report = await buildReport(stored);
    });
    sessionsEl.appendChild(el);
  }
}

document.addEventListener('rld-open-source', (e: Event) => {
  const detail = (e as CustomEvent).detail as { file: string; line: number };
  // open in user's editor via deep link — fall back to console.log for v1
  console.log(`open ${detail.file}:${detail.line}`);
});

void refresh();
setInterval(refresh, 3000);  // simple polling for new sessions
