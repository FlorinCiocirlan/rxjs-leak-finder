/**
 * Hidden property name attached to every patched Subscription. The heap-snapshot
 * analyzer uses the same constant (mirrored in @rld/analyzer-core) to find
 * tagged subscriptions in V8 heap dumps.
 */
export const META_PROP = '__sw_meta' as const;

export type SubscriptionTag = {
  id: string;
  createdAtMs: number;
  route: string;
  stackRaw: string;
  observableKind: string;
  recordingId: string;
  closed: boolean;
};

export type NavigationEvent = {
  fromRoute: string;
  toRoute: string;
  atMs: number;
};

export type RecordingMeta = {
  recordingId: string;
  initialRoute: string;
  startedAtMs: number;
  stoppedAtMs: number;
  navigations: NavigationEvent[];
};

export type ResolvedStackFrame = {
  rawFrame: string;
  file: string;
  line: number;
  column: number;
  isFramework: boolean;
  functionName: string | null;
};

export type RetainerNode = {
  nodeId: number;
  constructorName: string;
  displayName: string | null;
};

export type LeakEntry = {
  id: string;
  route: string;
  observableKind: string;
  sourceLocation: { file: string; line: number; column: number };
  componentName: string | null;
  stack: ResolvedStackFrame[];
  retainerChain: RetainerNode[];
};

export type LongLivedEntry = {
  id: string;
  route: string;
  observableKind: string;
  componentName: string | null;
  sourceLocation: { file: string; line: number; column: number } | null;
};

export type LeakReport = {
  leaks: LeakEntry[];
  ignoredFrameworkSubscriptions: number;
  longLivedServiceSubscriptions: LongLivedEntry[];
  totalSubscriptionsScanned: number;
};

/**
 * Minimum shape we need from an Observable constructor: a prototype with a
 * `subscribe` method we can patch. RxJS's `Observable` satisfies this, but so
 * would any compatible implementation.
 */
export type PatchableObservable = {
  prototype: { subscribe: (...args: unknown[]) => unknown };
};

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
  subscriptions: SubscriptionTag[];
};
