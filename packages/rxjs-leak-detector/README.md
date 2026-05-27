# rxjs-leak-detector

A dev-mode tool to detect unsubscribed RxJS subscriptions in Angular apps.
**No Chrome extension required.** One line in `main.ts`, a floating widget in the browser, and a local dashboard that stores sessions as JSON files.

---

## Install

```sh
# pnpm
pnpm add -D rxjs-leak-detector

# npm
npm install --save-dev rxjs-leak-detector

# yarn
yarn add -D rxjs-leak-detector
```

---

## Hook into your app

Add **one block** to your Angular `main.ts` (standalone bootstrap):

```ts
import { bootstrapApplication } from '@angular/platform-browser';
import { Observable } from 'rxjs';
import { enableRxjsLeakDetector } from 'rxjs-leak-detector';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { environment } from './environments/environment';

if (!environment.production) {
  enableRxjsLeakDetector(Observable);
}

bootstrapApplication(AppComponent, appConfig);
```

`enableRxjsLeakDetector` patches `Observable.prototype.subscribe` at startup and mounts a small floating widget in the top-right corner of your app.

---

## Open the dashboard

Start the local dashboard server (it persists sessions as `.rld/*.json` files):

```sh
npx rxjs-leak-detector dashboard
```

Opens `http://localhost:7654` in your default browser.

---

## Record a session

1. Navigate to the route you want to test in your browser.
2. Click **● Rec** on the floating widget to start recording.
3. Navigate away to another route (this triggers the "route changed" boundary).
4. Click **■ Stop** to end the session and send the report to the dashboard.
5. Reload the dashboard — your session appears in the list. Leaks are highlighted.

A "leak" is any subscription that was created during the recording window, was never explicitly unsubscribed before the route changed, and has at least one user-code frame in its creation stack.

---

## Config options

```ts
enableRxjsLeakDetector(Observable, config?: EnableConfig): LeakDetectorController | null
```

Full `EnableConfig` type:

```ts
type EnableConfig = {
  /**
   * Disable the floating record/stop widget.
   * Useful when you want to control recording programmatically.
   * Default: false (widget is shown).
   */
  disableWidget?: boolean;

  /**
   * URL of the dashboard server.
   * Change this if you run the dashboard on a non-default port.
   * Default: 'http://localhost:7654'.
   */
  dashboardUrl?: string;

  /**
   * Set to false to completely disable the detector (useful in shared
   * bootstrap code that runs in both dev and prod builds).
   * Default: true (enabled).
   */
  enabled?: boolean;
};
```

### Examples

**Headless (no widget), custom port:**

```ts
enableRxjsLeakDetector(Observable, {
  disableWidget: true,
  dashboardUrl: 'http://localhost:9000',
});
```

**Guard with environment flag (recommended):**

```ts
if (!environment.production) {
  enableRxjsLeakDetector(Observable, {
    disableWidget: false,
  });
}
```

**Programmatic control via the returned controller:**

```ts
const rld = enableRxjsLeakDetector(Observable, { disableWidget: true });

// start recording manually
rld?.start();

// stop and send report
await rld?.stop();
```

---

## What counts as a "leak"?

A subscription is flagged when **all** of the following are true:

- It was created inside the recording window (between ● Rec and ■ Stop).
- Its `closed` flag is still `false` when recording ends (i.e. it was never unsubscribed).
- Its creation stack trace contains at least one frame pointing to your application code (not `node_modules`).

The detector relies on the `closed` property on `Subscription`. This is accurate for
`takeUntil`, `unsubscribe()`, and `async` pipe teardown — but **not** for subscriptions
that are genuinely long-lived (e.g. a global store). Filter those out using stack frames
or the `observableKind` field in the report.

---

## Limitations compared to the Chrome extension approach

| Feature | rxjs-leak-detector (this package) | Chrome extension |
|---|---|---|
| Retainer chains | Not available | Full JS heap retainer path |
| Forced GC check | No | Yes (via `gc()` CDP command) |
| "Still retained in heap" | No — uses `closed` tag only | Yes |
| Setup | 1 line in `main.ts` | Extension install + devtools |
| CI / headless use | Yes | No |

Sessions written by this package will have an empty `retainerChain` array. The dashboard
hides the "Retainer chain" section when it is empty.

---

## CLI reference

```
rxjs-leak-detector dashboard [options]

Options:
  --port=<n>     Port to listen on (default: 7654)
  --cwd=<path>   Directory where .rld/ session files are written
                 (default: current working directory)
  --no-open      Do not auto-open the browser after starting
  --help, -h     Print this help message
```

### Examples

```sh
# Start on a custom port without opening the browser
npx rxjs-leak-detector dashboard --port=9000 --no-open

# Store sessions in a project sub-directory
npx rxjs-leak-detector dashboard --cwd=./my-app
```

---

## The `.rld/` directory

Each recorded session is saved as a JSON file under `.rld/` in the working directory:

```
.rld/
  2026-05-28T10-30-00-000Z-abc123.json
  2026-05-28T10-35-00-000Z-def456.json
```

Each file contains the full `RecordingMeta` (route, timestamps, navigations) and the
list of `SubscriptionTag` objects (stack, observable kind, closed flag).

**Add `.rld/` to your `.gitignore`:**

```
# .gitignore
.rld/
```

---

## Troubleshooting

**Widget not appearing**

- Check that `disableWidget` is not set to `true` in your config.
- Confirm the `if (!environment.production)` guard evaluates to `true` in your dev build.
- Some strict CSPs block custom elements — check the browser console for errors.

**Dashboard shows 404 / blank page**

- The static dashboard assets are bundled inside the package. Ensure you are using
  `npx rxjs-leak-detector dashboard` (not importing the CLI file directly).
- If you built from source, run `pnpm build` inside `packages/rxjs-leak-detector` first.

**Sessions not appearing in the dashboard**

- Confirm the dashboard is running before you click Stop.
- Check the browser console for CORS or network errors on `POST /report`.
- If the dashboard URL differs from the default, pass it via `dashboardUrl` in your config.

**Source frames showing `<anonymous>` or minified paths**

- The detector reads raw `Error.stack` output. For readable frames, run your dev server
  with source maps enabled (the default for Angular CLI / Vite).
- The dashboard proxies source-map files via `/source-maps?url=<mapUrl>` — make sure
  your dev server is accessible from localhost.

**`enableRxjsLeakDetector` called multiple times**

- The function is idempotent: it returns the existing controller on subsequent calls.
  Safe to call in lazy-loaded modules as long as the first call happened in `main.ts`.
