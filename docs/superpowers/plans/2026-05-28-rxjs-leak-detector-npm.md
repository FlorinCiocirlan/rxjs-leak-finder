# `rxjs-leak-detector` NPM Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `rxjs-leak-detector` npm package — a single user-facing dev dependency that replaces the Chrome extension as the primary distribution. User adds one line to `main.ts`, runs `npx rxjs-leak-detector dashboard`, and sees leaks in a local web dashboard.

**Architecture:** Single npm package with three concerns — `runtime/` (browser-imported, patches Observable, records subs, optional floating widget), `cli/` (Node, runs the dashboard http server), `dashboard/` (static HTML served by the CLI, uses existing `@rld/panel-ui` Lit components).

**Tech Stack:** TypeScript 5.4+, Vitest 1.6+ with happy-dom, Lit 3+ (for dashboard), Node built-in `http` + `fs` (no Express dep — keep it tiny), tsup for the runtime bundle.

**Reused from existing monorepo:** `@rld/analyzer-core` (classifier + source-map-resolver + types), `@rld/panel-ui` (Lit components for the dashboard).

---

## Phase 1 — Package Scaffold

### Task 1.1: Create `packages/rxjs-leak-detector/` skeleton

**Files:**
- Create: `packages/rxjs-leak-detector/package.json`
- Create: `packages/rxjs-leak-detector/tsconfig.json`
- Create: `packages/rxjs-leak-detector/tsconfig.cli.json`
- Create: `packages/rxjs-leak-detector/tsconfig.runtime.json`
- Create: `packages/rxjs-leak-detector/vitest.config.ts`
- Create: `packages/rxjs-leak-detector/.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "rxjs-leak-detector",
  "version": "0.1.0",
  "description": "Detect unsubscribed RxJS subscriptions in Angular dev-mode apps. One line in main.ts, no Chrome extension.",
  "type": "module",
  "main": "./dist/runtime/index.js",
  "types": "./dist/runtime/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/runtime/index.d.ts",
      "import": "./dist/runtime/index.js"
    }
  },
  "bin": {
    "rxjs-leak-detector": "./dist/cli/index.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.runtime.json && tsc -p tsconfig.cli.json && node scripts/build-dashboard.mjs",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "files": [
    "dist/",
    "README.md"
  ],
  "dependencies": {
    "@rld/analyzer-core": "workspace:*",
    "source-map": "^0.7.4"
  },
  "devDependencies": {
    "@rld/panel-ui": "workspace:*",
    "happy-dom": "^14.10.1",
    "lit": "^3.1.0",
    "rxjs": "^7.8.1"
  },
  "keywords": ["rxjs", "angular", "memory-leak", "subscription", "devtools"],
  "license": "MIT"
}
```

Note: Lit is a devDependency because the runtime/ bundle (which the user imports) must NOT ship Lit. Only the dashboard/ bundle (compiled separately into the CLI's static assets) uses Lit.

- [ ] **Step 2: Create `tsconfig.json` (root, for typechecking only)**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["test", "dist"]
}
```

- [ ] **Step 3: Create `tsconfig.runtime.json`** (builds runtime portion, no Node types):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist/runtime",
    "rootDir": "./src/runtime",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler"
  },
  "include": ["src/runtime/**/*.ts"]
}
```

- [ ] **Step 4: Create `tsconfig.cli.json`** (builds CLI, includes Node types):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist/cli",
    "rootDir": "./src/cli",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["node"]
  },
  "include": ["src/cli/**/*.ts"]
}
```

- [ ] **Step 5: Create `vitest.config.ts`**:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
    environmentMatchGlobs: [
      ['test/cli/**', 'node'],
      ['test/runtime/**', 'happy-dom'],
    ],
  },
});
```

- [ ] **Step 6: Create `.gitignore`**:

```
dist/
node_modules/
.rld/
```

- [ ] **Step 7: Run `pnpm install` from repo root**

Confirm `rxjs-leak-detector` shows up in `pnpm ls -r --depth=-1`.

---

## Phase 2 — Runtime (Browser)

### Task 2.1: Shared types

**Files:**
- Create: `packages/rxjs-leak-detector/src/runtime/types.ts`

- [ ] **Step 1: Define types** (re-uses analyzer-core's `LeakEntry` etc.):

```ts
import type {
  SubscriptionTag,
  LeakReport,
  RecordingMeta,
} from '@rld/analyzer-core';

export type EnableConfig = {
  /** Disable the floating widget. Default: false. */
  disableWidget?: boolean;
  /** Dashboard server URL. Default: 'http://localhost:7654'. */
  dashboardUrl?: string;
  /** Explicitly disable everything (useful for shared bootstrapping). Default: true (enabled). */
  enabled?: boolean;
};

export type SubRef = {
  id: string;
  tag: SubscriptionTag;
};

export type RecordingReport = {
  meta: RecordingMeta;
  subscriptions: SubscriptionTag[];  // all tagged subs from the recording window
};

export type { SubscriptionTag, LeakReport, RecordingMeta };
```

### Task 2.2: `patch.ts`

Same logic as existing `@rld/tagger/src/patch-rxjs.ts` but takes Observable as argument.

**Files:**
- Create: `packages/rxjs-leak-detector/src/runtime/patch.ts`
- Create: `packages/rxjs-leak-detector/test/runtime/patch.test.ts`

- [ ] **Step 1: Write test** at `test/runtime/patch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Observable, Subject, interval } from 'rxjs';
import { installPatch, type Recorder } from '../../src/runtime/patch.js';

function mockRecorder(): Recorder & { events: string[] } {
  const events: string[] = [];
  return {
    events,
    onSubscribe(sub, observable, stack) {
      events.push(`sub:${observable.constructor?.name ?? 'Observable'}`);
    },
    onUnsubscribe(sub) {
      events.push('unsub');
    },
  };
}

describe('installPatch', () => {
  it('is idempotent', () => {
    const r = mockRecorder();
    installPatch(Observable, r);
    installPatch(Observable, r);
    // First install patches; second is no-op. No extra events.
    new Observable<number>(o => o.complete()).subscribe();
    expect(r.events.filter(e => e.startsWith('sub:'))).toHaveLength(1);
  });

  it('calls onSubscribe on new Subscription', () => {
    const r = mockRecorder();
    installPatch(Observable, r);
    new Subject<void>().subscribe();
    expect(r.events.some(e => e.startsWith('sub:'))).toBe(true);
  });

  it('calls onUnsubscribe when subscription is unsubscribed', () => {
    const r = mockRecorder();
    installPatch(Observable, r);
    const sub = new Subject<void>().subscribe();
    r.events.length = 0;
    sub.unsubscribe();
    expect(r.events).toContain('unsub');
  });
});
```

- [ ] **Step 2: Implement** at `src/runtime/patch.ts`:

```ts
export type Recorder = {
  onSubscribe(subscription: object, observable: object, stack: string): void;
  onUnsubscribe(subscription: object): void;
};

const PATCHED = Symbol.for('__rld_patched');
const UNSUB_PATCHED = Symbol.for('__rld_unsub_patched');

export function installPatch(ObservableCtor: any, recorder: Recorder): void {
  const proto = ObservableCtor.prototype;
  if ((proto as any)[PATCHED]) return;
  Object.defineProperty(proto, PATCHED, { value: true, enumerable: false });

  const origSubscribe = proto.subscribe;
  proto.subscribe = function patchedSubscribe(this: any, ...args: any[]) {
    const subscription = origSubscribe.apply(this, args);
    const stack = new Error().stack ?? '';
    recorder.onSubscribe(subscription, this, stack);
    const subProto = Object.getPrototypeOf(subscription);
    if (subProto && !(subProto as any)[UNSUB_PATCHED] && typeof subProto.unsubscribe === 'function') {
      Object.defineProperty(subProto, UNSUB_PATCHED, { value: true, enumerable: false });
      const origUnsub = subProto.unsubscribe;
      subProto.unsubscribe = function patchedUnsubscribe(this: any) {
        recorder.onUnsubscribe(this);
        return origUnsub.call(this);
      };
    }
    return subscription;
  };
}
```

- [ ] **Step 3: Run tests** — `pnpm --filter rxjs-leak-detector test patch` → 3 pass.

### Task 2.3: `recorder.ts`

**Files:**
- Create: `packages/rxjs-leak-detector/src/runtime/recorder.ts`
- Create: `packages/rxjs-leak-detector/test/runtime/recorder.test.ts`

- [ ] **Step 1: Write test**:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createRecorder } from '../../src/runtime/recorder.js';

describe('createRecorder', () => {
  let recorder: ReturnType<typeof createRecorder>;

  beforeEach(() => {
    recorder = createRecorder();
  });

  it('starts a recording with current path as initial route', () => {
    window.history.replaceState({}, '', '/products');
    recorder.start();
    expect(recorder.isRecording).toBe(true);
  });

  it('tags new subscriptions with current recordingId and route', () => {
    window.history.replaceState({}, '', '/products');
    recorder.start();
    const fakeSub: any = {};
    const fakeObs: any = { constructor: { name: 'IntervalObservable' } };
    recorder.onSubscribe(fakeSub, fakeObs, 'Error: stack');
    expect(fakeSub.__sw_meta).toBeDefined();
    expect(fakeSub.__sw_meta.route).toBe('/products');
    expect(fakeSub.__sw_meta.recordingId).toBe(recorder.currentRecordingId);
    expect(fakeSub.__sw_meta.observableKind).toBe('IntervalObservable');
    expect(fakeSub.__sw_meta.closed).toBe(false);
  });

  it('flips closed=true when onUnsubscribe is called', () => {
    recorder.start();
    const fakeSub: any = {};
    recorder.onSubscribe(fakeSub, { constructor: { name: 'Observable' } }, 'Error');
    recorder.onUnsubscribe(fakeSub);
    expect(fakeSub.__sw_meta.closed).toBe(true);
  });

  it('stop() returns a report with all tagged subscriptions', () => {
    recorder.start();
    const fakeSub: any = {};
    recorder.onSubscribe(fakeSub, { constructor: { name: 'Observable' } }, 'Error');
    const report = recorder.stop();
    expect(report.subscriptions).toHaveLength(1);
    expect(report.subscriptions[0]!.id).toBe(fakeSub.__sw_meta.id);
  });

  it('does not tag when not recording', () => {
    const fakeSub: any = {};
    recorder.onSubscribe(fakeSub, { constructor: { name: 'Observable' } }, 'Error');
    expect(fakeSub.__sw_meta).toBeUndefined();
  });

  it('recordNavigation pushes a navigation and updates currentRoute', () => {
    window.history.replaceState({}, '', '/products');
    recorder.start();
    recorder.recordNavigation({ from: '/products', to: '/about' });
    const report = recorder.stop();
    expect(report.meta.navigations).toHaveLength(1);
    expect(report.meta.navigations[0]!.toRoute).toBe('/about');
  });
});
```

- [ ] **Step 2: Implement** at `src/runtime/recorder.ts`:

```ts
import type { SubscriptionTag } from '@rld/analyzer-core';
import type { RecordingReport } from './types.js';

function currentPath(): string {
  return window.location.pathname + window.location.search + window.location.hash;
}

function makeRecordingId(): string {
  return `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

let counter = 0;
function makeSubId(): string {
  counter += 1;
  return `s-${Date.now().toString(36)}-${counter.toString(36)}`;
}

function detectObservableKind(observable: any): string {
  return observable?.constructor?.name ?? 'Observable';
}

export type Recorder = ReturnType<typeof createRecorder>;

export function createRecorder() {
  type State = {
    recordingId: string | null;
    isRecording: boolean;
    initialRoute: string;
    currentRoute: string;
    startedAtMs: number;
    navigations: Array<{ fromRoute: string; toRoute: string; atMs: number }>;
    subscriptions: Map<string, { tag: SubscriptionTag }>;
  };

  const state: State = {
    recordingId: null,
    isRecording: false,
    initialRoute: '',
    currentRoute: '',
    startedAtMs: 0,
    navigations: [],
    subscriptions: new Map(),
  };

  return {
    get isRecording() { return state.isRecording; },
    get currentRecordingId() { return state.recordingId; },

    start(): void {
      const initial = currentPath();
      state.recordingId = makeRecordingId();
      state.isRecording = true;
      state.initialRoute = initial;
      state.currentRoute = initial;
      state.startedAtMs = Date.now();
      state.navigations = [];
      state.subscriptions = new Map();
    },

    stop(): RecordingReport {
      state.isRecording = false;
      return {
        meta: {
          recordingId: state.recordingId ?? '',
          initialRoute: state.initialRoute,
          startedAtMs: state.startedAtMs,
          stoppedAtMs: Date.now(),
          navigations: state.navigations.slice(),
        },
        subscriptions: [...state.subscriptions.values()].map(s => s.tag),
      };
    },

    markNavigation(): void {
      const next = currentPath();
      if (next === state.currentRoute) return;
      state.navigations.push({ fromRoute: state.currentRoute, toRoute: next, atMs: Date.now() });
      state.currentRoute = next;
    },

    recordNavigation(change: { from: string; to: string }): void {
      if (!state.isRecording) return;
      state.navigations.push({ fromRoute: change.from, toRoute: change.to, atMs: Date.now() });
      state.currentRoute = change.to;
    },

    onSubscribe(subscription: object, observable: object, stack: string): void {
      if (!state.isRecording || !state.recordingId) return;
      const tag: SubscriptionTag = {
        id: makeSubId(),
        createdAtMs: Date.now(),
        route: state.currentRoute,
        stackRaw: stack,
        observableKind: detectObservableKind(observable),
        recordingId: state.recordingId,
        closed: false,
      };
      Object.defineProperty(subscription, '__sw_meta', {
        value: tag,
        enumerable: false,
        writable: true,
        configurable: true,
      });
      state.subscriptions.set(tag.id, { tag });
    },

    onUnsubscribe(subscription: object): void {
      const meta = (subscription as any).__sw_meta as SubscriptionTag | undefined;
      if (!meta) return;
      meta.closed = true;
      const entry = state.subscriptions.get(meta.id);
      if (entry) entry.tag.closed = true;
    },
  };
}
```

- [ ] **Step 3: Run tests** → 6 pass.

### Task 2.4: `route-tracker.ts`

Reuse the same URL-fallback pattern from `@rld/tagger/src/route-tracker.ts`. Lift it (don't dynamically import — copy the file with minor adjustments).

**Files:**
- Create: `packages/rxjs-leak-detector/src/runtime/route-tracker.ts`
- Create: `packages/rxjs-leak-detector/test/runtime/route-tracker.test.ts`

- [ ] Reuse the test + implementation from `@rld/tagger/test/route-tracker.test.ts` and `@rld/tagger/src/route-tracker.ts`. Copy verbatim, adjust import paths.

### Task 2.5: `widget.ts`

**Files:**
- Create: `packages/rxjs-leak-detector/src/runtime/widget.ts`
- Create: `packages/rxjs-leak-detector/test/runtime/widget.test.ts`

- [ ] **Step 1: Write test** at `test/runtime/widget.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mountWidget } from '../../src/runtime/widget.js';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('mountWidget', () => {
  it('injects a fixed-position widget element', () => {
    mountWidget({ onStart: () => {}, onStop: () => {}, onMark: () => {} });
    const el = document.getElementById('__rld_widget');
    expect(el).toBeTruthy();
    expect(el!.style.position).toBe('fixed');
  });

  it('starts in idle state showing Rec button', () => {
    mountWidget({ onStart: () => {}, onStop: () => {}, onMark: () => {} });
    const btn = document.querySelector('#__rld_widget button[data-action="start"]');
    expect(btn?.textContent).toContain('Rec');
  });

  it('calls onStart when Rec button clicked', () => {
    const onStart = vi.fn();
    mountWidget({ onStart, onStop: () => {}, onMark: () => {} });
    (document.querySelector('#__rld_widget button[data-action="start"]') as HTMLElement).click();
    expect(onStart).toHaveBeenCalled();
  });

  it('setRecording(true) swaps to Stop button', () => {
    const controller = mountWidget({ onStart: () => {}, onStop: () => {}, onMark: () => {} });
    controller.setRecording(true);
    expect(document.querySelector('#__rld_widget button[data-action="stop"]')).toBeTruthy();
  });

  it('calls onStop when Stop button clicked', () => {
    const onStop = vi.fn();
    const controller = mountWidget({ onStart: () => {}, onStop, onMark: () => {} });
    controller.setRecording(true);
    (document.querySelector('#__rld_widget button[data-action="stop"]') as HTMLElement).click();
    expect(onStop).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement** at `src/runtime/widget.ts`:

```ts
export type WidgetController = {
  setRecording(recording: boolean): void;
  unmount(): void;
};

type WidgetCallbacks = {
  onStart(): void;
  onStop(): void;
  onMark(): void;
};

export function mountWidget(cb: WidgetCallbacks): WidgetController {
  const root = document.createElement('div');
  root.id = '__rld_widget';
  Object.assign(root.style, {
    position: 'fixed',
    bottom: '12px',
    right: '12px',
    zIndex: '2147483647',
    fontFamily: 'monospace',
    fontSize: '12px',
    background: '#2b2b2b',
    color: '#e8eaed',
    border: '1px solid #5f6368',
    borderRadius: '6px',
    padding: '6px 8px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
  });

  let recording = false;

  const render = () => {
    root.innerHTML = '';
    const btn = document.createElement('button');
    Object.assign(btn.style, {
      background: recording ? '#f28b82' : '#3c4043',
      color: '#e8eaed',
      border: '1px solid #5f6368',
      padding: '4px 10px',
      cursor: 'pointer',
      font: 'inherit',
      borderRadius: '4px',
    });
    if (recording) {
      btn.textContent = '■ Stop';
      btn.dataset.action = 'stop';
      btn.addEventListener('click', () => cb.onStop());
      root.appendChild(btn);

      const mark = document.createElement('button');
      Object.assign(mark.style, {
        background: '#3c4043', color: '#e8eaed', border: '1px solid #5f6368',
        padding: '4px 10px', cursor: 'pointer', font: 'inherit',
        borderRadius: '4px', marginLeft: '6px',
      });
      mark.textContent = 'Mark Nav';
      mark.dataset.action = 'mark';
      mark.addEventListener('click', () => cb.onMark());
      root.appendChild(mark);
    } else {
      btn.textContent = '● Rec';
      btn.dataset.action = 'start';
      btn.addEventListener('click', () => cb.onStart());
      root.appendChild(btn);
    }
  };

  render();
  document.body.appendChild(root);

  return {
    setRecording(r: boolean) { recording = r; render(); },
    unmount() { root.remove(); },
  };
}
```

- [ ] **Step 3: Run tests** → 5 pass.

### Task 2.6: `transport.ts`

**Files:**
- Create: `packages/rxjs-leak-detector/src/runtime/transport.ts`
- Create: `packages/rxjs-leak-detector/test/runtime/transport.test.ts`

- [ ] **Step 1: Write test** at `test/runtime/transport.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sendReport, flushQueue } from '../../src/runtime/transport.js';
import type { RecordingReport } from '../../src/runtime/types.js';

const sampleReport: RecordingReport = {
  meta: {
    recordingId: 'rec-1', initialRoute: '/', startedAtMs: 0,
    stoppedAtMs: 1000, navigations: [{ fromRoute: '/', toRoute: '/x', atMs: 500 }],
  },
  subscriptions: [],
};

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('sendReport', () => {
  it('POSTs the report to dashboardUrl/report', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    global.fetch = fetchMock as any;
    await sendReport(sampleReport, 'http://localhost:7654');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:7654/report',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('enqueues to localStorage on network failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network')) as any;
    await sendReport(sampleReport, 'http://localhost:7654');
    const queue = JSON.parse(localStorage.getItem('__rld_queue') ?? '[]');
    expect(queue).toHaveLength(1);
  });

  it('enqueues on non-OK HTTP status', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('boom', { status: 500 })) as any;
    await sendReport(sampleReport, 'http://localhost:7654');
    const queue = JSON.parse(localStorage.getItem('__rld_queue') ?? '[]');
    expect(queue).toHaveLength(1);
  });
});

describe('flushQueue', () => {
  it('retries all queued reports and clears on success', async () => {
    localStorage.setItem('__rld_queue', JSON.stringify([sampleReport, sampleReport]));
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    global.fetch = fetchMock as any;
    await flushQueue('http://localhost:7654');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('__rld_queue')).toBe('[]');
  });

  it('leaves reports in queue if all fail', async () => {
    localStorage.setItem('__rld_queue', JSON.stringify([sampleReport]));
    global.fetch = vi.fn().mockRejectedValue(new Error('Network')) as any;
    await flushQueue('http://localhost:7654');
    expect(JSON.parse(localStorage.getItem('__rld_queue')!)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Implement** at `src/runtime/transport.ts`:

```ts
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
```

- [ ] **Step 3: Run tests** → 5 pass.

### Task 2.7: `enable.ts` — top-level entry

**Files:**
- Create: `packages/rxjs-leak-detector/src/runtime/index.ts`
- Create: `packages/rxjs-leak-detector/src/runtime/enable.ts`
- Create: `packages/rxjs-leak-detector/test/runtime/enable.test.ts`

- [ ] **Step 1: Write test** at `test/runtime/enable.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Observable } from 'rxjs';
import { enableRxjsLeakDetector } from '../../src/runtime/enable.js';

beforeEach(() => {
  document.body.innerHTML = '';
  delete (globalThis as any).__rldController;
});

describe('enableRxjsLeakDetector', () => {
  it('installs the patch and mounts the widget', () => {
    enableRxjsLeakDetector(Observable);
    expect(document.getElementById('__rld_widget')).toBeTruthy();
  });

  it('respects disableWidget', () => {
    enableRxjsLeakDetector(Observable, { disableWidget: true });
    expect(document.getElementById('__rld_widget')).toBeFalsy();
  });

  it('bails when enabled: false', () => {
    enableRxjsLeakDetector(Observable, { enabled: false });
    expect(document.getElementById('__rld_widget')).toBeFalsy();
  });

  it('exposes controller on window.__rldController', () => {
    enableRxjsLeakDetector(Observable);
    const c = (window as any).__rldController;
    expect(c).toBeDefined();
    expect(typeof c.start).toBe('function');
    expect(typeof c.stop).toBe('function');
  });

  it('is idempotent — second call returns same controller', () => {
    const a = enableRxjsLeakDetector(Observable);
    const b = enableRxjsLeakDetector(Observable);
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Implement** at `src/runtime/enable.ts`:

```ts
import { installPatch } from './patch.js';
import { createRecorder } from './recorder.js';
import { installRouteTracker } from './route-tracker.js';
import { mountWidget, type WidgetController } from './widget.js';
import { sendReport, flushQueue } from './transport.js';
import type { EnableConfig } from './types.js';

export type LeakDetectorController = {
  start(): void;
  stop(): Promise<void>;
  markNavigation(): void;
  readonly isRecording: boolean;
};

let installed: LeakDetectorController | null = null;

export function enableRxjsLeakDetector(
  ObservableCtor: any,
  config: EnableConfig = {},
): LeakDetectorController | null {
  if (installed) return installed;
  if (config.enabled === false) return null;

  const dashboardUrl = config.dashboardUrl ?? 'http://localhost:7654';
  const recorder = createRecorder();
  installPatch(ObservableCtor, recorder);
  const routeStop = installRouteTracker(change => recorder.recordNavigation(change));

  let widget: WidgetController | null = null;

  const controller: LeakDetectorController = {
    get isRecording() { return recorder.isRecording; },
    start() {
      recorder.start();
      widget?.setRecording(true);
    },
    async stop() {
      const report = recorder.stop();
      widget?.setRecording(false);
      await sendReport(report, dashboardUrl);
    },
    markNavigation() {
      recorder.markNavigation();
    },
  };

  if (!config.disableWidget) {
    widget = mountWidget({
      onStart: () => controller.start(),
      onStop: () => void controller.stop(),
      onMark: () => controller.markNavigation(),
    });
  }

  (window as any).__rldController = controller;
  installed = controller;

  // Best-effort: flush any queued reports from a prior session
  void flushQueue(dashboardUrl);

  // Persist routeStop in case caller wants to tear down (rarely needed)
  (controller as any)._teardown = () => {
    routeStop();
    widget?.unmount();
    installed = null;
    delete (window as any).__rldController;
  };

  return controller;
}
```

- [ ] **Step 3: Create `src/runtime/index.ts`**:

```ts
export { enableRxjsLeakDetector } from './enable.js';
export type { EnableConfig, RecordingReport } from './types.js';
```

- [ ] **Step 4: Run all runtime tests** — should be ~24 passing across patch, recorder, route-tracker, widget, transport, enable.

---

## Phase 3 — CLI + Dashboard Server

### Task 3.1: HTTP server

**Files:**
- Create: `packages/rxjs-leak-detector/src/cli/dashboard-server.ts`
- Create: `packages/rxjs-leak-detector/test/cli/dashboard-server.test.ts`

- [ ] **Step 1: Write test** at `test/cli/dashboard-server.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startServer, type ServerHandle } from '../../src/cli/dashboard-server.js';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let cwd: string;
let server: ServerHandle;

beforeEach(async () => {
  cwd = mkdtempSync(join(tmpdir(), 'rld-test-'));
  server = await startServer({ port: 0, cwd, staticDir: undefined });
});

afterEach(async () => {
  await server.close();
  rmSync(cwd, { recursive: true, force: true });
});

const sampleReport = {
  meta: { recordingId: 'rec-1', initialRoute: '/', startedAtMs: 0, stoppedAtMs: 1000, navigations: [{ fromRoute: '/', toRoute: '/x', atMs: 500 }] },
  subscriptions: [],
};

describe('dashboard-server', () => {
  it('accepts POST /report and writes a file to .rld/', async () => {
    const res = await fetch(`${server.url}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sampleReport),
    });
    expect(res.ok).toBe(true);
    const files = readdirSync(join(cwd, '.rld'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.json$/);
  });

  it('GET /sessions lists committed reports', async () => {
    await fetch(`${server.url}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sampleReport),
    });
    const res = await fetch(`${server.url}/sessions`);
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list).toHaveLength(1);
    expect(list[0].recordingId).toBe('rec-1');
  });

  it('GET /sessions/:id returns the full report', async () => {
    await fetch(`${server.url}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sampleReport),
    });
    const list = await (await fetch(`${server.url}/sessions`)).json();
    const id = list[0].id;
    const res = await fetch(`${server.url}/sessions/${id}`);
    const body = await res.json();
    expect(body.meta.recordingId).toBe('rec-1');
  });

  it('serves CORS preflight for POST /report', async () => {
    const res = await fetch(`${server.url}/report`, { method: 'OPTIONS' });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
```

- [ ] **Step 2: Implement** at `src/cli/dashboard-server.ts`:

```ts
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';

export type ServerHandle = {
  url: string;
  port: number;
  close: () => Promise<void>;
};

export type StartServerOptions = {
  port: number;
  cwd: string;
  staticDir: string | undefined;
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export async function startServer(opts: StartServerOptions): Promise<ServerHandle> {
  const rldDir = join(opts.cwd, '.rld');
  if (!existsSync(rldDir)) mkdirSync(rldDir, { recursive: true });

  const server = createServer((req, res) => handleRequest(req, res, opts, rldDir));
  await new Promise<void>((resolveStart) => server.listen(opts.port, () => resolveStart()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;

  return {
    url: `http://localhost:${port}`,
    port,
    close: () => new Promise(r => server.close(() => r())),
  };
}

function setCors(res: ServerResponse) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: StartServerOptions,
  rldDir: string,
): Promise<void> {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'POST' && pathname === '/report') {
    return handleReport(req, res, rldDir);
  }
  if (req.method === 'GET' && pathname === '/sessions') {
    return handleSessionsList(res, rldDir);
  }
  if (req.method === 'GET' && pathname.startsWith('/sessions/')) {
    return handleSessionGet(res, rldDir, pathname.slice('/sessions/'.length));
  }
  if (req.method === 'GET' && pathname === '/source-maps') {
    const mapUrl = url.searchParams.get('url');
    return handleSourceMapProxy(res, mapUrl);
  }
  if (req.method === 'GET' && opts.staticDir) {
    return handleStatic(res, opts.staticDir, pathname);
  }

  res.writeHead(404).end('Not found');
}

async function handleReport(req: IncomingMessage, res: ServerResponse, rldDir: string): Promise<void> {
  const body = await readBody(req);
  let report: any;
  try { report = JSON.parse(body); }
  catch { res.writeHead(400).end('Invalid JSON'); return; }
  const recordingId = report?.meta?.recordingId ?? randomUUID();
  const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}-${recordingId}.json`;
  writeFileSync(join(rldDir, fileName), JSON.stringify(report, null, 2));
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, fileName }));
}

function handleSessionsList(res: ServerResponse, rldDir: string): void {
  const files = readdirSync(rldDir).filter(f => f.endsWith('.json'));
  const list = files.map(f => {
    const parsed = JSON.parse(readFileSync(join(rldDir, f), 'utf8'));
    return {
      id: f.replace(/\.json$/, ''),
      fileName: f,
      recordingId: parsed?.meta?.recordingId ?? null,
      createdAt: parsed?.meta?.startedAtMs ?? null,
      subscriptionCount: parsed?.subscriptions?.length ?? 0,
    };
  });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(list));
}

function handleSessionGet(res: ServerResponse, rldDir: string, id: string): void {
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, '');
  const file = join(rldDir, `${safe}.json`);
  if (!existsSync(file)) { res.writeHead(404).end('Not found'); return; }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(readFileSync(file));
}

async function handleSourceMapProxy(res: ServerResponse, mapUrl: string | null): Promise<void> {
  if (!mapUrl) { res.writeHead(400).end('Missing url param'); return; }
  try {
    const upstream = await fetch(mapUrl);
    if (!upstream.ok) { res.writeHead(upstream.status).end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(await upstream.text());
  } catch (err) {
    res.writeHead(502).end(String(err));
  }
}

function handleStatic(res: ServerResponse, staticDir: string, pathname: string): void {
  const filePath = resolve(staticDir, pathname === '/' ? 'index.html' : pathname.slice(1));
  if (!filePath.startsWith(resolve(staticDir))) { res.writeHead(403).end(); return; }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    // SPA fallback to index.html
    const index = resolve(staticDir, 'index.html');
    if (existsSync(index)) {
      res.writeHead(200, { 'content-type': MIME['.html']! });
      res.end(readFileSync(index));
      return;
    }
    res.writeHead(404).end();
    return;
  }
  const ext = extname(filePath).toLowerCase();
  res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
  res.end(readFileSync(filePath));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
```

- [ ] **Step 3: Run tests** → 4 pass.

### Task 3.2: CLI entry

**Files:**
- Create: `packages/rxjs-leak-detector/src/cli/index.ts`

- [ ] **Step 1: Implement**:

```ts
#!/usr/bin/env node
import { startServer } from './dashboard-server.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
const command = args[0];

if (command === 'dashboard') {
  const portArg = args.find(a => a.startsWith('--port='))?.slice('--port='.length);
  const port = portArg ? Number(portArg) : 7654;
  const noOpen = args.includes('--no-open');
  const cwdArg = args.find(a => a.startsWith('--cwd='))?.slice('--cwd='.length);
  const cwd = cwdArg ? resolve(cwdArg) : process.cwd();
  void runDashboard({ port, noOpen, cwd });
} else if (command === '--help' || command === '-h' || !command) {
  printHelp();
} else {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

async function runDashboard({ port, noOpen, cwd }: { port: number; noOpen: boolean; cwd: string }): Promise<void> {
  const here = fileURLToPath(import.meta.url);
  const staticDir = resolve(here, '../../dashboard');
  const handle = await startServer({ port, cwd, staticDir: existsSync(staticDir) ? staticDir : undefined });
  console.log(`RxJS Leak Detector dashboard listening at ${handle.url}`);
  console.log(`Reports will be saved to ${cwd}/.rld/`);
  if (!noOpen) {
    await openInBrowser(handle.url);
  }
  // Keep alive
  process.on('SIGINT', async () => {
    console.log('\nShutting down…');
    await handle.close();
    process.exit(0);
  });
}

async function openInBrowser(url: string): Promise<void> {
  const { spawn } = await import('node:child_process');
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open';
  spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
}

function printHelp(): void {
  console.log(`
rxjs-leak-detector — local dashboard for RxJS subscription leaks

Usage:
  npx rxjs-leak-detector dashboard [options]

Options:
  --port=<n>     Port to listen on (default 7654)
  --cwd=<path>   Where to write .rld/ session files (default cwd)
  --no-open      Don't auto-open the browser
  --help, -h     Show this help
`.trim());
}
```

---

## Phase 4 — Dashboard HTML

### Task 4.1: Dashboard app

**Files:**
- Create: `packages/rxjs-leak-detector/src/dashboard/index.html`
- Create: `packages/rxjs-leak-detector/src/dashboard/app.ts`
- Create: `packages/rxjs-leak-detector/scripts/build-dashboard.mjs`

- [ ] **Step 1: Create `src/dashboard/index.html`**:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>RxJS Leak Detector</title>
<style>
  body { margin: 0; font-family: 'SF Mono', Monaco, Consolas, monospace; font-size: 13px;
         background: #2b2b2b; color: #e8eaed; display: grid;
         grid-template-columns: 240px 1fr; min-height: 100vh; }
  aside { background: #1f1f1f; border-right: 1px solid #3c4043; padding: 12px; }
  aside h1 { font-size: 13px; margin: 0 0 12px; color: #9aa0a6; text-transform: uppercase; letter-spacing: 1px; }
  .session { padding: 8px; cursor: pointer; border-radius: 4px; }
  .session:hover { background: #3c4043; }
  .session.active { background: #1a73e8; color: white; }
  .session .when { color: #9aa0a6; font-size: 11px; }
  main { padding: 12px; }
</style>
</head>
<body>
<aside>
  <h1>Sessions</h1>
  <div id="sessions"></div>
</aside>
<main>
  <leak-detector-root id="root"></leak-detector-root>
</main>
<script type="module" src="./app.js"></script>
</body></html>
```

- [ ] **Step 2: Create `src/dashboard/app.ts`** — uses `@rld/panel-ui` components and the classifier/source-map-resolver from `@rld/analyzer-core`:

```ts
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
```

- [ ] **Step 3: Create `scripts/build-dashboard.mjs`** — bundles `src/dashboard/app.ts` (with @rld/panel-ui included) into `dist/dashboard/app.js`:

```js
#!/usr/bin/env node
import { build } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

await build({
  root: resolve(root, 'src/dashboard'),
  build: {
    outDir: resolve(root, 'dist/dashboard'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(root, 'src/dashboard/index.html'),
    },
  },
  publicDir: false,
});
console.log('dashboard built');
```

- [ ] **Step 4: Add `vite` to devDependencies** in package.json:

```json
"vite": "^5.2.0"
```

- [ ] **Step 5: Build** — `pnpm --filter rxjs-leak-detector build` should produce `dist/runtime/`, `dist/cli/`, and `dist/dashboard/`.

---

## Phase 5 — Adjust `@rld/panel-ui` for No-Retainer Mode

### Task 5.1: Update `<leak-detail>` to hide retainer chain when empty

**Files:**
- Modify: `packages/panel-ui/src/components/leak-detail.ts`

- [ ] **Step 1: Edit the render method** to skip the retainer chain section when the array is empty:

```ts
render() {
  return html`
    <div>
      <div class="section">
        <h4>Observable</h4>
        ${this.leak.observableKind}
      </div>
      <div class="section">
        <h4>Stack</h4>
        ${this.leak.stack.map((f) => html`<stack-frame .frame=${f}></stack-frame>`)}
      </div>
      ${this.leak.retainerChain.length > 0 ? html`
        <div class="section">
          <h4>Retainer chain</h4>
          <div class="retainer">
            ${this.leak.retainerChain.map((n) => html`<span>${n.constructorName}</span>`)}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}
```

- [ ] **Step 2: Run panel-ui tests** to confirm no regressions.

---

## Phase 6 — README + Final Verification

### Task 6.1: Write the user-facing README

**Files:**
- Create: `packages/rxjs-leak-detector/README.md`

- [ ] Include: install command, Angular `main.ts` snippet, `npx rxjs-leak-detector dashboard` usage, config options, limitations vs the heap-snapshot/extension mode, troubleshooting.

### Task 6.2: End-to-end build verification

- [ ] Run `pnpm install && pnpm -r build` from repo root. Confirm all packages build without errors.
- [ ] Run `pnpm --filter rxjs-leak-detector test`. Confirm all tests pass (~33 tests across runtime + cli).
- [ ] Manual smoke: in a separate terminal `cd /tmp && mkdir test && cd test && pnpm link ../path/to/rxjs-leak-detector && node node_modules/.bin/rxjs-leak-detector dashboard --no-open`. Confirm server starts, `.rld/` directory created, GET /sessions returns `[]`.

### Task 6.3: Commit

Single final commit for the whole package: `feat: add rxjs-leak-detector npm package (npm-only distribution path)`. Or multiple commits per phase if execution was phase-by-phase — either works. Sign-off: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`. Use `git -c commit.gpgsign=false commit`.

---

## Self-Review

**Spec coverage:**

| Spec section | Covered by |
|--------------|------------|
| 1 Goal | All phases together |
| 2.1 Install | Task 1.1 package.json |
| 2.2 Hook into app | Task 2.7 enable.ts |
| 2.3 Run dashboard | Task 3.2 cli/index.ts |
| 2.4 Record a session | Tasks 2.5 widget + 2.6 transport |
| 3.1 Package layout | Task 1.1 |
| 3.2 Reuse | Tasks 4.1, 5.1 |
| 4.1 patch.ts | Task 2.2 |
| 4.2 recorder.ts | Task 2.3 |
| 4.3 widget.ts | Task 2.5 |
| 4.4 transport.ts | Task 2.6 |
| 4.5 dashboard-server.ts | Task 3.1 |
| 4.6 cli | Task 3.2 |
| 4.7 dashboard/app.ts | Task 4.1 |
| 5 differences from extension | Spec only |
| 6 edge cases | Distributed across recorder, transport, server |
| 7 out of scope | Acknowledged |
| 8 testing | Tests embedded in each task |
| 9 migration | README |

**Type consistency:** `SubscriptionTag` (from analyzer-core), `LeakReport`, `LeakEntry` used consistently. `RecordingReport` is new — defined in `src/runtime/types.ts`.

**Placeholder scan:** none.

**Scope:** focused. Single package, three subdirs, end-to-end deliverable. ~6 phases, ~14 tasks.

---

## Plan complete

The plan covers the spec end-to-end. Each task has actual code, exact file paths, test snippets that prove behavior, and discrete verification steps.
