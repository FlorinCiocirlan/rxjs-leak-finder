import type { SubscriptionTag, RecordingReport, NavigationEvent } from './types.js';
import { META_PROP } from './types.js';
import { getTrackedPath } from './route-tracker.js';
import type { SessionDelta } from '../shared/live-protocol.js';
import { topUserFrameUrl } from '../shared/framework-filter.js';

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
    seq: number;
    pendingAdded: SubscriptionTag[];
    pendingClosedIds: string[];
    pendingNavs: NavigationEvent[];
  };

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

  return {
    get isRecording() { return state.isRecording; },
    get currentRecordingId() { return state.recordingId; },
    get initialRoute() { return state.initialRoute; },
    get startedAtMs() { return state.startedAtMs; },

    start(): void {
      const initial = getTrackedPath();
      state.recordingId = makeRecordingId();
      state.isRecording = true;
      state.initialRoute = initial;
      state.currentRoute = initial;
      state.startedAtMs = Date.now();
      state.navigations = [];
      state.subscriptions = new Map();
      state.seq = 0;
      state.pendingAdded = [];
      state.pendingClosedIds = [];
      state.pendingNavs = [];
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
      const next = getTrackedPath();
      if (next === state.currentRoute) return;
      state.navigations.push({ fromRoute: state.currentRoute, toRoute: next, atMs: Date.now() });
      state.pendingNavs.push({ fromRoute: state.currentRoute, toRoute: next, atMs: Date.now() });
      state.currentRoute = next;
    },

    recordNavigation(change: { from: string; to: string }): void {
      if (!state.isRecording) return;
      state.navigations.push({ fromRoute: change.from, toRoute: change.to, atMs: Date.now() });
      state.pendingNavs.push({ fromRoute: change.from, toRoute: change.to, atMs: Date.now() });
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
      Object.defineProperty(subscription, META_PROP, {
        value: tag,
        enumerable: false,
        writable: true,
        configurable: true,
      });
      state.subscriptions.set(tag.id, { tag });
      state.pendingAdded.push(tag);
    },

    onUnsubscribe(subscription: object): void {
      const meta = (subscription as Record<string, unknown>)[META_PROP] as SubscriptionTag | undefined;
      if (!meta) return;
      meta.closed = true;
      const entry = state.subscriptions.get(meta.id);
      if (entry) {
        entry.tag.closed = true;
        state.pendingClosedIds.push(meta.id);
      }
    },

    drainDelta(): SessionDelta {
      state.seq += 1;
      const delta: SessionDelta = {
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
  };
}
