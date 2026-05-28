import '@rld/panel-ui';
import { SourceMapConsumer, type RawSourceMap } from 'source-map';
import type { SubscriptionTag, LeakReport, LeakEntry, RecordingMeta, ResolvedStackFrame } from '@rld/analyzer-core';
import { extractComponentName, classifyLeakKind, stripDetectorFrames } from '@rld/analyzer-core';
import mappingsWasmUrl from 'source-map/lib/mappings.wasm?url';

// Must be called once before any new SourceMapConsumer() — the library needs
// its WASM binary to be explicitly provided in browser environments.
SourceMapConsumer.initialize({ 'lib/mappings.wasm': mappingsWasmUrl });

type SessionListItem = {
  id: string;
  fileName: string;
  recordingId: string;
  createdAt: number;
  subscriptionCount: number;
};

type StoredReport = { meta: RecordingMeta; subscriptions: SubscriptionTag[] };

const FRAMEWORK_PATH_PATTERNS = [
  /(?:^|\/)node_modules\//,
  /webpack[-/]runtime/,
  /^webpack:\/\/\/runtime\//,
];

// For URLs without source maps, heuristically classify as framework if they're
// served from Vite's pre-bundled deps area or look like runtime/polyfill bundles.
// Everything else under the dev server is treated as user code.
const FRAMEWORK_URL_PATTERNS = [
  /\/vite\/deps\//,
  /\/polyfills[-.]/,
  /\/runtime[-.]/,
  /\/zone\.js/,
  /^webpack:/,
];

const FRAME_REGEX = /at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;

function isFrameworkPath(path: string): boolean {
  return FRAMEWORK_PATH_PATTERNS.some(p => p.test(path));
}

function isFrameworkUrl(url: string): boolean {
  return FRAMEWORK_URL_PATTERNS.some(p => p.test(url));
}


async function loadSessions(): Promise<SessionListItem[]> {
  const res = await fetch('/sessions');
  return res.json();
}

async function loadSession(id: string): Promise<StoredReport> {
  const res = await fetch(`/sessions/${id}`);
  return res.json();
}

async function fetchSourceMap(url: string): Promise<RawSourceMap | null> {
  // Mirror what browsers do: fetch the JS file, read the sourceMappingURL comment,
  // then fetch that map (which may be an inline data URI or a relative/absolute URL).
  try {
    const jsRes = await fetch(`/source-maps?url=${encodeURIComponent(url)}&raw=1`);
    if (jsRes.ok) {
      const text = await jsRes.text();
      // Only scan the tail — the comment is always in the last few lines.
      const tail = text.slice(-4096);
      const commentMatch = tail.match(/\/\/[#@]\s*sourceMappingURL=([^\s]+)/);
      if (commentMatch) {
        const mappingUrl = commentMatch[1]!.trim();
        if (mappingUrl.startsWith('data:application/json')) {
          const b64 = mappingUrl.match(/base64,([A-Za-z0-9+/=]+)/);
          if (b64) return JSON.parse(atob(b64[1]!)) as RawSourceMap;
        } else {
          // Resolve relative URLs against the script's URL (same as browsers do).
          const resolved = new URL(mappingUrl, url).href;
          const mapRes = await fetch(`/source-maps?url=${encodeURIComponent(resolved)}`);
          if (mapRes.ok) return (await mapRes.json()) as RawSourceMap;
        }
      }
    }
  } catch {
    // fall through to guessing
  }

  // Fallback: guess common .map file patterns for servers that don't embed the comment.
  const candidates: string[] = [url + '.map'];
  const qIdx = url.indexOf('?');
  if (qIdx !== -1) {
    const base = url.slice(0, qIdx);
    const query = url.slice(qIdx);
    candidates.push(base + '.map');
    candidates.push(base + '.map' + query);
  }
  for (const candidate of candidates) {
    try {
      const res = await fetch(`/source-maps?url=${encodeURIComponent(candidate)}`);
      if (!res.ok) continue;
      return (await res.json()) as RawSourceMap;
    } catch {
      // try next
    }
  }
  return null;
}

function resolveStackSync(
  rawStack: string,
  consumers: Map<string, SourceMapConsumer>,
): ResolvedStackFrame[] {
  const frames: ResolvedStackFrame[] = [];
  for (const line of rawStack.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('at ')) continue;
    const match = trimmed.match(FRAME_REGEX);
    if (!match) continue;
    const fnName = match[1] ?? null;
    const url = match[2]!;
    const lineNo = Number(match[3]);
    const colNo = Number(match[4]);
    const baseUrl = url.split('?')[0]!;
    const consumer = consumers.get(url) ?? consumers.get(baseUrl);
    if (!consumer) {
      frames.push({
        rawFrame: trimmed,
        file: url,
        line: lineNo,
        column: colNo,
        isFramework: isFrameworkUrl(url),
        functionName: fnName,
      });
      continue;
    }
    let orig;
    try { orig = consumer.originalPositionFor({ line: lineNo, column: colNo }); }
    catch { orig = { source: null, line: null, column: null, name: null }; }
    const file = orig.source ?? url;
    frames.push({
      rawFrame: trimmed,
      file,
      line: orig.line ?? lineNo,
      column: orig.column ?? colNo,
      isFramework: orig.source ? isFrameworkPath(orig.source) : isFrameworkUrl(url),
      functionName: orig.name ?? fnName,
    });
  }
  return frames;
}

async function buildReport(stored: StoredReport): Promise<LeakReport> {
  const scriptUrls = new Set<string>();
  for (const sub of stored.subscriptions) {
    for (const match of sub.stackRaw.matchAll(/(https?:\/\/[^\s)]+?):\d+:\d+/g)) {
      scriptUrls.add(match[1]!);
    }
  }

  // Fetch source maps in parallel (bounded by browser's HTTP connection pool).
  const sourceMaps = new Map<string, RawSourceMap>();
  await Promise.all([...scriptUrls].map(async url => {
    const map = await fetchSourceMap(url);
    if (!map) return;
    sourceMaps.set(url, map);
    const base = url.split('?')[0]!;
    if (base !== url) sourceMaps.set(base, map);
  }));

  // Build SourceMapConsumers ONCE. Reused across all subscriptions.
  // Each new SourceMapConsumer() requires a WASM call; doing this per-sub
  // overflows memory on large recordings.
  const consumers = new Map<string, SourceMapConsumer>();
  const failedConsumers: string[] = [];
  for (const [url, map] of sourceMaps) {
    try {
      consumers.set(url, await new SourceMapConsumer(map));
    } catch (err) {
      failedConsumers.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  try {
    const leftRoutes = new Set<string>();
    for (const nav of stored.meta.navigations) leftRoutes.add(nav.fromRoute);

    const leaks: LeakEntry[] = [];
    let ignored = 0;
    let scanned = 0;
    let skippedClosed = 0;
    let skippedCurrentRoute = 0;

    for (const tag of stored.subscriptions) {
      if (tag.recordingId !== stored.meta.recordingId) continue;
      scanned++;
      if (tag.closed) { skippedClosed++; continue; }
      if (!leftRoutes.has(tag.route)) { skippedCurrentRoute++; continue; }

      const frames = resolveStackSync(tag.stackRaw, consumers);
      const hasUserFrame = frames.some(f => !f.isFramework);
      if (!hasUserFrame) { ignored++; continue; }

      // frames[0] = patchedSubscribe (our code)
      // frames[1] = whoever directly called subscribe()
      // If that direct caller is framework code, the subscription is managed
      // internally by an operator (takeUntil notifier) or a pipe (async, translate).
      // Those are not user-owned leaks.
      if (frames[1]?.isFramework) { ignored++; continue; }

      const topUser = frames.find(f => !f.isFramework)!;
      const displayFrames = stripDetectorFrames(frames);
      leaks.push({
        id: tag.id,
        route: tag.route,
        observableKind: tag.observableKind,
        sourceLocation: { file: topUser.file, line: topUser.line, column: topUser.column },
        componentName: extractComponentName(frames),
        leakKind: classifyLeakKind(tag.stackRaw, frames, tag.observableKind),
        stack: displayFrames,
        retainerChain: [],
      });
    }

    console.log('[rxjs-leak-finder] build report:', {
      scanned, leaks: leaks.length, ignored, skippedClosed, skippedCurrentRoute,
      leftRoutes: [...leftRoutes],
      sourceMapsResolved: sourceMaps.size,
      sourceMapsAttempted: scriptUrls.size,
      consumersBuilt: consumers.size,
      consumerFailures: failedConsumers.length,
    });
    if (failedConsumers.length > 0) {
      console.warn('[rxjs-leak-finder] consumer build failures:', failedConsumers.slice(0, 5));
    }

    return {
      leaks,
      ignoredFrameworkSubscriptions: ignored,
      longLivedServiceSubscriptions: [],
      totalSubscriptionsScanned: scanned,
    };
  } finally {
    for (const c of consumers.values()) {
      try { c.destroy(); } catch { /* ignore */ }
    }
  }
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
      root.error = null;
      root.progressPhase = 'analyzing';
      try {
        const stored = await loadSession(s.id);
        root.report = await buildReport(stored);
      } catch (err) {
        const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
        console.error('[rxjs-leak-finder] buildReport failed:', err);
        root.error = msg;
      } finally {
        root.progressPhase = null;
      }
    });
    sessionsEl.appendChild(el);
  }
}

document.addEventListener('rld-open-source', async (e: Event) => {
  const detail = (e as CustomEvent).detail as { file: string; line: number; column?: number };
  try {
    const res = await fetch('/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(detail),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn('[rxjs-leak-finder] open failed:', body);
    }
  } catch (err) {
    console.warn('[rxjs-leak-finder] open error:', err);
  }
});

void refresh();
setInterval(refresh, 3000);
