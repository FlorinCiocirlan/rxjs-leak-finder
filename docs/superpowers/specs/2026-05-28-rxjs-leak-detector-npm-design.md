# `rxjs-leak-detector` NPM Package — Design

**Date:** 2026-05-28
**Status:** Approved
**Supersedes (partial):** The extension-only path in `2026-05-27-rxjs-leak-detector-design.md` for the primary user-facing distribution. The Chrome extension path remains for experimental heap-snapshot mode.

---

## 1. Goal

Distribute the RxJS subscription leak detector as a single npm dev dependency that requires no Chrome extension. The user installs `rxjs-leak-detector`, adds one line to `main.ts` (gated on `!isProd`), runs `npx rxjs-leak-detector dashboard` to open a local dashboard, and detects leftover subscriptions by clicking Record → navigate → Stop.

This pivots the primary distribution away from the Chrome extension because:

- Installing an unpacked Chrome extension is too much friction for most developers.
- Source map fetching and heap-snapshot capture were both difficult to wire reliably from a content script.
- The actual common case for "RxJS leak" is "the developer forgot to call `unsubscribe()`," which is detectable from the runtime tag map alone — heap snapshots add forensic rigor that isn't needed in day-to-day development.

## 2. User Experience

### 2.1 Install

```bash
pnpm add -D rxjs-leak-detector
```

### 2.2 Hook into the app

```ts
// main.ts
import { Observable } from 'rxjs';
import { enableRxjsLeakDetector } from 'rxjs-leak-detector';
import { environment } from './environments/environment';

if (!environment.production) {
  enableRxjsLeakDetector(Observable);
}

bootstrapApplication(AppComponent, appConfig);
```

The function accepts an optional config object:

```ts
enableRxjsLeakDetector(Observable, {
  disableWidget: false,   // default false — floating ● Rec / ■ Stop widget shown
  dashboardUrl: 'http://localhost:7654',  // where to POST reports
});
```

### 2.3 Run the dashboard

```bash
npx rxjs-leak-detector dashboard
```

This starts a Node http server on port 7654, prints the URL, and opens it in the user's default browser. The dashboard tab lists recording sessions and shows leak details.

### 2.4 Record a session

Two paths, kept in sync via the dev server:

- **Widget**: floating bottom-right widget injected into the app shows `● Rec` / `■ Stop`. Default unless `disableWidget: true`.
- **Dashboard**: the dashboard tab has the same buttons.

Flow: click Record → app navigates to a different route → click Stop. The library serializes the report and POSTs it to the dashboard. The dashboard writes the report to `.rld/<timestamp>-<sessionId>.json` in the repo's cwd and renders it.

If the dashboard server isn't running when Stop is clicked, the report queues in `localStorage` and retries on the next page load.

## 3. Architecture

### 3.1 One package, three concerns

```
rxjs-leak-detector/
├── package.json                    # entry points: main (runtime), bin (cli)
├── src/
│   ├── runtime/                    # ← user's bundle imports from here
│   │   ├── index.ts                # exports enableRxjsLeakDetector
│   │   ├── patch.ts                # Observable.prototype.subscribe / unsubscribe patching
│   │   ├── recorder.ts             # Map<id, SubRef>, route tracker, report builder
│   │   ├── widget.ts               # floating widget UI (vanilla DOM, no Lit dep in runtime)
│   │   ├── transport.ts            # POST to dashboard, localStorage queue
│   │   └── types.ts                # shared types
│   ├── cli/                        # ← node entry, exposed as `bin`
│   │   ├── index.ts                # commander/yargs entry, command dispatch
│   │   ├── dashboard-server.ts     # http.createServer, /report POST, /sessions GET
│   │   └── open-browser.ts         # cross-platform `open` shim
│   └── dashboard/                  # ← served as static HTML by the cli server
│       ├── index.html
│       └── app.ts                  # uses @rld/panel-ui Lit components
└── README.md
```

The runtime imports zero Node modules. The CLI imports zero browser-only modules. They share only the types in `src/runtime/types.ts` (which the dashboard also imports).

### 3.2 Reuse from the existing monorepo

- **`@rld/analyzer-core`**: keep `classifier.ts`, `source-map-resolver.ts`, and `types.ts`. These remain the leak-rule and source-mapping logic, used by the dashboard at render time. Heap-related code (`heap-parser`, `subscription-finder`, `tag-decoder`, `retainer-walker`, `analyze.ts`) stays for the extension path but isn't imported by the npm package.
- **`@rld/panel-ui`**: reuse all Lit components (`<record-controls>`, `<leak-list>`, `<leak-row>`, `<leak-detail>`, `<stack-frame>`, `<leak-summary>`, `<long-lived-section>`, `<empty-state>`, `<leak-detector-root>`). Drop the `retainerChain` block in `<leak-detail>` (or show "Retainer chain: n/a — install the Chrome extension for heap-walked retainers").
- **`@rld/extension`**: untouched. It remains a separate, experimental "heap-snapshot mode" alternative for users who want retainer chains.

### 3.3 What's removed from primary distribution

- **`@rld/tagger`** IIFE — no longer needed; the tagging is plain importable code in `rxjs-leak-detector/runtime/patch.ts`.
- **`@rld/runtime`** — folded into `rxjs-leak-detector/runtime/enable.ts`. The old `enableRxjsLeakDetector(Observable)` signature is preserved; the implementation now does the full patching + recorder setup, not just exposing `window.__rldObservable`.

These packages remain in the monorepo (the extension still uses them); they're just not the user-facing distribution anymore.

## 4. Detailed Components

### 4.1 `runtime/patch.ts`

Same logic as the existing `@rld/tagger/src/patch-rxjs.ts`:

- `Observable.prototype.subscribe` wrapper that attaches `__sw_meta` to each returned `Subscription`.
- `Subscription.prototype.unsubscribe` wrapper that flips `meta.closed = true`.
- Idempotent via `Symbol.for('__rld_patched')` markers on the prototypes.

Differences from the IIFE version:

- Takes `Observable` as an argument (passed from `enableRxjsLeakDetector`) rather than walking `globalThis` to find it. The user gives us the right prototype identity.
- No dynamic import or polling — the page has already imported rxjs and given us the reference.
- Result: smaller, more reliable, no bundle bloat.

### 4.2 `runtime/recorder.ts`

Maintains:

```ts
type RecorderState = {
  recordingId: string | null;
  isRecording: boolean;
  initialRoute: string;
  startedAtMs: number;
  currentRoute: string;
  navigations: NavigationEvent[];
  subscriptions: Map<string, SubRef>;
};

type SubRef = {
  tag: SubscriptionTag;       // same shape as analyzer-core's SubscriptionTag
  subscription: WeakRef<object>;  // optional, for "definitely-still-alive" hint
};
```

API:

```ts
recorder.start(): void
recorder.stop(): RecordingReport
recorder.markNavigation(): void
recorder.recordNavigation(change: { from, to }): void
recorder.onSubscribe(sub: object, observable: object, stack: string): void  // called by patch
recorder.onUnsubscribe(sub: object): void                                    // called by patch
```

On `stop()`, the recorder filters the map to "potential leaks": `tag.recordingId === current` AND `tag.route === initialRoute` AND `tag.closed === false` AND `tag.stackRaw` contains at least one non-framework frame. It then resolves stacks via source maps fetched from `dashboardUrl/source-maps?url=...` (a proxy endpoint on the dev server that fetches the source map from the user's dev server and returns it). Finally, it runs the classifier and builds a `LeakReport`.

Compared to the heap-snapshot path:

- No retainer chains. `LeakEntry.retainerChain` is `[]`.
- No `walkClassification`. The "long-lived service" verdict is replaced by a simpler heuristic: if the top user frame's file path matches `*.service.ts` AND `componentName === null`, classify as long-lived. Otherwise leak.

### 4.3 `runtime/widget.ts`

Plain vanilla DOM, no Lit dependency in the runtime (we don't want to ship Lit to every user's prod bundle, even tree-shaken). Renders:

```html
<div id="__rld_widget" style="position:fixed; bottom:12px; right:12px; ...">
  <button>● Rec</button>
</div>
```

Toggles to `■ Stop` while recording. Has a tiny dropdown for "Mark navigation" and a close X (sets a `localStorage` flag to suppress for the session).

Skipped entirely when `config.disableWidget === true`.

### 4.4 `runtime/transport.ts`

```ts
async function sendReport(report: RecordingReport, dashboardUrl: string): Promise<void> {
  try {
    const res = await fetch(`${dashboardUrl}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    enqueue(report);
  }
}

function enqueue(report: RecordingReport): void {
  const q = JSON.parse(localStorage.getItem('__rld_queue') ?? '[]');
  q.push(report);
  localStorage.setItem('__rld_queue', JSON.stringify(q));
}

async function flushQueue(dashboardUrl: string): Promise<void> { /* retry each, drop on success */ }
```

`flushQueue` runs on `enableRxjsLeakDetector` startup (best-effort), so reports captured offline get replayed when the user starts the dashboard.

### 4.5 `cli/dashboard-server.ts`

`http.createServer` with these routes:

| Method | Path | Behavior |
|--------|------|----------|
| `GET /` | serve `dashboard/index.html` |
| `GET /app.js`, `/app.css` | serve dashboard bundle |
| `POST /report` | parse body JSON, write `.rld/<timestamp>-<sessionId>.json`, return `{ ok: true }` |
| `GET /sessions` | return `[{ id, fileName, createdAt, leakCount }]` from `.rld/` |
| `GET /sessions/:id` | return the full report JSON |
| `GET /source-maps?url=...` | fetch the URL+'.map' (proxying for CORS), return body. Server-side fetch so we work around CORS. |
| `OPTIONS *` | CORS preflight; allow origin `*` since this is dev-only |

CORS headers on all routes: `Access-Control-Allow-Origin: *` (dev-only server, no security risk).

### 4.6 `cli/index.ts`

```bash
$ npx rxjs-leak-detector dashboard
RxJS Leak Detector dashboard listening at http://localhost:7654
Opening browser…
```

Flags:
- `--port <n>` (default 7654)
- `--no-open` (don't auto-open browser)
- `--cwd <path>` (where to write `.rld/`; default `process.cwd()`)

### 4.7 `dashboard/app.ts`

Imports panel-ui Lit components. Hits `/sessions` on load to populate a session list (left rail). On selecting a session, fetches `/sessions/:id` and binds the `LeakReport` to `<leak-detector-root>`.

Session list updates via Server-Sent Events on `/events` (lightweight push so new sessions appear without reload). Stretch; can be polling on a 2s timer for v1.

## 5. Differences from Extension Path

| Aspect | Extension | NPM library |
|--------|-----------|-------------|
| Install | Load unpacked Chrome ext | `pnpm add -D` |
| User code change | 1 line (just exposes Observable) | 1 line (same function, more powerful) |
| Recording UI | DevTools panel | Floating widget + dashboard tab |
| Heap snapshot | Yes (chrome.debugger) | No (not available outside extensions) |
| Retainer chains | Yes (BFS through heap) | No (n/a in UI) |
| Forced GC | Yes (snapshot triggers GC) | No (rely on `closed` tag) |
| "Long-lived service" detection | Via retainer walk to ApplicationRef | Via filename heuristic (`*.service.ts`) |
| Source maps | Fetched via chrome.devtools.inspectedWindow | Fetched via dashboard server proxy |
| Browser support | Chrome only | Any modern browser |
| False-positive rate | Lower (real retainer info) | Slightly higher (heuristic-only) |

## 6. Error Handling & Edge Cases

| Scenario | Behavior |
|----------|----------|
| Dashboard not running when Stop clicked | Report enqueued to `localStorage`. Toast: "Saved locally. Run `npx rxjs-leak-detector dashboard` to view." |
| `enableRxjsLeakDetector` called twice | Second call is a no-op (idempotent via patched-prototype marker). |
| `enableRxjsLeakDetector` called in production by mistake | Function checks `process.env.NODE_ENV === 'production'` and bails. Also accepts explicit `{ enabled: false }`. |
| Map grows unbounded across recordings | On each `start()`, the map is cleared. |
| `Observable` argument is the wrong identity | Patching marker on `Observable.prototype` means we'd skip. Stale subscriptions never get tagged. Documented as user error. |
| User's app uses multiple RxJS copies | User passes the relevant Observable. We patch one prototype. Subscriptions from the other copy aren't tagged. Show "X untagged subscriptions detected" in dashboard footer. |
| Source map fetch fails | Show frame with raw bundle location. Dashboard hint: "Source maps not available." |
| User's app served on a non-localhost origin | Default `dashboardUrl: 'http://localhost:7654'` still works (CORS allows). Custom dashboards configurable. |
| Recording stopped without navigation | Same guard as extension path — show "No navigation detected." |
| User refreshes app mid-recording | Recorder state is in-memory. Lost. Acceptable for v1; document as limitation. |

## 7. Out of Scope (v1)

- Persisting recording state across page reloads.
- Authentication on the dashboard server (it's localhost dev-only).
- Multi-app/multi-user dashboards.
- Cross-tab session merging.
- Real-time live view (currently snapshot-on-Stop only).
- Auto-fix suggestions.

## 8. Testing Strategy

- `runtime/patch.ts`, `runtime/recorder.ts`, `runtime/transport.ts`: Vitest + happy-dom. Reuse patterns from existing `@rld/tagger` tests.
- `runtime/widget.ts`: minimal DOM test — verify it injects, button click fires the right callbacks.
- `cli/dashboard-server.ts`: Vitest + node http. Hit each endpoint, assert behavior.
- `cli/index.ts`: smoke test — invoke `dashboard --port=N --no-open`, assert the server responds.
- `dashboard/app.ts`: light component-test coverage (most logic is in panel-ui, already tested).
- End-to-end manual smoke: install the package in a real Angular app, follow the README, confirm leaks appear.

## 9. Migration Notes

For anyone who used the existing `@rld/runtime` + extension flow: `enableRxjsLeakDetector(Observable)` keeps the same signature. The function body changes from "expose on window" to "patch + record". The extension still works against `window.__rldObservable`, so users who want both paths can call:

```ts
import { enableRxjsLeakDetector } from 'rxjs-leak-detector';
import { Observable } from 'rxjs';
enableRxjsLeakDetector(Observable);
// also expose for the optional Chrome extension path:
(window as any).__rldObservable = Observable;
```

In a future release, `enableRxjsLeakDetector` can set `window.__rldObservable` itself, so a single call works for both modes.
