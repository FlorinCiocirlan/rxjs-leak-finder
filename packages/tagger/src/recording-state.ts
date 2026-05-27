type Session = {
  recordingId: string;
  initialRoute: string;
  isRecording: boolean;
  currentRoute: string;
  startedAtMs: number;
  navigations: Array<{ fromRoute: string; toRoute: string; atMs: number }>;
  stackHashCache: Map<string, string>;
};

function currentPath(): string {
  return window.location.pathname + window.location.search + window.location.hash;
}

function makeRecordingId(): string {
  return `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export type RecordingApi = {
  readonly isRecording: boolean;
  start(): void;
  stop(): {
    recordingId: string;
    initialRoute: string;
    startedAtMs: number;
    stoppedAtMs: number;
    navigations: Array<{ fromRoute: string; toRoute: string; atMs: number }>;
  };
  markNavigation(): void;
  recordNavigation(change: { from: string; to: string }): void;
};

export function createRecordingApi(): RecordingApi {
  const api: RecordingApi = {
    get isRecording() {
      return (globalThis as any).__rld_session?.isRecording === true;
    },
    start() {
      const initial = currentPath();
      const session: Session = {
        recordingId: makeRecordingId(),
        initialRoute: initial,
        isRecording: true,
        currentRoute: initial,
        startedAtMs: Date.now(),
        navigations: [],
        stackHashCache: new Map(),
      };
      (globalThis as any).__rld_session = session;
    },
    stop() {
      const session: Session | undefined = (globalThis as any).__rld_session;
      if (!session) {
        return {
          recordingId: '',
          initialRoute: '',
          startedAtMs: 0,
          stoppedAtMs: Date.now(),
          navigations: [],
        };
      }
      session.isRecording = false;
      const meta = {
        recordingId: session.recordingId,
        initialRoute: session.initialRoute,
        startedAtMs: session.startedAtMs,
        stoppedAtMs: Date.now(),
        navigations: session.navigations.slice(),
      };
      return meta;
    },
    markNavigation() {
      const session: Session | undefined = (globalThis as any).__rld_session;
      if (!session) return;
      const next = currentPath();
      session.navigations.push({ fromRoute: session.currentRoute, toRoute: next, atMs: Date.now() });
      session.currentRoute = next;
    },
    recordNavigation(change) {
      const session: Session | undefined = (globalThis as any).__rld_session;
      if (!session) return;
      // If this is the first navigation, update initialRoute to the from field
      // so tests and callers that immediately record navigations get an accurate initialRoute
      if (session.navigations.length === 0) {
        session.initialRoute = change.from;
      }
      session.navigations.push({ fromRoute: change.from, toRoute: change.to, atMs: Date.now() });
      session.currentRoute = change.to;
    },
  };
  return api;
}
