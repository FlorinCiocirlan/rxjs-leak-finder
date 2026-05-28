# How `rxjs-leak-finder` works

Plain words first. The technical bits are at the bottom.

---

## The problem

In an Angular app, you write code like this:

```ts
ngOnInit() {
  interval(1000).subscribe(n => this.tick = n);
}
```

When the user navigates away from this page, Angular destroys the component. But the `interval` doesn't know that. It keeps running. The callback keeps a reference to `this`. Garbage collection can't free the component. **That's a memory leak.**

These leaks are usually invisible. The app feels a little slower over time, then suddenly very slow, then crashes. By then you have no idea which page introduced it.

What we want: a list of subscriptions that *should* have been cleaned up but weren't, with enough information to fix them — the **component**, the **file:line** of the subscribe, and a hint about **why** it leaked.

---

## The trick: every Subscription gets a name tag

When you call `someObservable.subscribe(...)`, RxJS returns a `Subscription` object. Normally it's anonymous: you can't tell where it came from once it exists.

The detector replaces RxJS's `subscribe` method with a wrapper. Every time anyone subscribes:

1. Call the original `subscribe`. Get the Subscription back.
2. Capture a stack trace — `new Error().stack` is JavaScript's way of asking "who's calling me right now?".
3. Attach a hidden property `__sw_meta` to the Subscription, holding: id, timestamp, current route, the stack trace, what kind of Observable it was.
4. Also patch the Subscription's `unsubscribe` so we know when it was cleaned up.

Now every Subscription carries its own name tag. You can ask any one of them: "Where did you come from? Were you ever cleaned up?"

```
┌──────────────────────────────────────────────────┐
│ user code                                        │
│   interval(1000).subscribe(...)                  │
│                       │                          │
│                       ▼                          │
│   ╭─────────── patchedSubscribe ─────────────╮   │
│   │ 1. call real subscribe                   │   │
│   │ 2. snapshot the stack                    │   │
│   │ 3. attach __sw_meta to the Subscription  │   │
│   │ 4. ensure unsubscribe is patched too     │   │
│   ╰──────────────────────────────────────────╯   │
└──────────────────────────────────────────────────┘
```

The patch lives in `src/runtime/patch.ts`. About 50 lines.

---

## Recording a session

Patching every `subscribe()` is cheap, but storing every tag forever would be a lot. So the detector only *remembers* tags during a recording session. A session has three states:

| State | What happens |
|---|---|
| idle | Patch is installed. Tags are attached to Subscriptions. None are stored. |
| recording | Every new tag is added to the recorder's map. Route changes are recorded. |
| stopped | The session is sent to the dashboard (a JSON POST), then the map is cleared. |

You start a session by clicking **● Rec** in the floating widget. Stop with **■ Stop**. The widget is in `src/runtime/widget.ts` — three small DOM nodes pinned to `position: fixed; top-right`. Clicking through this calls into the controller (`src/runtime/enable.ts`).

The recorder lives in `src/runtime/recorder.ts`. It's a plain object with a few methods:

- `start()` — clear, mark recording.
- `onSubscribe(sub, obs, stack)` — store a tag.
- `onUnsubscribe(sub)` — mark the tag as closed.
- `stop()` — return the report and clear.

No RxJS, no Angular, no DOM. Just data.

---

## Tracking which route you're on

A subscribe on `/products` is a leak only if you've left `/products`. So we need to know what route was active when each tag was captured, and what route changes happened during the session.

The Router's events are framework-specific. To stay framework-agnostic, we patch the **History API** instead: `pushState`, `replaceState`, and the `popstate` event. Every Angular Router (and Vue, and SvelteKit, and plain `<a>` links) eventually goes through these. Whenever any of them fires, we record `{ from, to }`.

This lives in `src/runtime/route-tracker.ts`.

---

## Getting the report to the dashboard

When you click **■ Stop**:

1. The recorder returns a `RecordingReport`: meta + navigations + array of subscription tags.
2. `sendReport()` (`src/runtime/transport.ts`) tries `POST /report` to `http://localhost:7654`.
3. **If the dashboard is offline** the report is stashed in `localStorage`. Next time the app boots, `flushQueue()` retries.

This means you can record without the dashboard running, then start it later and not lose the session.

---

## The dashboard server

`npx rxjs-leak-finder dashboard` starts a tiny Node HTTP server (`src/cli/dashboard-server.ts`). It has five endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /report` | Save a recording report as `.rld/<timestamp>-<id>.json`. |
| `GET /sessions` | List all `.rld/*.json` files. |
| `GET /sessions/:id` | Read one report. |
| `GET /source-maps?url=…` | Server-side fetch of source-map files (CORS bypass for the SPA). |
| `POST /open` | Spawn the user's editor at `<file>:<line>:<col>`. |
| `GET /*` | Serve the built dashboard SPA (Lit + Vite). |

Reports are plain JSON files. You can commit them, share them, version them. The server doesn't run any analysis — that happens entirely in the dashboard SPA.

---

## Resolving stacks to file:line

The stack trace captured at subscribe time looks like:

```
at patchedSubscribe (http://localhost:4200/vite/deps/rxjs-leak-finder.js:120:23)
at SimpleLeakPage.ngOnInit (http://localhost:4200/src/app/pages/simple-leak.page.ts:24:8)
at callHookInternal (http://localhost:4200/vite/deps/@angular_core.js:4140:14)
…
```

To turn `http://localhost:4200/src/app/pages/simple-leak.page.ts:24:8` into the actual source file:line, the dashboard:

1. Fetches the JS file from the server.
2. Reads the `//# sourceMappingURL=…` comment at the bottom.
3. Fetches the source map.
4. Asks Mozilla's `source-map` library: "what original position maps to line 24, column 8?"

This work happens in the dashboard SPA (`src/dashboard/app.ts`) because source maps are big and we want the server stateless. The WASM file for `source-map` (~48 kB) is shipped with the dashboard build.

---

## Classifying leaks

A "leak" is a subscription that:

- Was created during the recording window.
- Was on a route the user has since *left* (per the navigation log).
- Has at least one non-framework frame in its stack.
- Was never unsubscribed.

That's the binary classification. Beyond that, the dashboard adds a **kind** so you know *why* it likely leaked. Heuristics from `packages/analyzer-core/src/leak-classifier.ts`:

| Kind | How we recognize it |
|---|---|
| `nested-subscribe` | Two or more `patchedSubscribe` frames in the same stack. |
| `async-init` | TS's `__async` / `ZoneAwarePromise` helper between the subscribe and a `ngOnInit` frame. |
| `ng-init` | The top non-framework frame is `*.ngOnInit`. |
| `global-event` | `fromEvent` / `addEventListener` in the stack. |
| `timer` | `interval` / `timer` in the stack, or the observable kind is plain `Observable`. |
| `subject` | The observable's `constructor.name` includes `Subject`. |

Heuristics are best-effort and conservative. When in doubt, kind = `unknown`.

The same module exposes `extractComponentName(frames)` (scans frames for a class name matching `*Component` / `*Directive` / `*Page` / `*Dialog`) and `stripDetectorFrames(frames)` (drops the detector's own `patchedSubscribe` from the displayed stack).

---

## Why no Chrome extension?

A Chrome extension would need DevTools access, content-script injection, message passing, a separate manifest, store reviews. For something this scoped — a dev-mode tool you run yourself — a floating widget + local HTTP server is dramatically simpler. No installs beyond `npm install`. Works in any browser, including headless Chrome.

The trade-off: no heap-snapshot integration. That's the one capability a DevTools extension would unlock (walking retainer chains to *prove* what's holding the subscription). The analyzer-core package has that code (`analyze.ts`, `heap-parser.ts`, `retainer-walker.ts`), but the dashboard doesn't currently invoke it — recording-only is good enough for ~95% of leaks. If you want retainer info, save a `.heapsnapshot` and feed it into `analyzer-core` programmatically.

---

## Package layout

```
rxjs-leak-finder (published)
├─ src/runtime/      ← code that ships into your Angular bundle
│  ├─ enable.ts        the public entry point
│  ├─ patch.ts         monkey-patches Observable.prototype.subscribe
│  ├─ recorder.ts      session state machine
│  ├─ route-tracker.ts patches History API
│  ├─ widget.ts        floating UI in your app
│  └─ transport.ts     fetch with offline localStorage queue
├─ src/cli/          ← node-only, runs the dashboard server
│  ├─ index.ts         arg parsing + lifecycle
│  └─ dashboard-server.ts
└─ src/dashboard/    ← the SPA (Lit + Vite, bundled at build)
   └─ app.ts

@rld/analyzer-core (workspace dep, bundled into the dashboard)
├─ types.ts             shared types
├─ leak-classifier.ts   leakKind + componentName heuristics
├─ source-map-resolver.ts
├─ classifier.ts        verdict (leak / long-lived / framework-noise)
├─ heap-parser.ts       (optional) V8 heap snapshot parser
└─ retainer-walker.ts   (optional) walks retainer chains from a heap snapshot

@rld/panel-ui (workspace dep, bundled into the dashboard)
└─ Lit components: leak-list, leak-row, leak-detail, leak-summary, stack-frame
```

`@rld/analyzer-core` and `@rld/panel-ui` are devDependencies — Vite inlines them at build time, so users only install `rxjs-leak-finder`.

---

## Things that surprised me

- **`new Error().stack` is the cheapest reliable stack trace.** No async stacks needed; the JS engine produces it eagerly.
- **History API patching is more universal than Router hooks.** Every framework eventually calls `pushState`. Routers are an abstraction over the same thing.
- **Vite renames RxJS internals at dev time.** `BehaviorSubject` becomes `BehaviorSubject2`, so we can't use `instanceof Subject` reliably. We use `constructor.name` instead.
- **The first frame of every captured stack is always `patchedSubscribe`.** We strip it before display.
- **`takeUntilDestroyed()` after an `await` silently no-ops.** This is the bug that makes `async ngOnInit` so dangerous; the `async-init` kind catches it.
