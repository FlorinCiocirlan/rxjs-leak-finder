/**
 * Hidden property name attached to every patched Subscription, holding the
 * SubscriptionTag created at subscribe time. Shared between the runtime
 * (recorder.ts) and the heap-snapshot analyzer (subscription-finder.ts).
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

export type LeakKind =
  | 'nested-subscribe'
  | 'async-init'
  | 'ng-init'
  | 'global-event'
  | 'timer'
  | 'subject'
  | 'unknown';

export type LeakEntry = {
  id: string;
  route: string;
  observableKind: string;
  sourceLocation: { file: string; line: number; column: number };
  componentName: string | null;
  leakKind?: LeakKind;
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
