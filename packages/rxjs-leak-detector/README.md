# rxjs-leak-finder

> Find leaked RxJS subscriptions in your Angular dev-mode app.
> One line in `main.ts`, a floating widget, a local dashboard. No Chrome extension.

[![npm](https://img.shields.io/npm/v/rxjs-leak-finder.svg)](https://www.npmjs.com/package/rxjs-leak-finder)
[![license](https://img.shields.io/npm/l/rxjs-leak-finder.svg)](./LICENSE)

---

## What it does

You add one line to `main.ts`. The detector patches `Observable.prototype.subscribe` and starts watching. You navigate around your app and click **Stop** in the floating widget. The detector POSTs the report to a local dashboard, which highlights subscriptions that were created on a route you left without ever being unsubscribed. Each leak shows the **component**, the **file:line** where it was subscribed, and a category (`nested-subscribe`, `async-init`, `ng-init`, `global-event`, `timer`, `subject`).

It works on any Angular dev-mode app — standalone or NgModule, signals or RxJS, ChangeDetectionStrategy.OnPush or default.

See [HOW_IT_WORKS.md](./HOW_IT_WORKS.md) for the design and the bits that make this possible.

---

## Install

```sh
npm install --save-dev rxjs-leak-finder
# or
pnpm add -D rxjs-leak-finder
# or
yarn add -D rxjs-leak-finder
```

---

## Wire it up

Add one block to your Angular `main.ts`. Use `isDevMode()` so it never reaches production:

```ts
import { isDevMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { Observable } from 'rxjs';
import { enableRxjsLeakDetector } from 'rxjs-leak-finder';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

if (isDevMode()) {
  enableRxjsLeakDetector(Observable);
}

bootstrapApplication(AppComponent, appConfig);
```

That's it. Reload — there's a floating widget in the top-right of your app.

> Pass **your** `Observable` (the one your app imports from `rxjs`). Different bundles can produce different `Observable` classes; passing yours guarantees the right prototype gets patched.

---

## Use it

In one terminal, run your Angular app (`ng serve` / `npm start`).

In another terminal, start the dashboard:

```sh
npx rxjs-leak-finder dashboard
# → http://localhost:7654
```

The dashboard auto-opens in your browser. To record a session:

1. In your app: click **● Rec** on the floating widget.
2. Navigate to the route you want to test.
3. Navigate **away** to another route (the route change is the "boundary").
4. Click **■ Stop**.
5. Reload the dashboard — the session appears in the list. Click it to see the leaks.

A leak is any subscription that was created on the route you left, never unsubscribed, and has at least one frame in your own code (framework subscriptions are filtered out).

---

## What the dashboard shows

- **KPI cards**: total leaks, subscriptions scanned, framework subscriptions ignored, long-lived service subscriptions.
- **Breakdowns**: by leak kind, by route, by component.
- **Search**: filter rows by component, file, route, observable kind, leak kind.
- **Filter chips**: click a kind or a route to narrow down.
- **Each row**: component name + observable kind on top, `file:line:col` (clickable, opens in your editor) underneath, plus colored badges for route and leak kind.
- **Expanded row**: full resolved stack trace; click any frame to jump to it in your editor.

### Leak kinds

| Kind | What triggers it |
|---|---|
| `nested-subscribe` | A `subscribe()` was called inside another `subscribe()`. Use `switchMap` / `mergeMap` instead. |
| `async-init` | `subscribe()` ran after an `await` in an `async ngOnInit` — outside the injection context, so `takeUntilDestroyed()` silently no-ops. |
| `ng-init` | Plain `subscribe()` in `ngOnInit` with no teardown. |
| `global-event` | `fromEvent(window, …)` or `addEventListener` — survives navigation because the source outlives the component. |
| `timer` | `interval` / `timer` subscription with no teardown. |
| `subject` | Subscribed to a module-level or service-level `Subject` / `BehaviorSubject` without teardown. |

---

## Open in editor

Clicking `file:line:col` POSTs to the dashboard server, which shells out to your editor. Default is VS Code (`code -g file:line:col`). To pick another editor:

```sh
RLD_EDITOR=idea     npx rxjs-leak-finder dashboard   # IntelliJ
RLD_EDITOR=webstorm npx rxjs-leak-finder dashboard   # WebStorm
RLD_EDITOR=cursor   npx rxjs-leak-finder dashboard   # Cursor
RLD_EDITOR=subl     npx rxjs-leak-finder dashboard   # Sublime
```

Recognized: `code`, `cursor`, `codium`, `idea`, `webstorm`, `pycharm`, `phpstorm`, `goland`, `rubymine`, `clion`, `datagrip`, `fleet`, `subl`, `sublime`, `atom`, `vim`, `nvim`, `emacs`. The right CLI flag is picked per editor. If the launcher isn't on PATH, the server falls back to the OS opener (no jump-to-line).

To make it permanent: `echo 'export RLD_EDITOR=idea' >> ~/.zshrc`.

---

## Config

```ts
enableRxjsLeakDetector(Observable, {
  /** Don't mount the floating widget. You can still start/stop via the controller. */
  disableWidget: false,
  /** Where the dashboard listens. */
  dashboardUrl: 'http://localhost:7654',
  /** Disable everything (overrides the others). */
  enabled: true,
});
```

The call returns a `LeakDetectorController`:

```ts
const controller = enableRxjsLeakDetector(Observable);
controller?.start();
// …navigate…
await controller?.stop();    // POSTs the report
controller?.teardown();      // remove the patch + widget (rarely needed)
```

---

## CLI

```sh
rxjs-leak-finder dashboard [options]

  --port=<n>     Port (default 7654)
  --cwd=<path>   Where to write .rld/ session files (default cwd)
  --no-open      Don't auto-open the browser
  --help, -h     Show this help
```

Sessions are stored as `.rld/*.json` in the working directory. Add `.rld/` to `.gitignore`.

---

## FAQ

**Will it break my production build?**
No — wrap the call in `if (isDevMode())`. The detector still ships in your bundle as a devDependency. The runtime is small (~5 kB gzipped) and inert until `enableRxjsLeakDetector` is called.

**Does it work with NgRx, RxJS interop, signals?**
Yes. It patches the `Observable` prototype, so any subscription created from any observable in your app is tracked. Signals don't create RxJS subscriptions, so they're invisible to the detector — that's correct, since signals can't leak the way subscriptions can.

**Does it work in production?**
Don't run it in production. The detector captures stack traces on every `subscribe()`, which has measurable overhead.

**False positives?**
The biggest source of noise is long-lived service subscriptions (singletons that *should* live for the app's lifetime). The detector lists those separately as `long-lived`, not as leaks. If you see a real subscription marked as a leak that you believe is correct, open an issue with the session JSON from `.rld/`.

**No leak shows up?**
Three common causes:
1. You didn't click **● Rec** before triggering the leak.
2. You didn't navigate away (the detector only flags subscriptions on routes you've *left*).
3. The subscription is in a framework path (`node_modules/`, polyfills, zone.js); those are intentionally filtered.

---

## Architecture in one sentence

The detector monkey-patches `Observable.prototype.subscribe` to tag every Subscription with a stack trace, the recorder tracks route changes via the History API, the dashboard server stores reports as JSON, and the dashboard SPA classifies each leak using stack-trace heuristics. For the full story, see [HOW_IT_WORKS.md](./HOW_IT_WORKS.md).

---

## License

MIT © Florin Ciocirlan
