# Real-time Leak Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream leak candidates to the dashboard (and a count to the floating widget) live while recording, instead of only revealing them on Stop.

**Architecture:** The patched page POSTs incremental deltas (`/session/start`, `/session/:id/delta`) to the CLI dashboard server. The server is a dumb relay + in-memory buffer that fans deltas out to the dashboard UI over Server-Sent Events (`GET /live`). The dashboard UI folds deltas into a running buffer and reuses the existing `buildReport` leak rule to render candidates live. Stop POSTs the final `/report` as today; the server broadcasts `session-end` and the UI swaps to the full symbolicated report. The page never runs analysis — it streams the same `SubscriptionTag`s it already collects.

**Tech Stack:** TypeScript, Node `http` (CLI server), Lit (panel-ui), vitest (happy-dom for runtime/panel, node for cli), pnpm workspace.

> **Pre-existing typecheck note:** `npx tsc -p tsconfig.json --noEmit` in `packages/rxjs-leak-detector` already emits ONE error unrelated to this work: `src/dashboard/app.ts(9,19): error TS2339: Property 'initialize' does not exist on type 'SourceMapConsumerConstructor'` (a Vite/wasm runtime feature tsc can't model). Treat that single error as the baseline. A typecheck step "passes" if it introduces **no new errors** beyond this one. The authoritative gates are `npx vitest run` (esbuild-compiled) and `pnpm build`.

---

## File Structure

**Create:**
- `packages/rxjs-leak-detector/src/shared/live-protocol.ts` — `SessionStart` / `SessionDelta` wire types.
- `packages/rxjs-leak-detector/src/shared/framework-filter.ts` — `isFrameworkUrl`, `topUserFrameUrl` (shared page-side + dashboard-side; dedupes logic currently inline in `dashboard/app.ts`).
- `packages/rxjs-leak-detector/src/runtime/live-emitter.ts` — owns streaming side effects (start POST, heartbeat timer, delta POSTs, widget count).
- `packages/rxjs-leak-detector/src/dashboard/live-buffer.ts` — pure, testable delta-folding + candidate selection (no Vite imports).
- Tests: `test/runtime/live-emitter.test.ts`, `test/dashboard/live-buffer.test.ts`, and additions to existing test files.

**Modify:**
- `src/runtime/recorder.ts` — delta accumulators, `drainDelta`, `liveCandidateCount`, `startedAtMs`/`initialRoute` getters.
- `src/cli/dashboard-server.ts` — live hub, new routes, SSE, keep-alive + TTL intervals, `session-end` on `/report`.
- `src/runtime/enable.ts` — wire emitter into `start`/`stop`, immediate drain on navigation.
- `src/runtime/widget.ts` — `setLeakCount` + pulsing recording indicator.
- `src/dashboard/app.ts` — `EventSource('/live')`, live buffer wiring, memoized source-map fetch.
- `packages/panel-ui/src/components/leak-detector-root.ts` — `live` mode + `liveCandidates` + waiting state.

---

## Task 1: Live protocol types

**Files:**
- Create: `packages/rxjs-leak-detector/src/shared/live-protocol.ts`

- [ ] **Step 1: Create the types file**

```ts
// packages/rxjs-leak-detector/src/shared/live-protocol.ts
import type { SubscriptionTag, NavigationEvent } from '../runtime/types.js';

/** POSTed once to /session/start when recording begins. */
export type SessionStart = {
  recordingId: string;
  initialRoute: string;
  startedAtMs: number;
};

/** POSTed to /session/:id/delta on each navigation and on the ~2s heartbeat. */
export type SessionDelta = {
  recordingId: string;
  /** Monotonic per session; lets the UI detect dropped deltas. */
  seq: number;
  /** Navigations observed since the previous delta. */
  navigations: NavigationEvent[];
  /** Subscriptions opened since the previous delta. */
  added: SubscriptionTag[];
  /** Subscription ids that unsubscribed since the previous delta. */
  closedIds: string[];
  /** Route the app is on as of this delta. */
  currentRoute: string;
};
```

- [ ] **Step 2: Typecheck the package**

Run: `cd packages/rxjs-leak-detector && npx tsc -p tsconfig.json --noEmit`
Expected: PASS (no errors). The file is type-only; nothing imports it yet.

---

## Task 2: Shared framework-filter util

Extract the URL-based framework heuristic so the page-side approximate filter and the dashboard share one source of truth.

**Files:**
- Create: `packages/rxjs-leak-detector/src/shared/framework-filter.ts`
- Test: `packages/rxjs-leak-detector/test/shared/framework-filter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/rxjs-leak-detector/test/shared/framework-filter.test.ts
import { describe, it, expect } from 'vitest';
import { isFrameworkUrl, topUserFrameUrl } from '../../src/shared/framework-filter.js';

describe('isFrameworkUrl', () => {
  it('flags vite deps and zone.js', () => {
    expect(isFrameworkUrl('http://localhost/node_modules/.vite/deps/rxjs.js')).toBe(false); // not matched by URL patterns
    expect(isFrameworkUrl('http://localhost/vite/deps/rxjs.js')).toBe(true);
    expect(isFrameworkUrl('http://localhost/zone.js')).toBe(true);
    expect(isFrameworkUrl('http://localhost/src/app.component.ts')).toBe(false);
  });
});

describe('topUserFrameUrl', () => {
  it('returns the first non-framework frame url', () => {
    const stack = [
      'Error',
      '    at patchedSubscribe (http://localhost/vite/deps/chunk.js:1:1)',
      '    at DashboardComponent.ngOnInit (http://localhost/src/dashboard.component.ts:48:10)',
    ].join('\n');
    expect(topUserFrameUrl(stack)).toBe('http://localhost/src/dashboard.component.ts');
  });

  it('returns null when every frame is framework', () => {
    const stack = 'Error\n    at x (http://localhost/zone.js:1:1)';
    expect(topUserFrameUrl(stack)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/rxjs-leak-detector && npx vitest run test/shared/framework-filter.test.ts`
Expected: FAIL — cannot resolve `../../src/shared/framework-filter.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/rxjs-leak-detector/src/shared/framework-filter.ts

// Mirrors the heuristic in dashboard/app.ts for URLs without source maps:
// pre-bundled deps, polyfills, runtime/zone bundles are framework code.
export const FRAMEWORK_URL_PATTERNS = [
  /\/vite\/deps\//,
  /\/polyfills[-.]/,
  /\/runtime[-.]/,
  /\/zone\.js/,
  /^webpack:/,
];

export function isFrameworkUrl(url: string): boolean {
  return FRAMEWORK_URL_PATTERNS.some(p => p.test(url));
}

const FRAME_REGEX = /at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;

/**
 * First stack-frame URL that is not a framework URL, scanning top-down.
 * Used page-side (no source maps) as a cheap "does this look like a user leak?"
 * signal. Returns null when every frame is framework code.
 */
export function topUserFrameUrl(stackRaw: string): string | null {
  for (const line of stackRaw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('at ')) continue;
    const m = trimmed.match(FRAME_REGEX);
    if (!m) continue;
    const url = m[2]!;
    if (isFrameworkUrl(url)) continue;
    return url;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/rxjs-leak-detector && npx vitest run test/shared/framework-filter.test.ts`
Expected: PASS (3 tests).

---

## Task 3: Recorder delta accumulators + live candidate count

**Files:**
- Modify: `packages/rxjs-leak-detector/src/runtime/recorder.ts`
- Test: `packages/rxjs-leak-detector/test/runtime/recorder.test.ts`

- [ ] **Step 1: Write the failing tests** (append to the existing `describe('createRecorder', ...)` block)

```ts
  it('drainDelta returns accumulated changes then clears them', () => {
    window.history.replaceState({}, '', '/a');
    recorder.start();
    const sub: any = {};
    recorder.onSubscribe(sub, { constructor: { name: 'Interval' } }, 'Error');
    recorder.recordNavigation({ from: '/a', to: '/b' });

    const d1 = recorder.drainDelta();
    expect(d1.added).toHaveLength(1);
    expect(d1.navigations).toHaveLength(1);
    expect(d1.currentRoute).toBe('/b');
    expect(d1.seq).toBe(1);

    const d2 = recorder.drainDelta(); // nothing new — heartbeat
    expect(d2.added).toHaveLength(0);
    expect(d2.navigations).toHaveLength(0);
    expect(d2.closedIds).toHaveLength(0);
    expect(d2.seq).toBe(2);
  });

  it('drainDelta reports unsubscribes via closedIds', () => {
    recorder.start();
    const sub: any = {};
    recorder.onSubscribe(sub, { constructor: { name: 'Observable' } }, 'Error');
    recorder.drainDelta(); // flush the add
    recorder.onUnsubscribe(sub);
    const d = recorder.drainDelta();
    expect(d.closedIds).toEqual([sub.__sw_meta.id]);
  });

  it('liveCandidateCount counts open subs on left routes with a user frame', () => {
    window.history.replaceState({}, '', '/a');
    recorder.start();
    const userStack = 'Error\n    at Foo (http://localhost/src/foo.ts:1:1)';
    const leaking: any = {};
    recorder.onSubscribe(leaking, { constructor: { name: 'Interval' } }, userStack);
    recorder.recordNavigation({ from: '/a', to: '/b' }); // /a is now "left"
    expect(recorder.liveCandidateCount()).toBe(1);

    recorder.onUnsubscribe(leaking); // cleaned up → no longer a candidate
    expect(recorder.liveCandidateCount()).toBe(0);
  });

  it('liveCandidateCount ignores framework-only stacks', () => {
    window.history.replaceState({}, '', '/a');
    recorder.start();
    const fwStack = 'Error\n    at x (http://localhost/zone.js:1:1)';
    const sub: any = {};
    recorder.onSubscribe(sub, { constructor: { name: 'Observable' } }, fwStack);
    recorder.recordNavigation({ from: '/a', to: '/b' });
    expect(recorder.liveCandidateCount()).toBe(0);
  });

  it('exposes initialRoute and startedAtMs after start', () => {
    window.history.replaceState({}, '', '/start-here');
    recorder.start();
    expect(recorder.initialRoute).toBe('/start-here');
    expect(typeof recorder.startedAtMs).toBe('number');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/rxjs-leak-detector && npx vitest run test/runtime/recorder.test.ts`
Expected: FAIL — `recorder.drainDelta is not a function` (and the other new members undefined).

- [ ] **Step 3: Update imports + state in `recorder.ts`**

At the top, add the import:

```ts
import type { SubscriptionTag, RecordingReport, NavigationEvent } from './types.js';
import { topUserFrameUrl } from '../shared/framework-filter.js';
```

Extend the `State` type (inside `createRecorder`) with accumulators + seq:

```ts
  type State = {
    recordingId: string | null;
    isRecording: boolean;
    initialRoute: string;
    currentRoute: string;
    startedAtMs: number;
    navigations: Array<{ fromRoute: string; toRoute: string; atMs: number }>;
    subscriptions: Map<string, { tag: SubscriptionTag }>;
    seq: number;
    pendingAdded: SubscriptionTag[];
    pendingClosedIds: string[];
    pendingNavs: NavigationEvent[];
  };
```

Update the `state` initializer to include the new fields:

```ts
  const state: State = {
    recordingId: null,
    isRecording: false,
    initialRoute: '',
    currentRoute: '',
    startedAtMs: 0,
    navigations: [],
    subscriptions: new Map(),
    seq: 0,
    pendingAdded: [],
    pendingClosedIds: [],
    pendingNavs: [],
  };
```

- [ ] **Step 4: Reset accumulators in `start()` and feed them from the hooks**

In `start()`, after the existing assignments, add:

```ts
      state.seq = 0;
      state.pendingAdded = [];
      state.pendingClosedIds = [];
      state.pendingNavs = [];
```

In `onSubscribe`, after `state.subscriptions.set(tag.id, { tag });` add:

```ts
      state.pendingAdded.push(tag);
```

In `onUnsubscribe`, inside the `if (entry)` block (after `entry.tag.closed = true;`) add:

```ts
      state.pendingClosedIds.push(meta.id);
```

In `recordNavigation`, after pushing to `state.navigations`, add:

```ts
      state.pendingNavs.push({ fromRoute: change.from, toRoute: change.to, atMs: Date.now() });
```

In `markNavigation`, after pushing to `state.navigations`, add (mirror the just-built nav):

```ts
      state.pendingNavs.push({ fromRoute: state.navigations[state.navigations.length - 1]!.fromRoute, toRoute: next, atMs: Date.now() });
```

- [ ] **Step 5: Add the new public members to the returned object**

Add these getters/methods alongside the existing `get isRecording` / `get currentRecordingId`:

```ts
    get initialRoute() { return state.initialRoute; },
    get startedAtMs() { return state.startedAtMs; },

    drainDelta() {
      state.seq += 1;
      const delta = {
        recordingId: state.recordingId ?? '',
        seq: state.seq,
        navigations: state.pendingNavs.slice(),
        added: state.pendingAdded.slice(),
        closedIds: state.pendingClosedIds.slice(),
        currentRoute: state.currentRoute,
      };
      state.pendingNavs = [];
      state.pendingAdded = [];
      state.pendingClosedIds = [];
      return delta;
    },

    liveCandidateCount(): number {
      const leftRoutes = new Set<string>();
      for (const nav of state.navigations) leftRoutes.add(nav.fromRoute);
      let count = 0;
      for (const { tag } of state.subscriptions.values()) {
        if (tag.closed) continue;
        if (!leftRoutes.has(tag.route)) continue;
        if (topUserFrameUrl(tag.stackRaw) == null) continue;
        count++;
      }
      return count;
    },
```

Add the return-type annotation for `drainDelta` by importing the protocol type at the top:

```ts
import type { SessionDelta } from '../shared/live-protocol.js';
```

and typing the method as `drainDelta(): SessionDelta {`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/rxjs-leak-detector && npx vitest run test/runtime/recorder.test.ts`
Expected: PASS (all original + 5 new tests).

---

## Task 4: Dashboard server — live hub, routes, SSE

**Files:**
- Modify: `packages/rxjs-leak-detector/src/cli/dashboard-server.ts`
- Test: `packages/rxjs-leak-detector/test/cli/dashboard-server.test.ts`

- [ ] **Step 1: Write the failing tests** (append inside `describe('dashboard-server', ...)`)

```ts
  it('broadcasts session-start and delta to a connected /live client', async () => {
    // Open an SSE stream and read frames as they arrive.
    const ac = new AbortController();
    const liveRes = await fetch(`${server.url}/live`, { signal: ac.signal });
    const reader = liveRes.body!.getReader();
    const decoder = new TextDecoder();

    await fetch(`${server.url}/session/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recordingId: 'rec-1', initialRoute: '/', startedAtMs: 0 }),
    });
    await fetch(`${server.url}/session/rec-1/delta`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recordingId: 'rec-1', seq: 1, navigations: [], added: [], closedIds: [], currentRoute: '/x' }),
    });

    let buf = '';
    while (!(buf.includes('event: session-start') && buf.includes('event: delta'))) {
      const { value } = await reader.read();
      buf += decoder.decode(value);
    }
    expect(buf).toContain('event: session-start');
    expect(buf).toContain('event: delta');
    expect(buf).toContain('"currentRoute":"/x"');
    ac.abort();
  });

  it('POST /report broadcasts session-end and still writes the file', async () => {
    const ac = new AbortController();
    const liveRes = await fetch(`${server.url}/live`, { signal: ac.signal });
    const reader = liveRes.body!.getReader();
    const decoder = new TextDecoder();

    await fetch(`${server.url}/session/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recordingId: 'rec-1', initialRoute: '/', startedAtMs: 0 }),
    });
    await fetch(`${server.url}/report`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sampleReport),
    });

    let buf = '';
    while (!buf.includes('event: session-end')) {
      const { value } = await reader.read();
      buf += decoder.decode(value);
    }
    expect(buf).toContain('event: session-end');
    expect(readdirSync(join(cwd, '.rld'))).toHaveLength(1);
    ac.abort();
  });

  it('replays the current live session to a late /live client', async () => {
    await fetch(`${server.url}/session/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recordingId: 'rec-1', initialRoute: '/home', startedAtMs: 0 }),
    });
    const ac = new AbortController();
    const liveRes = await fetch(`${server.url}/live`, { signal: ac.signal });
    const reader = liveRes.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (!buf.includes('event: session-start')) {
      const { value } = await reader.read();
      buf += decoder.decode(value);
    }
    expect(buf).toContain('"recordingId":"rec-1"');
    ac.abort();
  });
```

Note `sampleReport.meta.recordingId` is already `'rec-1'`, matching the started session.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/rxjs-leak-detector && npx vitest run test/cli/dashboard-server.test.ts`
Expected: FAIL — `/session/start` and `/live` 404; no `session-start`/`session-end` frames.

- [ ] **Step 3: Add hub types + imports**

At the top of `dashboard-server.ts`, add:

```ts
import type { SessionStart, SessionDelta } from '../shared/live-protocol.js';
import type { SubscriptionTag, NavigationEvent } from '../runtime/types.js';

type LiveSession = {
  start: SessionStart;
  lastSeq: number;
  snapshot: { added: SubscriptionTag[]; navigations: NavigationEvent[]; closedIds: string[]; currentRoute: string };
  lastDeltaAtMs: number;
};

type LiveHub = {
  live: Map<string, LiveSession>;
  sseClients: Set<ServerResponse>;
};

const ORPHAN_TTL_MS = 30_000;
const SWEEP_MS = 10_000;
const PING_MS = 15_000;

function sseSend(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(hub: LiveHub, event: string, data: unknown): void {
  for (const c of hub.sseClients) {
    try { sseSend(c, event, data); } catch { hub.sseClients.delete(c); }
  }
}
```

- [ ] **Step 4: Create the hub + intervals in `startServer` and thread it through**

Change `startServer` so it builds a hub, passes it to `handleRequest`, runs keep-alive + TTL intervals, and clears them on close:

```ts
export async function startServer(opts: StartServerOptions): Promise<ServerHandle> {
  const rldDir = join(opts.cwd, '.rld');
  if (!existsSync(rldDir)) mkdirSync(rldDir, { recursive: true });

  const hub: LiveHub = { live: new Map(), sseClients: new Set() };

  const server = createServer((req, res) => handleRequest(req, res, opts, rldDir, hub));
  await new Promise<void>((resolveStart) => server.listen(opts.port, () => resolveStart()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;

  const ping = setInterval(() => {
    for (const c of hub.sseClients) {
      try { c.write(': ping\n\n'); } catch { hub.sseClients.delete(c); }
    }
  }, PING_MS);

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of hub.live) {
      if (now - s.lastDeltaAtMs > ORPHAN_TTL_MS) {
        hub.live.delete(id);
        broadcast(hub, 'session-end', { recordingId: id, fileName: null });
      }
    }
  }, SWEEP_MS);

  return {
    url: `http://localhost:${port}`,
    port,
    close: () => new Promise(r => {
      clearInterval(ping);
      clearInterval(sweep);
      for (const c of hub.sseClients) { try { c.end(); } catch { /* ignore */ } }
      server.close(() => r());
    }),
  };
}
```

- [ ] **Step 5: Update `handleRequest` signature + add routes**

Change the signature to accept the hub:

```ts
async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: StartServerOptions,
  rldDir: string,
  hub: LiveHub,
): Promise<void> {
```

Add the new route branches just after the existing `POST /report` branch (before `/open`):

```ts
  if (req.method === 'POST' && pathname === '/session/start') {
    return handleSessionStart(req, res, hub);
  }
  if (req.method === 'POST' && pathname.startsWith('/session/') && pathname.endsWith('/delta')) {
    return handleSessionDelta(req, res, hub);
  }
  if (req.method === 'GET' && pathname === '/live') {
    return handleLive(req, res, hub);
  }
```

Update the existing `/report` branch to pass the hub:

```ts
  if (req.method === 'POST' && pathname === '/report') {
    return handleReport(req, res, rldDir, hub);
  }
```

- [ ] **Step 6: Implement the handlers**

Add these functions to the file:

```ts
async function handleSessionStart(req: IncomingMessage, res: ServerResponse, hub: LiveHub): Promise<void> {
  const body = await readBody(req);
  let start: SessionStart;
  try { start = JSON.parse(body); }
  catch { res.writeHead(400).end('Invalid JSON'); return; }
  hub.live.set(start.recordingId, {
    start,
    lastSeq: 0,
    snapshot: { added: [], navigations: [], closedIds: [], currentRoute: start.initialRoute },
    lastDeltaAtMs: Date.now(),
  });
  broadcast(hub, 'session-start', start);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"ok":true}');
}

async function handleSessionDelta(req: IncomingMessage, res: ServerResponse, hub: LiveHub): Promise<void> {
  const body = await readBody(req);
  let delta: SessionDelta;
  try { delta = JSON.parse(body); }
  catch { res.writeHead(400).end('Invalid JSON'); return; }
  const session = hub.live.get(delta.recordingId);
  if (!session) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":false,"stale":true}');
    return;
  }
  session.snapshot.added.push(...delta.added);
  session.snapshot.navigations.push(...delta.navigations);
  session.snapshot.closedIds.push(...delta.closedIds);
  session.snapshot.currentRoute = delta.currentRoute;
  session.lastSeq = delta.seq;
  session.lastDeltaAtMs = Date.now();
  broadcast(hub, 'delta', delta);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"ok":true}');
}

function handleLive(req: IncomingMessage, res: ServerResponse, hub: LiveHub): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.write('retry: 2000\n\n');
  hub.sseClients.add(res);
  // Replay any in-flight session so a late-joining tab catches up.
  for (const s of hub.live.values()) {
    sseSend(res, 'session-start', s.start);
    sseSend(res, 'delta', {
      recordingId: s.start.recordingId,
      seq: s.lastSeq,
      navigations: s.snapshot.navigations,
      added: s.snapshot.added,
      closedIds: s.snapshot.closedIds,
      currentRoute: s.snapshot.currentRoute,
    });
  }
  req.on('close', () => hub.sseClients.delete(res));
}
```

Update `handleReport` to take the hub and broadcast `session-end`:

```ts
async function handleReport(req: IncomingMessage, res: ServerResponse, rldDir: string, hub: LiveHub): Promise<void> {
  const body = await readBody(req);
  let report: any;
  try { report = JSON.parse(body); }
  catch { res.writeHead(400).end('Invalid JSON'); return; }
  const recordingId = report?.meta?.recordingId ?? randomUUID();
  const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}-${recordingId}.json`;
  writeFileSync(join(rldDir, fileName), JSON.stringify(report, null, 2));
  if (hub.live.has(recordingId)) hub.live.delete(recordingId);
  broadcast(hub, 'session-end', { recordingId, fileName });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, fileName }));
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd packages/rxjs-leak-detector && npx vitest run test/cli/dashboard-server.test.ts`
Expected: PASS (4 original + 3 new tests). If a read loop hangs, confirm `ac.abort()` runs and the server `close()` clears intervals.

---

## Task 5: Live emitter

**Files:**
- Create: `packages/rxjs-leak-detector/src/runtime/live-emitter.ts`
- Test: `packages/rxjs-leak-detector/test/runtime/live-emitter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/rxjs-leak-detector/test/runtime/live-emitter.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startLiveEmitter } from '../../src/runtime/live-emitter.js';

function fakeRecorder() {
  return {
    isRecording: true,
    currentRecordingId: 'rec-1',
    initialRoute: '/',
    startedAtMs: 0,
    drainDelta: vi.fn(() => ({ recordingId: 'rec-1', seq: 1, navigations: [], added: [], closedIds: [], currentRoute: '/x' })),
    liveCandidateCount: vi.fn(() => 2),
  } as any;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('startLiveEmitter', () => {
  it('POSTs /session/start on creation', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as any;
    startLiveEmitter({ recorder: fakeRecorder(), dashboardUrl: 'http://d', recordingId: 'rec-1', initialRoute: '/', startedAtMs: 0, widget: null });
    expect(fetchMock).toHaveBeenCalledWith('http://d/session/start', expect.objectContaining({ method: 'POST' }));
  });

  it('drainNow POSTs a delta and updates the widget count', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as any;
    const widget = { setLeakCount: vi.fn() } as any;
    const rec = fakeRecorder();
    const em = startLiveEmitter({ recorder: rec, dashboardUrl: 'http://d', recordingId: 'rec-1', initialRoute: '/', startedAtMs: 0, widget });
    fetchMock.mockClear();
    em.drainNow();
    expect(fetchMock).toHaveBeenCalledWith('http://d/session/rec-1/delta', expect.objectContaining({ method: 'POST' }));
    expect(widget.setLeakCount).toHaveBeenCalledWith(2);
  });

  it('heartbeat timer drains every ~2s until stopped', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as any;
    const rec = fakeRecorder();
    const em = startLiveEmitter({ recorder: rec, dashboardUrl: 'http://d', recordingId: 'rec-1', initialRoute: '/', startedAtMs: 0, widget: null });
    rec.drainDelta.mockClear();
    vi.advanceTimersByTime(4100);
    expect(rec.drainDelta).toHaveBeenCalledTimes(2);
    em.stop();
    vi.advanceTimersByTime(4000);
    expect(rec.drainDelta).toHaveBeenCalledTimes(2);
  });

  it('swallows fetch failures', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('down')) as any;
    const em = startLiveEmitter({ recorder: fakeRecorder(), dashboardUrl: 'http://d', recordingId: 'rec-1', initialRoute: '/', startedAtMs: 0, widget: null });
    expect(() => em.drainNow()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/rxjs-leak-detector && npx vitest run test/runtime/live-emitter.test.ts`
Expected: FAIL — cannot resolve `live-emitter.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/rxjs-leak-detector/src/runtime/live-emitter.ts
import type { Recorder } from './recorder.js';
import type { WidgetController } from './widget.js';

const HEARTBEAT_MS = 2000;

export type LiveEmitter = {
  /** Drain any pending changes and push them now (also called on navigation). */
  drainNow(): void;
  /** Stop the heartbeat. Does not POST a final report — that stays in controller.stop. */
  stop(): void;
};

export function startLiveEmitter(args: {
  recorder: Recorder;
  dashboardUrl: string;
  recordingId: string;
  initialRoute: string;
  startedAtMs: number;
  widget: WidgetController | null;
}): LiveEmitter {
  const { recorder, dashboardUrl, recordingId, initialRoute, startedAtMs, widget } = args;

  void post(`${dashboardUrl}/session/start`, { recordingId, initialRoute, startedAtMs });

  const drainNow = () => {
    if (!recorder.isRecording) return;
    const delta = recorder.drainDelta();
    void post(`${dashboardUrl}/session/${recordingId}/delta`, delta);
    widget?.setLeakCount(recorder.liveCandidateCount());
  };

  const timer = setInterval(drainNow, HEARTBEAT_MS);

  return {
    drainNow,
    stop() { clearInterval(timer); },
  };
}

async function post(url: string, body: unknown): Promise<void> {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Dashboard may be closed — live streaming is best-effort. Recording
    // integrity depends only on the final /report POST in controller.stop.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/rxjs-leak-detector && npx vitest run test/runtime/live-emitter.test.ts`
Expected: PASS (4 tests).

---

## Task 6: Wire emitter into enable.ts

**Files:**
- Modify: `packages/rxjs-leak-detector/src/runtime/enable.ts`
- Test: `packages/rxjs-leak-detector/test/runtime/enable.test.ts`

- [ ] **Step 1: Write the failing test** (append inside the existing top-level `describe`)

The existing file imports `{ Observable } from 'rxjs'` and passes it directly. Reuse that. Add:

```ts
  it('POSTs /session/start when recording starts and /report on stop', async () => {
    const calls: string[] = [];
    global.fetch = ((url: string) => {
      calls.push(String(url));
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as any;

    const controller = enableRxjsLeakDetector(Observable, { dashboardUrl: 'http://d', disableWidget: true })!;
    controller.start();
    expect(calls.some(u => u.endsWith('/session/start'))).toBe(true);
    await controller.stop();
    expect(calls.some(u => u.endsWith('/report'))).toBe(true);
    controller.teardown();
  });
```

Note: `beforeEach` already deletes `globalThis.__rldController`, so each test gets a fresh controller.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/rxjs-leak-detector && npx vitest run test/runtime/enable.test.ts`
Expected: FAIL — no `/session/start` call (emitter not wired).

- [ ] **Step 3: Wire the emitter**

Add the import:

```ts
import { startLiveEmitter, type LiveEmitter } from './live-emitter.js';
```

Inside `enableRxjsLeakDetector`, after `let widget: WidgetController | null = null;` add:

```ts
  let emitter: LiveEmitter | null = null;
```

Change the route-tracker wiring so navigations trigger an immediate drain:

```ts
  const stopRouteTracker = installRouteTracker((change) => {
    recorder.recordNavigation(change);
    emitter?.drainNow();
  });
```

Update `start()`:

```ts
    start() {
      recorder.start();
      widget?.setRecording(true);
      emitter = startLiveEmitter({
        recorder,
        dashboardUrl,
        recordingId: recorder.currentRecordingId!,
        initialRoute: recorder.initialRoute,
        startedAtMs: recorder.startedAtMs,
        widget,
      });
    },
```

Update `stop()` to stop the emitter before the final report:

```ts
    async stop() {
      emitter?.stop();
      emitter = null;
      const report = recorder.stop();
      widget?.setRecording(false);
      await sendReport(report, dashboardUrl);
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/rxjs-leak-detector && npx vitest run test/runtime/enable.test.ts`
Expected: PASS (all original + new test).

---

## Task 7: Widget pulse + live count

**Files:**
- Modify: `packages/rxjs-leak-detector/src/runtime/widget.ts`
- Test: `packages/rxjs-leak-detector/test/runtime/widget.test.ts`

- [ ] **Step 1: Write the failing tests** (append inside `describe('mountWidget', ...)`)

```ts
  it('exposes setLeakCount and shows the count while recording', () => {
    const controller = mountWidget({ onStart: () => {}, onStop: () => {} });
    controller.setRecording(true);
    controller.setLeakCount(3);
    const widget = document.getElementById('__rld_widget')!;
    expect(widget.textContent).toContain('3');
    // Stop button must remain present and clickable.
    expect(widget.querySelector('button[data-action="stop"]')).toBeTruthy();
  });

  it('setLeakCount before recording does not throw and shows nothing live', () => {
    const controller = mountWidget({ onStart: () => {}, onStop: () => {} });
    expect(() => controller.setLeakCount(5)).not.toThrow();
    // Idle state still shows the Rec button.
    expect(document.querySelector('#__rld_widget button[data-action="start"]')).toBeTruthy();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/rxjs-leak-detector && npx vitest run test/runtime/widget.test.ts`
Expected: FAIL — `controller.setLeakCount is not a function`.

- [ ] **Step 3: Implement the changes**

Add `setLeakCount` to the controller type at the top:

```ts
export type WidgetController = {
  setRecording(recording: boolean): void;
  setLeakCount(n: number): void;
  unmount(): void;
};
```

Add a `leakCount` state variable next to `let recording = false;`:

```ts
  let recording = false;
  let leakCount = 0;
```

Add a one-time keyframes injector and call it in `mountWidget` (before `render()`):

```ts
  ensurePulseStyle();
```

Define it near the bottom of the module (outside `mountWidget`):

```ts
function ensurePulseStyle(): void {
  if (document.getElementById('__rld_pulse_style')) return;
  const style = document.createElement('style');
  style.id = '__rld_pulse_style';
  style.textContent = '@keyframes __rld_pulse{0%{opacity:1}50%{opacity:.3}100%{opacity:1}}';
  document.head.appendChild(style);
}
```

Update the recording branch of `render()` to prepend a pulsing status span:

```ts
    if (recording) {
      const status = document.createElement('span');
      status.dataset.role = 'live';
      status.style.marginRight = '8px';
      const dot = document.createElement('span');
      Object.assign(dot.style, {
        display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
        background: '#f28b82', marginRight: '5px', animation: '__rld_pulse 1.4s infinite',
      });
      status.appendChild(dot);
      status.appendChild(document.createTextNode(`Rec · ${leakCount}`));
      root.appendChild(status);

      btn.textContent = '■ Stop';
      btn.dataset.action = 'stop';
      btn.addEventListener('click', (e) => { if (!e.defaultPrevented) cb.onStop(); });
      root.appendChild(btn);
    } else {
```

(The `const btn = ...` declaration and styling stay above this block exactly as today.)

Add `setLeakCount` to the returned controller:

```ts
  return {
    setRecording(r: boolean) { recording = r; render(); },
    setLeakCount(n: number) { leakCount = n; if (recording) render(); },
    unmount() { root.remove(); },
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/rxjs-leak-detector && npx vitest run test/runtime/widget.test.ts`
Expected: PASS (all original drag/click tests + 2 new). The original "Stop button" and "does not render Mark Nav" tests must stay green.

---

## Task 8: Dashboard live buffer (pure logic)

**Files:**
- Create: `packages/rxjs-leak-detector/src/dashboard/live-buffer.ts`
- Test: `packages/rxjs-leak-detector/test/dashboard/live-buffer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/rxjs-leak-detector/test/dashboard/live-buffer.test.ts
import { describe, it, expect } from 'vitest';
import { createLiveBuffer, applyDelta, liveCandidateTags } from '../../src/dashboard/live-buffer.js';
import type { SubscriptionTag } from '../../src/runtime/types.js';

function tag(id: string, route: string, closed = false): SubscriptionTag {
  return { id, createdAtMs: 0, route, stackRaw: 'Error\n at f (http://localhost/src/x.ts:1:1)', observableKind: 'interval', recordingId: 'rec-1', closed };
}

describe('live-buffer', () => {
  it('applies added subs and navigations', () => {
    const buf = createLiveBuffer('/a');
    applyDelta(buf, { recordingId: 'rec-1', seq: 1, navigations: [{ fromRoute: '/a', toRoute: '/b', atMs: 1 }], added: [tag('s1', '/a')], closedIds: [], currentRoute: '/b' });
    expect(buf.subscriptions.size).toBe(1);
    expect(buf.currentRoute).toBe('/b');
  });

  it('marks closed subs from closedIds', () => {
    const buf = createLiveBuffer('/a');
    applyDelta(buf, { recordingId: 'rec-1', seq: 1, navigations: [], added: [tag('s1', '/a')], closedIds: [], currentRoute: '/a' });
    applyDelta(buf, { recordingId: 'rec-1', seq: 2, navigations: [], added: [], closedIds: ['s1'], currentRoute: '/a' });
    expect(buf.subscriptions.get('s1')!.closed).toBe(true);
  });

  it('liveCandidateTags = open subs whose route was left', () => {
    const buf = createLiveBuffer('/a');
    applyDelta(buf, {
      recordingId: 'rec-1', seq: 1,
      navigations: [{ fromRoute: '/a', toRoute: '/b', atMs: 1 }],
      added: [tag('s1', '/a'), tag('s2', '/b')], closedIds: [], currentRoute: '/b',
    });
    const candidates = liveCandidateTags(buf);
    expect(candidates.map(t => t.id)).toEqual(['s1']); // s2 is on the current route, not a candidate
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/rxjs-leak-detector && npx vitest run test/dashboard/live-buffer.test.ts`
Expected: FAIL — cannot resolve `live-buffer.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/rxjs-leak-detector/src/dashboard/live-buffer.ts
import type { SubscriptionTag, NavigationEvent } from '../runtime/types.js';
import type { SessionDelta } from '../shared/live-protocol.js';

export type LiveBuffer = {
  subscriptions: Map<string, SubscriptionTag>;
  navigations: NavigationEvent[];
  currentRoute: string;
};

export function createLiveBuffer(initialRoute: string): LiveBuffer {
  return { subscriptions: new Map(), navigations: [], currentRoute: initialRoute };
}

export function applyDelta(buf: LiveBuffer, delta: SessionDelta): void {
  for (const t of delta.added) buf.subscriptions.set(t.id, t);
  for (const id of delta.closedIds) {
    const existing = buf.subscriptions.get(id);
    if (existing) buf.subscriptions.set(id, { ...existing, closed: true });
  }
  buf.navigations.push(...delta.navigations);
  buf.currentRoute = delta.currentRoute;
}

/** Open subscriptions whose creation route has been navigated away from. */
export function liveCandidateTags(buf: LiveBuffer): SubscriptionTag[] {
  const left = new Set<string>();
  for (const nav of buf.navigations) left.add(nav.fromRoute);
  const out: SubscriptionTag[] = [];
  for (const tag of buf.subscriptions.values()) {
    if (tag.closed) continue;
    if (!left.has(tag.route)) continue;
    out.push(tag);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/rxjs-leak-detector && npx vitest run test/dashboard/live-buffer.test.ts`
Expected: PASS (3 tests).

---

## Task 9: Dashboard app — EventSource wiring

`app.ts` cannot be unit-tested in vitest (it imports `mappings.wasm?url`, a Vite-only feature). It is verified manually in Task 11. Keep this task minimal and lean on the already-tested `live-buffer` + existing `buildReport`.

**Files:**
- Modify: `packages/rxjs-leak-detector/src/dashboard/app.ts`

- [ ] **Step 1: Reuse the shared framework filter (dedupe)**

Replace the inline `FRAMEWORK_URL_PATTERNS` array and the `isFrameworkUrl` function in `app.ts` with an import:

```ts
import { isFrameworkUrl } from '../shared/framework-filter.js';
```

Delete the local `const FRAMEWORK_URL_PATTERNS = [...]` and `function isFrameworkUrl(...)` definitions (keep `FRAMEWORK_PATH_PATTERNS` / `isFrameworkPath` — those are post-symbolication and stay local).

- [ ] **Step 2: Memoize source-map fetches**

Add a module-level cache so repeated `buildReport` calls across deltas don't refetch maps:

```ts
const sourceMapCache = new Map<string, RawSourceMap | null>();
```

Wrap the body of `fetchSourceMap` so it consults the cache first:

```ts
async function fetchSourceMap(url: string): Promise<RawSourceMap | null> {
  if (sourceMapCache.has(url)) return sourceMapCache.get(url)!;
  const result = await fetchSourceMapUncached(url);
  sourceMapCache.set(url, result);
  return result;
}
```

Rename the existing `fetchSourceMap` implementation to `fetchSourceMapUncached`.

- [ ] **Step 3: Add live-mode wiring**

Add imports near the top:

```ts
import { createLiveBuffer, applyDelta, type LiveBuffer } from './live-buffer.js';
import type { SessionStart, SessionDelta } from '../shared/live-protocol.js';
```

After `const root = ...` and `const sessionsEl = ...`, add the EventSource wiring:

```ts
let liveBuf: LiveBuffer | null = null;
let liveRecordingId: string | null = null;

function connectLive(): void {
  const es = new EventSource('/live');

  es.addEventListener('session-start', (e) => {
    const start = JSON.parse((e as MessageEvent).data) as SessionStart;
    liveRecordingId = start.recordingId;
    liveBuf = createLiveBuffer(start.initialRoute);
    root.live = true;
    root.liveCandidates = [];
    root.error = null;
  });

  es.addEventListener('delta', (e) => {
    if (!liveBuf || !liveRecordingId) return;
    const delta = JSON.parse((e as MessageEvent).data) as SessionDelta;
    if (delta.recordingId !== liveRecordingId) return;
    applyDelta(liveBuf, delta);
    void renderLive();
  });

  es.addEventListener('session-end', async () => {
    root.live = false;
    liveBuf = null;
    liveRecordingId = null;
    await refresh();
    const first = sessionsEl.querySelector('.session') as HTMLElement | null;
    first?.click(); // select the just-finalized (newest) session
  });

  // EventSource auto-reconnects on drop; if a gap is suspected, hard-reset.
  es.onerror = () => { /* browser retries using the server's `retry:` hint */ };
}

async function renderLive(): Promise<void> {
  if (!liveBuf || !liveRecordingId) return;
  const stored: StoredReport = {
    meta: {
      recordingId: liveRecordingId,
      initialRoute: liveBuf.navigations[0]?.fromRoute ?? liveBuf.currentRoute,
      startedAtMs: 0,
      stoppedAtMs: 0,
      navigations: liveBuf.navigations,
    },
    subscriptions: [...liveBuf.subscriptions.values()],
  };
  const report = await buildReport(stored);
  if (root.live) root.liveCandidates = report.leaks;
}
```

At the bottom of the file, start the live connection alongside the existing poll:

```ts
connectLive();
```

(`buildReport` already filters open + left-route + framework via source maps, so live candidates are the authoritative symbolicated list. Note: `buildReport` rebuilds `SourceMapConsumer`s each call; the fetch cache from Step 2 removes the network cost. Consumer-level caching is a deferred optimization, acceptable because live deltas are small.)

- [ ] **Step 4: Typecheck**

Run: `cd packages/rxjs-leak-detector && npx tsc -p tsconfig.json --noEmit`
Expected: PASS. (`root.live` / `root.liveCandidates` are `any` via the existing `root as any`, so no type error here; the real types are added in Task 10.)

---

## Task 10: panel-ui live mode

**Files:**
- Modify: `packages/panel-ui/src/components/leak-detector-root.ts`
- Test: `packages/panel-ui/test/leak-detector-root.test.ts`

- [ ] **Step 1: Write the failing tests** (append inside the existing `describe`)

```ts
  it('renders the waiting state when live with no candidates', async () => {
    const el = document.createElement('leak-detector-root') as any;
    el.live = true;
    el.liveCandidates = [];
    document.body.append(el);
    await el.updateComplete;
    expect(el.shadowRoot.textContent).toContain('Waiting for leaks');
    expect(el.shadowRoot.querySelector('.live-banner')).toBeTruthy();
  });

  it('renders a leak-list of candidates when live with candidates', async () => {
    const el = document.createElement('leak-detector-root') as any;
    el.live = true;
    el.liveCandidates = [{
      id: 'a', route: '/', observableKind: 'interval',
      sourceLocation: { file: 'src/x.ts', line: 1, column: 1 },
      componentName: 'XComponent', stack: [], retainerChain: [],
    }];
    document.body.append(el);
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('leak-list')).toBeTruthy();
    expect(el.shadowRoot.textContent).not.toContain('Waiting for leaks');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/panel-ui && npx vitest run test/leak-detector-root.test.ts`
Expected: FAIL — no `.live-banner` / "Waiting for leaks" (live mode not implemented).

- [ ] **Step 3: Implement live mode**

Update the import to also pull `LeakEntry`:

```ts
import type { LeakReport, LeakEntry } from '@rld/analyzer-core';
```

Add the new reactive properties next to the existing ones:

```ts
  @property({ type: Boolean }) live = false;
  @property({ type: Array }) liveCandidates: LeakEntry[] = [];
```

Extend `static styles` with the live styles (append to the existing css template):

```ts
    .live-banner { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #33312b; border-bottom: 1px solid #5f6368; color: #f28b82; font-weight: bold; letter-spacing: .5px; }
    .live-banner .dot { width: 9px; height: 9px; border-radius: 50%; background: #f28b82; animation: rld-pulse 1.4s infinite; }
    @keyframes rld-pulse { 0% { opacity: 1 } 50% { opacity: .3 } 100% { opacity: 1 } }
    .waiting { padding: 48px 16px; text-align: center; color: #8ab4f8; }
    .radar { width: 48px; height: 48px; margin: 0 auto 14px; border: 2px solid #3c4043; border-top-color: #8ab4f8; border-radius: 50%; animation: rld-spin 1s linear infinite; }
    @keyframes rld-spin { to { transform: rotate(360deg) } }
    .waiting .hint { font-size: 11px; color: #9aa0a6; margin-top: 6px; }
```

Add a live-render branch at the very top of `render()` (before the existing return):

```ts
  render() {
    if (this.live) {
      return html`
        <div>
          <div class="live-banner"><span class="dot"></span> LIVE — recording</div>
          ${this.liveCandidates.length === 0
            ? html`<div class="waiting">
                <div class="radar"></div>
                <div>Waiting for leaks…</div>
                <div class="hint">Navigate your app. Subscriptions that outlive their route show up here.</div>
              </div>`
            : html`<leak-list .leaks=${this.liveCandidates}></leak-list>`}
        </div>
      `;
    }
    return html`
      <div>
        ${this.error ? html`<div class="error">${this.error}</div>` : ''}
        ${this.renderProgress()}
        ${this.report ? html`
          <div>
            <leak-summary .report=${this.report}></leak-summary>
            ${this.report.leaks.length === 0
              ? html`<empty-state message="No leaks detected ✓"></empty-state>`
              : html`<leak-list .leaks=${this.report.leaks}></leak-list>`}
            <long-lived-section .entries=${this.report.longLivedServiceSubscriptions}></long-lived-section>
          </div>
        ` : html`<empty-state></empty-state>`}
      </div>
    `;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/panel-ui && npx vitest run test/leak-detector-root.test.ts`
Expected: PASS (all original + 2 new tests).

---

## Task 11: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole rxjs-leak-detector suite**

Run: `cd packages/rxjs-leak-detector && npx vitest run`
Expected: PASS — all suites green (recorder, widget, enable, dashboard-server, transport, live-emitter, live-buffer, framework-filter, route-tracker, patch).

- [ ] **Step 2: Run the panel-ui suite**

Run: `cd packages/panel-ui && npx vitest run`
Expected: PASS.

- [ ] **Step 3: Typecheck both packages**

Run: `cd packages/rxjs-leak-detector && npx tsc -p tsconfig.json --noEmit && cd ../panel-ui && npx tsc -p tsconfig.json --noEmit`
Expected: PASS, no errors.

- [ ] **Step 4: Build the dashboard bundle**

Run: `cd packages/rxjs-leak-detector && pnpm build`
Expected: PASS — `build-dashboard.mjs` produces the dashboard static assets including the new `app.ts` wiring.

- [ ] **Step 5: Manual smoke test**

In a host app that calls `enableRxjsLeakDetector(Observable, { dashboardUrl: 'http://localhost:7654' })` (or the runtime `@rld/runtime` integration) with a deliberate leak (e.g. an `interval().subscribe()` in a component's `ngOnInit` with no teardown):

1. Start the dashboard: `npx rld --port 7654` (or the project's documented CLI) and open `http://localhost:7654`.
2. Confirm the dashboard shows the past-sessions list (no live banner yet).
3. In the app, click **● Rec**. Confirm: dashboard switches to the **LIVE — recording** banner + spinning "Waiting for leaks…"; the widget shows a pulsing dot + `Rec · 0`.
4. Navigate away from the leaking component's route. Within ~2s confirm: the leak candidate appears in the dashboard live list, and the widget count ticks up (`Rec · 1`).
5. Click **■ Stop**. Confirm: live banner disappears and the panel swaps to the full symbolicated report (stack frames, source links) for the just-finished session.
6. With the dashboard tab **closed**, repeat Rec → navigate → Stop. Confirm the app does not error and a session file still lands in `.rld/` (best-effort live, guaranteed final report).

---

## Self-Review Notes

- **Spec coverage:** transport (Tasks 1,4,5,6,9), live verdict reuse via `buildReport` (Task 9), widget pulse+count (Tasks 3,5,7), waiting/streaming UI (Task 10), heartbeat (Task 5), server relay+replay+TTL+session-end (Task 4), best-effort failure handling (Tasks 5,11), shared framework filter dedupe (Tasks 2,9). All covered.
- **Deferred (matches spec YAGNI):** `SourceMapConsumer`-level caching across deltas (fetch caching done in Task 9 Step 2 instead); multi-live panels; live retainer chains; disable-live config flag.
- **Type consistency:** `SessionStart` / `SessionDelta` defined once (Task 1) and imported everywhere; `drainDelta()` / `liveCandidateCount()` / `setLeakCount()` / `live` / `liveCandidates` names used identically across producer and consumer tasks.
