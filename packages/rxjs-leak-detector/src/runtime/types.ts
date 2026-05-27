import type {
  SubscriptionTag,
  LeakReport,
  RecordingMeta,
} from '@rld/analyzer-core';

export type EnableConfig = {
  /** Disable the floating widget. Default: false. */
  disableWidget?: boolean;
  /** Dashboard server URL. Default: 'http://localhost:7654'. */
  dashboardUrl?: string;
  /** Explicitly disable everything (useful for shared bootstrapping). Default: true (enabled). */
  enabled?: boolean;
};

export type SubRef = {
  id: string;
  tag: SubscriptionTag;
};

export type RecordingReport = {
  meta: RecordingMeta;
  subscriptions: SubscriptionTag[];  // all tagged subs from the recording window
};

export type { SubscriptionTag, LeakReport, RecordingMeta };
