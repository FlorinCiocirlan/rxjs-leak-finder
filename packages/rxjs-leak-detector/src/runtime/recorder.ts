import type { SubscriptionTag } from '@rld/analyzer-core';
import type { RecordingReport } from './types.js';
import { getTrackedPath } from './route-tracker.js';

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
      const initial = getTrackedPath();
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
      const next = getTrackedPath();
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
