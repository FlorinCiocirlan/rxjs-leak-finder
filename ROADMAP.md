# Roadmap

`rxjs-leak-finder` today answers one question: **"which subscriptions leaked?"** It points at the component, the file, and a kind. That's enough to find them, but it's not enough to *prioritize* them.

The next chapter is about answering a harder question: **"how much memory does each leak actually hold?"** That's the difference between a list of bugs and a list of bugs you can rank.

---

## Where we are now

The detector captures subscriptions at runtime. A "leak" is a subscription that:

- Was created on a route the user has since left.
- Was never unsubscribed.
- Has at least one frame in your own code.

That definition catches the right things — the demos in `angular-app-rxjs-leaks` confirm `nested-subscribe`, `async-init`, `ng-init`, `global-event`, `timer`, and `subject` leaks all surface correctly. But every leak in the dashboard currently looks the same in terms of impact. A leaked `interval(1000)` that holds 200 bytes shows up next to a leaked `BehaviorSubject` that holds 40 MB of cached responses. Both say "leak." Neither says "this one matters more."

In practice, this means:

- You can't tell whether a leak is responsible for the sluggishness users are reporting.
- You can't justify the time spent fixing one over another.
- You can't show before/after evidence that a fix actually reduced memory.

The data needed to answer all three is in the V8 heap snapshot — we just haven't wired the dashboard to read it yet.

---

## Where we're going: heap-snapshot integration

Chrome's DevTools can produce a `.heapsnapshot` file that contains every live JavaScript object and every reference between them. If we ingest that snapshot at the moment a recording stops, we can do something the runtime alone can't: **walk backwards from every leaked Subscription to discover everything it's keeping alive**, and add up the bytes.

The analyzer-core package already has the machinery — `heap-parser.ts`, `subscription-finder.ts`, `retainer-walker.ts`, `tag-decoder.ts`. The Subscription patch even tags each Subscription with a hidden `__sw_meta` property so the analyzer can match heap nodes to runtime tags. What's missing is the integration: the dashboard SPA never asks for a snapshot, and the analyzer's leak report never reaches the UI.

Concretely, the experience we're building toward looks like this:

1. You record as you do today: click **● Rec**, navigate, click **■ Stop**.
2. The widget asks: *"capture a heap snapshot now to measure leak size?"* (Yes / Skip).
3. If yes, the browser triggers the DevTools protocol heap-snapshot capture. This takes 1–10 seconds depending on app size.
4. The snapshot is uploaded to the dashboard server alongside the recording.
5. The dashboard re-runs analysis with snapshot data, and each leak row gets two new fields: **retained bytes** and **retainer chain** (the path from a GC root down to the leaked Subscription, showing exactly what's keeping it alive).

Now leaks sort by impact, the dashboard tells you "your `MarketsService` cache is holding 38 MB across 14 leaked subscriptions," and a fix can be verified by re-recording and seeing the number drop.

---

## Why this direction

There are simpler things we could do next — better widget styling, more leak-kind heuristics, a CI mode that fails the build on new leaks. They're all worth doing. We're prioritizing memory measurement because it's the *only* improvement that changes what users can decide with the tool. Everything else makes the existing experience nicer; this one unlocks a class of decisions that aren't currently possible.

It also closes a gap that's been the most common feedback on similar tools: "OK, I see the leak — but is it worth my time to fix it?" Without bytes, that question is unanswerable from the tool alone. With bytes, it becomes the first column you sort by.

---

## Trade-offs

### What it gains

- **Prioritization.** Sort leaks by retained bytes. Fix the biggest ones first.
- **Proof.** Before/after numbers make the case for memory work in code review.
- **Root-cause clarity.** The retainer chain shows exactly which closure, service, or module-level reference is holding the subscription. Stack traces tell you *where it was born*; retainer chains tell you *why it's still alive*.

### What it costs

- **Capture pause.** A heap snapshot freezes the JS thread for a few seconds. Acceptable in dev mode, but it means the widget can't capture silently — the user has to opt in per session.
- **Snapshot size.** Heap snapshots for real Angular apps run 50–500 MB. We'd need to compress before upload and stream-parse on the server.
- **Browser support.** The Chrome DevTools Protocol path works in Chromium-based browsers (Chrome, Edge, Brave, Opera, Arc). Firefox and Safari have different heap-debugging APIs that aren't compatible. Initial release will be Chromium-only; we'd document this clearly.
- **Permission model.** Capturing a heap snapshot programmatically requires either DevTools to be open, or a CDP connection (which requires `--remote-debugging-port`). Neither is convenient. We're investigating both paths and may end up shipping a small Chrome extension purely for the capture step (the rest of the tool stays extension-free).

---

## Alternatives considered

### Sampling allocations instead of snapshots

The DevTools `Performance` panel can sample allocations over time, producing a lighter-weight profile. It's faster to capture and smaller to upload. But it tells you *what was allocated*, not *what's still alive* — which is the question we actually care about for leaks. Useful for performance work, not for leak attribution. Rejected for this milestone.

### Estimating bytes from subscription kind

We could maintain a table — `interval` → ~150 bytes, `BehaviorSubject` → variable, etc. — and produce a rough estimate without any heap snapshot. Zero capture cost. But the estimates would be off by orders of magnitude for closures over large state (which is most real leaks). Worse than no number at all. Rejected.

### Stay subscription-only, add more heuristics instead

Double down on stack-trace classification, add more leak kinds, build a leak-pattern catalog. This is the path of least resistance. It would make the tool more accurate at *finding* leaks. But it doesn't help with *ranking* them, which is where users get stuck after the first week of use. Postponed, not rejected — we'll keep adding heuristics in parallel.

---

## What this enables next

Once retained bytes ship, a few features that aren't possible today become natural:

- **Memory budget CI.** "Fail the build if any route leaks more than 2 MB." Today we can only assert on count, which is too coarse.
- **Trend tracking.** Store retained-byte totals per route over time, surface regressions in the dashboard.
- **Leak fingerprinting.** Group leaks by their retainer chain root instead of by file:line — a single bad service caching pattern shows up as one entry instead of N.

None of these need new infrastructure once snapshots are integrated; they're applications of the same data.

---

## Timeline

There isn't one yet. The list above is the design direction, not a commitment to ship by a date. Issues and PRs in [the repo](https://github.com/FlorinCiocirlan/rxjs-leak-finder) are the source of truth for what's actually moving.

If you'd find this useful sooner, the most valuable contributions right now are:

1. **Snapshots from real apps.** A `.heapsnapshot` + the matching `.rld/*.json` recording from a real codebase tells us whether our retainer-chain assumptions hold. Open an issue with both files attached.
2. **CDP capture experiments.** Anyone who's wrestled with programmatic heap snapshots in Chromium and has a story to tell — file an issue, even just a writeup of what didn't work.

---

## Related reading

- [HOW_IT_WORKS.md](./packages/rxjs-leak-detector/HOW_IT_WORKS.md) — the design as it stands today, including the heap-snapshot machinery in `analyzer-core` that's not yet wired up.
- Chrome DevTools docs on [heap snapshots](https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots).
- V8's [heap snapshot format](https://v8.dev/blog/efficient-heap-snapshots) — the parser in `analyzer-core/src/heap-parser.ts` reads this directly.
