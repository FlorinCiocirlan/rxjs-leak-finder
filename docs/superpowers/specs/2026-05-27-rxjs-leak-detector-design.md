# RxJS Subscription Leak Detector — Design

**Date:** 2026-05-27
**Status:** Approved
**Scope:** A Chrome DevTools extension that detects leftover RxJS subscriptions in Angular v19+ dev-mode apps by tagging subscriptions at creation, capturing a heap snapshot on demand, and reporting which tagged subscriptions are still retained after navigation.

---

## 1. Goal

When a user clicks **Record** in the extension's DevTools panel, navigates within an Angular app, then clicks **Stop**, the extension reports every RxJS subscription that:

1. Was created during the *initial* page/route (the route active when Record was clicked).
2. Was never unsubscribed.
3. Is still retained in memory after a forced garbage collection.
4. Originates from the user's own source code (not Angular or RxJS internals).

For each leak, the report shows the source location (file:line), full stack trace, originating Angular component or service, retainer chain (what's keeping it alive), and the kind of Observable that was subscribed to.

This is a **development-mode tool only**. We assume source maps are available and the app is unminified.

## 2. Approach

### 2.1 Detection strategy: tagging-only

The extension injects a script into the page's main JavaScript world at `document_start` (before any app code executes). The script monkey-patches `Observable.prototype.subscribe` and `Subscription.prototype.unsubscribe`. Every Subscription instance receives a non-enumerable `__sw_meta` property:

```ts
{
  id: string
  createdAtMs: number
  route: string
  stackRaw: string         // raw stack from new Error().stack
  observableKind: string   // 'interval' | 'fromEvent' | 'HttpRequest' | ...
  recordingId: string
  closed: boolean          // flipped by patched unsubscribe()
}
```

Prototype patching survives minification (prototype identity is preserved by the runtime) and works regardless of how RxJS is bundled, because every subscribe call ultimately dispatches through `Observable.prototype.subscribe`.

**Runtime hook required:** Because modern Angular dev builds load RxJS as an ES module (not on `window`), the extension cannot find the page's `Observable` class without help. The user installs `@rld/runtime` (a tiny package) and adds one line to `main.ts`:
```ts
import { Observable } from 'rxjs';
import { enableRxjsLeakDetector } from '@rld/runtime';
enableRxjsLeakDetector(Observable);
bootstrapApplication(AppComponent, appConfig);
```
`enableRxjsLeakDetector` exposes `Observable` on `window.__rldObservable` and dispatches a `rld:observable-ready` event. The tagger reads from there and proceeds. This is a no-op when the extension isn't installed.

### 2.2 Page boundaries: auto-detect Angular Router, fall back to URL

The tagger probes for Angular Router via `window.ng.applicationRef.injector.get(Router)`. When found, it subscribes to `Router.events` filtered to `NavigationEnd` to track route transitions. When not found (non-Angular SPA, or Router not yet bootstrapped), it falls back to `popstate` + `hashchange` listeners and a `MutationObserver` on `history.pushState`/`replaceState`. A manual "Mark navigation" button in the panel is available as an override.

### 2.3 Noise filtering: stack-trace-based

Every captured stack is resolved through source maps to original frames. A frame is a **framework frame** if its resolved path matches any of: `node_modules/@angular/*`, `node_modules/rxjs/*`, `node_modules/zone.js/*`, or a webpack/Angular runtime path. Any frame that is *not* a framework frame is a **user frame** — there is no separate user configuration; user source is defined by exclusion.

A subscription whose top user frame (first non-framework frame) exists at all is a candidate leak. Subscriptions whose entire stack is framework frames are ignored noise (counted in `ignoredFrameworkSubscriptions` for transparency).

### 2.4 Heap snapshot via `chrome.debugger`

On **Stop**, the background service worker calls `chrome.debugger.attach({tabId}, "1.3")` and issues `HeapProfiler.takeHeapSnapshot`. V8 forces a full GC before capture, so any tagged subscription present in the snapshot is genuinely retained. The standard "Extension is debugging this tab" banner appears during capture — acceptable for a dev tool. Snapshot chunks are streamed via `HeapProfiler.addHeapSnapshotChunk` and concatenated.

### 2.5 Report detail

Each detected leak shows:

- **Source location** (file:line) — resolved through source maps, clickable to open in DevTools Sources panel.
- **Full stack trace** at subscribe time — every frame resolved to original source.
- **Originating Angular component or service** — the nearest Angular class found by walking the retainer chain.
- **Retainer chain** — BFS from the Subscription through retainer edges to the first interesting holder (component, service, Window), truncated at depth 8.
- **Observable kind** — `interval`, `fromEvent`, `HttpRequest`, `Subject`, etc., from walking `.source` operator chains.

The list view shows file:line + component + Observable kind. The expanded detail view shows everything.

## 3. Architecture

pnpm workspace with five packages:

```
rxjs-subsriptions/
├── package.json              # pnpm workspace root
├── pnpm-workspace.yaml
├── packages/
│   ├── analyzer-core/        # pure TS, Node-runnable
│   ├── tagger/               # IIFE bundle injected into page MAIN world
│   ├── runtime/              # tiny user-installed npm package that exposes Observable on window for the tagger to find
│   ├── extension/            # Manifest V3 shell (background, devtools, content-bridge)
│   └── panel-ui/             # Lit web components for DevTools panel
└── docs/superpowers/specs/
```

**Dependency rules:**

- `analyzer-core` depends on nothing browser-specific. It is the testable core.
- `tagger` is self-contained, bundled as a string into `extension`.
- `extension` consumes `tagger` and `analyzer-core`.
- `panel-ui` depends only on `analyzer-core` types (`LeakReport` shape). Data arrives via Chrome messaging.

### 3.1 `analyzer-core`

```
src/
├── heap-parser.ts            # parses V8 .heapsnapshot JSON, builds indexed graph
├── subscription-finder.ts    # locates Subscription nodes
├── tag-decoder.ts            # reads __sw_meta object via edges
├── retainer-walker.ts        # BFS through retainer edges
├── classifier.ts             # leak vs not-a-leak rules
├── source-map-resolver.ts    # stack frame → original file:line:column
└── index.ts                  # exports analyze(input): LeakReport
```

**Public API:**

```ts
analyze(input: {
  snapshot: HeapSnapshotJson,
  recording: RecordingMeta,
  sourceMaps: Map<string, RawSourceMap>,
}): LeakReport

type LeakReport = {
  leaks: LeakEntry[]
  ignoredFrameworkSubscriptions: number
  longLivedServiceSubscriptions: LongLivedEntry[]
  totalSubscriptionsScanned: number
}

type LeakEntry = {
  id: string
  route: string
  observableKind: string
  sourceLocation: { file: string, line: number, column: number }
  componentName: string | null
  stack: ResolvedStackFrame[]
  retainerChain: RetainerNode[]
}
```

### 3.2 `tagger`

```
src/
├── patch-rxjs.ts        # monkey-patches Observable.prototype.subscribe / Subscription.prototype.unsubscribe
├── route-tracker.ts     # Angular Router with URL fallback
├── recording-state.ts   # Record on/off, page boundary
└── index.ts             # entry point — installs window.__rxjsLeakDetector
```

**Page globals exposed:**

```ts
window.__rxjsLeakDetector = {
  start(): void          // begins recording, snapshots initial route
  markNavigation(): void
  stop(): RecordingMeta
  isRecording: boolean
}
```

The wrapper assigns shadow tags (`id`, `createdAtMs`, `stackRaw`) to every subscription unconditionally. Full tags including `recordingId` and `route` are assigned only while `isRecording === true`. Stack collection is the expensive bit and is gated on the recording flag.

### 3.3 `extension`

Manifest V3 shell:

```json
{
  "manifest_version": 3,
  "devtools_page": "devtools.html",
  "background": { "service_worker": "background.js" },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content-bridge.js"],
      "run_at": "document_start",
      "world": "ISOLATED"
    },
    {
      "matches": ["<all_urls>"],
      "js": ["tagger.js"],
      "run_at": "document_start",
      "world": "MAIN"
    }
  ],
  "permissions": ["debugger", "scripting", "storage"]
}
```

`background.ts` holds per-tab session state, drives `chrome.debugger.attach` for snapshot capture, fetches source maps via `chrome.devtools.inspectedWindow.eval`, runs `analyzer-core.analyze()` inside a `Worker`, and posts the resulting report to the panel.

`content-bridge.ts` (ISOLATED world) is the relay between the MAIN-world tagger and the background worker. Tagger uses `window.postMessage`; bridge uses `chrome.runtime.sendMessage`.

### 3.4 `panel-ui` (Lit)

Component tree:

```
<leak-detector-root>
  <record-controls>            ← Record/Stop, recording timer, Mark Navigation
  <leak-summary>               ← "3 leaks · 47 framework subs ignored · 2 long-lived"
  <leak-list>
    <leak-row>                 ← file:line · component · Observable kind
      <leak-detail>            ← stack, retainer chain, suggestion
  <long-lived-section>         ← collapsible, not-a-leak entries for transparency
  <empty-state>                ← initial state before any recording
```

Clicking a stack frame calls `chrome.devtools.panels.openResource(url, line, col)` to jump to the Sources panel.

## 4. Data Flow

### 4.1 Page load (before user input)

`tagger.js` runs in MAIN world at `document_start`, before any app bundle. It patches `Observable.prototype.subscribe` and `Subscription.prototype.unsubscribe`, installs `window.__rxjsLeakDetector` with `isRecording = false`, and sets up route detection on next idle.

### 4.2 Record clicked

```
panel-ui → chrome.runtime.sendMessage('START_RECORDING')
        → background → chrome.tabs.sendMessage → content-bridge
        → window.postMessage → tagger
        → tagger generates recordingId, captures initialRoute, sets isRecording = true
```

### 4.3 User navigates

Tagger's route-tracker callback pushes `{ fromRoute, toRoute, atMs }` onto the session. Future subscriptions are tagged with the new current route.

### 4.4 Stop clicked

```
panel-ui → background → tagger.stop()
                     → chrome.debugger.attach({tabId}, "1.3")
                     → HeapProfiler.takeHeapSnapshot (chunks streamed in)
                     → chrome.debugger.detach
                     → fetch source maps (one per unique referenced file, parallelized, deduped)
                     → analyzerCore.analyze({ snapshot, recording, sourceMaps })  (runs in Worker)
                     → chrome.runtime.sendMessage(panel, REPORT_READY)
                     → panel renders <leak-list>
```

### 4.5 `analyzer-core.analyze()` internals

1. `parseSnapshot` — JSON.parse, build indexed graph (nodes, edges, strings).
2. `findSubscriptions` — iterate nodes by constructor name (Subscriber / SafeSubscriber / Subscription), find `__sw_meta` edge.
3. `tag-decoder` — decode tag. Drop subscriptions with `closed === true` or wrong `recordingId`.
4. `resolveStacks` — map every frame through source maps. Identify each frame as framework or user (Section 2.3).
5. `classifier` — for each tagged surviving subscription:
   - If `tag.route !== recording.initialRoute` → skip (not an initial-page subscription).
   - If no user frame in stack → bump `ignoredFrameworkSubscriptions`, skip.
   - Else, run a **classification walk** through retainer edges (separate from the report walk in step 6), walking all the way to GC roots up to depth 16. If the walk reaches `ApplicationRef` *without passing through a route Component instance* → classify as `longLivedServiceSubscriptions` entry, not a leak.
   - Otherwise → leak candidate.
6. `walkRetainers` — for each leak candidate, BFS retainer edges and stop at first Component/Directive/Service/Window for the **display** retainer chain, max depth 8.
7. `resolveComponentName` — first Angular class in the display retainer chain (may be `null`).
8. Return `LeakReport`.

## 5. Error Handling & Edge Cases

### 5.1 Tagger injection

| Scenario | Behavior |
|----------|----------|
| Patch applied late (after app already cached subscribe references) | Detected via missing `__sw_patched === true` marker; panel shows *"Tagger missed early subscriptions — reload page after enabling extension."* |
| CSP blocks MAIN-world injection | Show error: *"Cannot inject tagger — check page CSP."* |
| Multiple RxJS copies (microfrontend) | Patch first `Observable.prototype`; rescan `window` periodically; report untagged subscriptions in summary as *"X untagged subscriptions found (possible multi-bundle)"*. |
| Custom Subscription subclass overrides `unsubscribe` without super | Fall back to reading the node's own `closed` boolean property (RxJS sets this directly), not just our tag. |

### 5.2 Route detection

| Scenario | Behavior |
|----------|----------|
| Not an Angular app | Probe times out at 2s, fall back to URL mode, panel banner: *"Angular Router not detected."* |
| Router not yet bootstrapped | Retry every 250ms for up to 5s. |
| Hash routing | URL fallback subscribes to `hashchange`. |
| Same-route programmatic navigation | Angular Router events catch it; URL fallback misses it. Documented limitation. |

### 5.3 Heap snapshot capture

| Scenario | Behavior |
|----------|----------|
| `chrome.debugger.attach` rejected (another extension attached) | *"Another extension is debugging this tab — close it and retry."* |
| User dismisses debugger banner mid-capture | Pending `sendCommand` rejects; panel shows *"Snapshot cancelled."* |
| Snapshot exceeds memory | Stream chunks to `IndexedDB`; if still OOM, *"Snapshot exceeds memory limits — record a shorter session."* |
| Page navigates / reloads mid-capture | Rollback session, *"Page changed during capture — restart recording."* |
| Tab closed mid-recording | Listen for `chrome.tabs.onRemoved`, clean up session state. |

### 5.4 Source map resolution

| Scenario | Behavior |
|----------|----------|
| `.map` URL returns 404 | Cache 404, show frame with raw bundle location, panel hint: *"Source maps not available — ensure `ng serve` is running."* |
| Inline data URI map | `source-map-resolver` handles `data:` URIs natively. |
| Map points outside user source root | Mark as framework frame, used by classifier filtering. |
| Map missing `sourcesContent` | Acceptable — we only need `file:line:column`. |

### 5.5 Classification false-positive minefield

| Pattern | Action |
|---------|--------|
| `providedIn: 'root'` service subscribes in constructor | Retainer chain terminates at `ApplicationRef`. Classified as long-lived service, not a leak. Shown in collapsible section for transparency. |
| `BehaviorSubject` exposed by service, subscribed by component | Subscription is tagged from component's stack. Reported correctly with Component → Subscription retainer chain. |
| `takeUntil(destroy$)` pattern | RxJS internally sets `closed = true` on completion. Filtered out. |
| `async` pipe subscriptions | `AsyncPipe` cleans up in `ngOnDestroy`. Tag's `closed` flips. No false positive. |
| `fromEvent(window, 'resize')` in singleton service | Retainer chain ends at Window via event listener. Classified as long-lived service. |
| Subscription deliberately leaked by user as a debug fixture | Reported as leak. Unavoidable; user reads and ignores. |

### 5.6 Recording lifecycle

| Scenario | Behavior |
|----------|----------|
| Stop without navigating | `navigations[]` empty → no boundary to test. Panel: *"No navigation detected — leak detection needs at least one route change."* No analysis runs. |
| Record clicked twice without Stop | Treated as Stop + Record. |
| DevTools closed mid-recording | Tagger keeps running in page context. Reopening DevTools restores panel state from background worker session store. |
| Browser crash / extension reload | All state lost. Acceptable. |

### 5.7 Performance guardrails

| Concern | Mitigation |
|---------|------------|
| Stack capture overhead | Only when `isRecording === true`. Pre-recording wrapper assigns only `id` + `createdAtMs`. |
| Tag memory under 10k+ subscriptions | Non-enumerable, ~200 bytes each → 2MB cap. Stack strings deduped via `Map<stackHash, stackString>`. |
| Snapshot parsing blocks service worker | `analyzer-core` runs in a `Worker` spawned from background. |
| Source map fetch storm | Dedupe by URL, parallelize to 6, cache for session lifetime. |

## 6. Testing Strategy

### 6.1 `analyzer-core` — unit + fixture tests (Vitest in Node)

Fixture-driven. Capture real `.heapsnapshot` files once with a Puppeteer helper script, commit them, assert classifier output.

```
test/
├── fixtures/
│   ├── clean-app.heapsnapshot
│   ├── obvious-leak.heapsnapshot
│   ├── service-singleton.heapsnapshot
│   ├── multi-leak.heapsnapshot
│   ├── takeuntil-pattern.heapsnapshot
│   └── recordings/*.json
└── *.test.ts
```

Test cases: parser correctness, subscription finder, tag decoder, classifier on each fixture (expected leak counts), retainer walker chain shape, source map resolver.

### 6.2 `tagger` — unit tests (Vitest with `happy-dom`)

- Patch is idempotent.
- `__sw_meta` shape on new subscriptions.
- Original subscribe behavior preserved.
- `start` / `stop` lifecycle.
- Route-tracker URL fallback against simulated `history.pushState`.

### 6.3 `extension` — e2e with Puppeteer

Minimal Angular 19 test app under `test/e2e/fixtures/test-app/` with known leaks.

- Extension loads, panel appears.
- Record → navigate → Stop produces report within 10s.
- Leak count matches expected.
- Stack frame click navigates DevTools Sources panel.
- `chrome.debugger` banner appears and disappears.

### 6.4 `panel-ui` — Lit component tests

Each component tested in isolation:

- `<record-controls>` start/stop event emission and state toggling.
- `<leak-list>` row rendering, expand event.
- `<leak-detail>` stack and retainer rendering, `open-source` event.
- `<empty-state>` visible when report null.

Snapshot tests on rendered HTML for known `LeakReport` fixtures.

### 6.5 Manual smoke checklist (per release)

- Unpacked install in Chrome.
- Run against leaky Angular test app — leak count, banner behavior, stack link navigation, retainer chain readability.
- Run against non-Angular SPA — graceful fallback messaging.

### 6.6 Explicit non-goals for testing

- Heap snapshot format compatibility across Chrome versions (pin to current stable).
- Pathological loads (100k subscriptions) — document cap, don't test.
- Multiple RxJS copies — manual smoke only.

### 6.7 CI

- Push: unit + component tests in parallel (Vitest workspace mode).
- PR: also run Puppeteer e2e.
- No coverage gate.

## 7. Out of Scope

- Production builds (no source maps, minified, framework objects renamed).
- Non-RxJS subscriptions (`addEventListener`, `setInterval`, native Promises).
- Memory leaks unrelated to RxJS (detached DOM, closures, caches).
- Auto-fixing or generating `takeUntil` boilerplate.
- Recording session history / export to JSON.
- Cross-tab analysis.

These could be future enhancements but are not part of the initial scope.
