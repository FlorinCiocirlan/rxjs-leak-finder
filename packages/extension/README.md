# @rld/extension — RxJS Leak Detector DevTools Extension

A Chrome DevTools extension that detects unsubscribed RxJS subscriptions in Angular
applications running in development mode.

It works by recording subscription creation sites during a navigation, capturing a
heap snapshot when recording stops, and cross-referencing the two to surface
subscriptions that are still alive after their owner component should have been
destroyed.

---

## Prerequisites

- Chrome 114 or later (Manifest V3, `chrome.scripting` API required)
- Your Angular app must run in **dev mode** (source maps enabled, i.e. `ng serve`
  or `ng build` without `--configuration production`)
- The `@rld/runtime` hook must be installed in your app (see below)

---

## Setting up your Angular app

Add two lines near the top of `src/main.ts`, **before** `bootstrapApplication`:

```ts
import { Observable } from 'rxjs';
import { enableRxjsLeakDetector } from '@rld/runtime';

enableRxjsLeakDetector(Observable);   // exposes window.__rldObservable
bootstrapApplication(AppComponent, appConfig);
```

`enableRxjsLeakDetector` patches `Observable.prototype` so the tagger script
injected by the extension can intercept subscription calls.

> **Note — until `@rld/runtime` is published to npm** you have two options:
>
> 1. **Symlink** the local package:
>    ```sh
>    cd your-app
>    npm link /path/to/rxjs-subscriptions/packages/runtime
>    ```
> 2. **Inline the function** — copy the four-line body of
>    `packages/runtime/src/index.ts` directly into your `main.ts`. It only
>    sets `window.__rldObservable = Observable`.

---

## Building the extension

From the repository root:

```sh
pnpm install
pnpm -r build
```

The loadable extension lands in `packages/extension/dist/`.

---

## Installing the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `packages/extension/dist/` folder

The extension icon appears in the Chrome toolbar and a new **"RxJS Leaks"** panel
is added to DevTools.

---

## Using the extension

1. Open your Angular app in a Chrome tab (must be served in dev mode)
2. Open DevTools (`F12` / `Cmd+Option+I`) and switch to the **RxJS Leaks** panel
3. Click **Record** — the extension starts watching subscriptions
4. **Navigate** to another route in your app (the router navigation is the
   checkpoint; subscriptions created before it should be cleaned up by Angular's
   change detection cycle)
5. Click **Stop** — the extension:
   - sends a stop signal to the content bridge
   - captures a heap snapshot of the inspected tab
   - fetches source maps for all JS bundles found in the snapshot
   - runs the analyzer to correlate live heap nodes with recorded subscription sites
6. Leak results appear in the panel, grouped by component and showing the call
   site (file + line) where the subscription was created

### Manual navigation checkpoints

If you are not using Angular Router (or want finer-grained checkpoints), click
**Mark navigation** in the panel at any point during recording. Each click
inserts a navigation timestamp that the analyzer uses as a destruction boundary.

---

## Limitations

| Limitation | Detail |
|---|---|
| Dev mode only | Source maps must be present; production bundles produce no useful call sites |
| Page must be loaded *after* the extension is enabled | The tagger is injected as a content script on page load; subscriptions created before injection are not tracked. The panel shows a warning and prompts you to reload if it detects the tagger was not present |
| Angular Router auto-detection | The extension listens for `NavigationEnd` events. For other SPA frameworks use the **Mark navigation** button manually |
| `chrome.devtools.inspectedWindow` scope | Source map fetching requires the background service worker to proxy requests because `devtools.inspectedWindow` is only accessible from panel context. This is a known limitation that will be lifted in a follow-up |
| One tab at a time | Each DevTools panel tracks a single inspected tab; opening multiple panels simultaneously is not prevented but may produce interleaved results |

---

## Architecture overview

```
Angular app (page)
  └─ @rld/runtime          patches Observable.prototype → window.__rldObservable

Extension
  ├─ content-bridge.ts     injected into page; relays START/STOP/MARK to tagger
  ├─ background.ts         service worker; orchestrates session lifecycle
  ├─ session.ts            heap snapshot + source map fetch + analyze()
  └─ panel (Lit)           DevTools UI; sends commands, renders LeakReport
```

Data flow:

```
Panel  →[port]→  Background  →[tabs.sendMessage]→  Content bridge  →[window]→  Tagger
Panel  ←[port]←  Background  ←────────────────────────────────────────────────
                             ↘ captureHeapSnapshot + fetchSourceMaps + analyze()
```

---

## Reporting issues

Please open an issue in this repository. Include:

- Chrome version (`chrome://version`)
- Angular version (`ng version`)
- Whether you see the "Tagger missed early subscriptions" warning in the panel
- The exact error message (if any) from the RxJS Leaks panel
- A minimal reproduction if possible
