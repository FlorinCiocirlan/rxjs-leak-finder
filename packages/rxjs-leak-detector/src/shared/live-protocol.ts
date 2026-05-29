import type { SubscriptionTag, NavigationEvent } from '../runtime/types.js';

/** POSTed once to /session/start when recording begins. */
export type SessionStart = {
  recordingId: string;
  initialRoute: string;
  startedAtMs: number;
};

/** POSTed to /session/:id/delta on each navigation and on the ~2s heartbeat. */
export type SessionDelta = {
  recordingId: string;
  /** Monotonic per session; lets the UI detect dropped deltas. */
  seq: number;
  /** Navigations observed since the previous delta. */
  navigations: NavigationEvent[];
  /** Subscriptions opened since the previous delta. */
  added: SubscriptionTag[];
  /** Subscription ids that unsubscribed since the previous delta. */
  closedIds: string[];
  /** Route the app is on as of this delta. */
  currentRoute: string;
};
