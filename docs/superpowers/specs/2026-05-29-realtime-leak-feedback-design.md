# Real-time leak feedback for the recording session

**Date:** 2026-05-29
**Status:** Approved design, pending implementation plan
**Package(s):** `rxjs-leak-detector` (runtime + CLI server + dashboard app), `panel-ui`

## Problem

Today the record flow is fire-and-forget: the user clicks **● Rec**, navigates their app while the
runtime silently collects subscription tags in memory, and only on **■ Stop** is a single
`RecordingReport` POSTed to the dashboard server and rendered. There is zero feedback during the
session — the user can't tell if anything is being captured, and can't react to leaks as they happen.

## Goal

Give live feedback during a recording. The moment the user hits Rec and starts navigating, the
dashboard shows a "waiting for leaks…" state with animation, then streams leak **candidates** as they
are detected. The floating widget on the app page shows a pulsing recording indicator plus an
approximate live candidate count. Stop ends the session and swaps the dashboard to today's full
symbolicated report (unchanged).

## Decisions (locked during brainstorming)

1. **Live content = leak candidates**, streamed — not a raw activity feed. A candidate uses the
   same verdict rule as the final report (open subscription whose creation route has been left).
2. **Feedback locus = dashboard + widget badge.** Dashboard is the authoritative live view; the
   widget shows a pulsing dot + approximate count so the user gets feedback without tab-switching.
3. **Transport = POST deltas + SSE push.** Page POSTs incremental deltas to the server; the server
   relays them to the dashboard UI over Server-Sent Events. (Polling rejected as laggy/churny;
   WebSocket rejected as overkill for a localhost dev tool.)
4. **Heartbeat:** page sends an empty delta every ~2s while recording (surfaces leaks without a
   following navigation, keeps SSE warm, lets the UI detect a dead page).
5. **Widget badge:** pulsing dot **and** approximate count (`● Rec · 3`).

## Key principle

The page never gets heavier with analysis. It streams the same `SubscriptionTag`s it already
collects, plus navigation events. All symbolication and framework filtering stays in the dashboard
UI, where source maps already live. The server is a dumb relay + buffer (no analyzer-core). The live
verdict reuses the **exact** `buildReport` leak rule, fed incrementally.

The page *can* cheaply know the candidate set (open + route-left, with a rough URL-based framework
filter) but only the dashboard can produce the authoritative symbolicated + framework-filtered list.
Hence: page streams raw deltas → dashboard is source of truth; widget count is approximate.

## Architecture & data flow

```
PAGE (app, patched)                 DASHBOARD SERVER (localhost:7654)        DASHBOARD UI (app.ts / panel-ui)
  recorder collects tags  ── POST /session/start ───────►  open live buffer  ── SSE: session-start ──►  enter live mode (waiting)
  delta-emitter (timer+nav) ─ POST /session/:id/delta ──►  append + fan out  ── SSE: delta ──────────►  incremental buildReport → render candidates
  widget pulse + count                                                                                   (cache SourceMapConsumers)
  on stop ─────────────────── POST /report (today) ─────►  finalize+persist  ── SSE: session-end ─────►  swap to full report (today's flow)
```

## Data contracts

New shared types (page emits raw, dashboard refines):

```ts
// POST /session/start
type SessionStart = { recordingId: string; initialRoute: string; startedAtMs: number };

// POST /session/:id/delta — on each navigation + ~2s heartbeat
type SessionDelta = {
  recordingId: string;
  seq: number;                    // monotonic; UI detects gaps
  navigations: NavigationEvent[]; // new since last delta
  added: SubscriptionTag[];       // subs opened since last delta
  closedIds: string[];            // sub ids unsubscribed since last delta
  currentRoute: string;
};
```

`SubscriptionTag` and `NavigationEvent` are the **existing** types — unchanged. Deltas are
incremental (server holds the running buffer); the page does not resend full state.

SSE stream (`GET /live`, `text/event-stream`):

```
event: session-start   data: SessionStart
event: delta           data: SessionDelta
event: session-end     data: { recordingId, fileName }
```

The server fans out exactly what it received, plus a synthesized full-state delta on (re)connect so a
late-joining tab catches up. No analysis server-side.

**UI-side live candidate** (derived, not transported): a `LeakEntry` with `retainerChain: []`
(retainer chains are heap-snapshot/stop-time only). The live view renders these with the existing
`leak-row` component.

**Widget badge count** (page-local, approximate):
`openSubs.filter(s => leftRoutes.has(s.route) && !isFrameworkUrl(topFrameUrl(s)))`. Uses the cheap
URL-pattern filter only (no source maps page-side), so it may differ slightly from the dashboard's
authoritative count. The badge is a "something's happening" signal; the dashboard is truth.

## Component changes

### Dashboard server — `packages/rxjs-leak-detector/src/cli/dashboard-server.ts`

In-memory live registry, no disk until finalize:

```ts
type LiveSession = {
  start: SessionStart;
  lastSeq: number;
  snapshot: { subscriptions: SubscriptionTag[]; navigations: NavigationEvent[]; currentRoute: string };
  lastDeltaAtMs: number;
};
const live = new Map<string, LiveSession>();  // keyed by recordingId
const sseClients = new Set<ServerResponse>();
```

New routes in `handleRequest`:
- `POST /session/start` → create `LiveSession`, broadcast `session-start`.
- `POST /session/:id/delta` → validate `recordingId`, fold into `snapshot`, broadcast `delta`, update
  `lastDeltaAtMs`. Drop if no live entry (stale).
- `GET /live` → SSE: headers (`content-type: text/event-stream`, `cache-control: no-cache`,
  `connection: keep-alive`; CORS already set), write `retry:` hint, register `res`, replay current
  `session-start` + synthetic full-state delta if a session is live, comment-ping every ~15s, clean
  up on `req.on('close')`.
- `POST /report` (existing) → after writing the file, broadcast `session-end {recordingId, fileName}`
  and delete the live entry. Existing persistence untouched.

TTL sweep: a session with no delta for ~30s → broadcast synthetic `session-end`, drop buffer.

Broadcast helper: serialize once, `res.write(\`event: ${type}\ndata: ${json}\n\n\`)`; drop clients
that throw.

### Page / runtime

- **`recorder.ts`** — add `seq` counter + per-delta accumulators (`pendingAdded`,
  `pendingClosedIds`, `pendingNavs`). `onSubscribe`/`onUnsubscribe`/`recordNavigation` also push to
  accumulators. New `drainDelta(): SessionDelta` (returns + clears; empty-but-valid on heartbeat) and
  `liveCandidateCount(): number`.
- **`live-emitter.ts`** (NEW) — owns streaming side effects. `startLive()` POSTs `/session/start`,
  starts a ~2s interval that drains + POSTs `/session/:id/delta` and updates the widget count; also
  drains immediately on navigation. `stopLive()` clears the interval. All POSTs best-effort
  (try/catch, swallowed). Final `/report` POST stays in `controller.stop`.
- **`enable.ts`** — `controller.start()` also calls `startLive`; `controller.stop()` calls
  `stopLive` before `sendReport`. Route-tracker callback triggers an immediate drain.
- **`widget.ts`** — extend `WidgetController` with `setLeakCount(n)` and a recording pulse. While
  recording render `● Rec · {n}` with a CSS-pulsing dot (`n===0` → `● Rec` + subtle "watching…").
  Drag/click logic untouched.
- **Shared util** — extract `isFrameworkUrl` + top-frame URL extraction into a tiny shared helper so
  the page-side approximate filter and the dashboard filter don't drift.

`EnableConfig` unchanged. Live streaming is auto-on when recording; no new config flag (YAGNI).

### Dashboard UI — `packages/rxjs-leak-detector/src/dashboard/app.ts` + `panel-ui`

- `app.ts` opens `EventSource('/live')`. `session-start` → enter live mode (waiting state). `delta` →
  fold into running buffer, recompute candidates via the existing `buildReport` leak rule,
  symbolicate incrementally (cache `SourceMapConsumer`s across deltas; fetch maps only for new script
  URLs; destroy on `session-end`). `session-end` → exit live mode, load the persisted session
  (today's full report).
- `leak-detector-root` gains a `live` mode with `liveCandidates` + waiting state, reusing `leak-row`.
- Existing past-sessions list + 3s poll stays for non-live browsing.

### Live view UI (from approved mockup)

- **Live banner:** pulsing red dot + `LIVE` + current route + elapsed timer.
- **Waiting state:** spinning radar, "Waiting for leaks…", hint line, live count of active subs
  watched.
- **Streaming state:** summary strip (leak candidates / subs tracked / routes visited) + candidate
  rows; newest slides in tagged `NEW`. Row shows observable kind or component name, source location,
  and which route it leaked from.
- **On Stop:** banner off, panel swaps to today's full symbolicated report (retainer chains, stack
  frames, source links) — unchanged.

## Error handling & edge cases

- **Dashboard closed/unreachable:** all live POSTs best-effort and swallowed. Recording integrity
  never depends on the dashboard — final `/report` + the existing localStorage retry queue untouched.
  Live is pure bonus.
- **SSE drop / tab opened mid-session:** `EventSource` auto-reconnects (`retry:`); server replays
  `session-start` + synthetic full-state delta from `snapshot` so a late tab catches up.
- **`seq` gap:** UI drops the EventSource and reopens; rebuilds from the replayed snapshot.
- **Orphan live session** (app tab closed, no `/report`): server TTL sweep (~30s no delta) →
  synthetic `session-end`, drop buffer; dashboard returns to past-sessions list.
- **Multiple concurrent recordings:** keyed by `recordingId`; UI shows the most recent
  `session-start`. One live session in the UI at a time (YAGNI on multi-live panels).
- **Symbolication cost per delta:** cached consumers; only new URLs fetched; destroyed on
  `session-end`.
- **Stale delta after finalize:** server drops deltas with no live entry; UI ignores deltas after
  `session-end`.

## Testing

- **`recorder.ts`** (vitest): `drainDelta` accumulates + clears; `seq` monotonic; heartbeat yields
  empty-but-valid delta; `liveCandidateCount` honors open + route-left + URL framework filter.
- **dashboard-server** (real `http`, like `dashboard-server.test.ts`): `/session/start` + `/delta`
  broadcast to a connected `/live` client (parse `event:`/`data:` frames); `/report` emits
  `session-end` + still persists; orphan TTL reaps; late SSE client gets replay snapshot.
- **live-emitter**: timer drains + POSTs; nav triggers immediate drain; POST failure swallowed.
- **widget**: `setLeakCount` renders `● Rec · n` + pulse; drag/click tests stay green.
- **app.ts / panel-ui**: light DOM test — `delta` events produce candidate rows; `session-end` swaps
  to full report. Heavy symbolication stays covered by existing tests.
- **Manual smoke:** in a host app with the runtime enabled — Rec, navigate, watch candidates stream
  into the dashboard + widget count tick, Stop, confirm full report renders. Exact steps in the plan.

## Out of scope (YAGNI)

- Multiple simultaneous live panels in the UI.
- Retainer chains for live candidates (heap-snapshot only; stop-time).
- A config flag to disable live streaming (auto-on with recording).
- Persisting partial sessions before Stop.
```
