declare global {
  // eslint-disable-next-line no-var
  var __rld_session: {
    recordingId: string;
    initialRoute: string;
    isRecording: boolean;
    currentRoute: string;
    stackHashCache: Map<string, string>;
  } | undefined;
}

const PATCHED = Symbol.for('__rld_patched');
const UNSUB_PATCHED = Symbol.for('__rld_unsub_patched');

let installedFlag = false;

export function isInstalled(): boolean {
  return installedFlag;
}

let counter = 0;
function makeId(): string {
  counter += 1;
  return `s-${Date.now().toString(36)}-${counter.toString(36)}`;
}

// Known RxJS creation function names to look for in _subscribe source text.
// Patterns are checked in order; use the most specific first.
// Note: RxJS 7 minifies closure variable names like `intervalDuration`, `dueTime`, etc.
// We match substrings (no trailing \b) to handle variable names that start with the keyword.
const RXJ_CREATION_PATTERNS: [RegExp, string][] = [
  [/intervalDuration/i, 'IntervalObservable'],
  [/\bfromEvent\b/i, 'FromEventObservable'],
  [/\bfromFetch\b/i, 'FromFetchObservable'],
  [/\bwebSocket\b/i, 'WebSocketSubject'],
  [/\bdueTime\b/i, 'TimerObservable'],
  [/\bfromArray\b|\bfrom\b/i, 'FromObservable'],
  [/\brange\b/i, 'RangeObservable'],
  [/\bdefer\b/i, 'DeferObservable'],
];

function detectObservableKind(observable: any): string {
  let current = observable;
  const seen = new Set<any>();
  let kind = 'Observable';
  while (current && !seen.has(current)) {
    seen.add(current);
    const ctorName = current.constructor?.name;
    if (ctorName && ctorName !== 'Observable' && ctorName !== 'Object') {
      kind = ctorName;
      break;
    }
    // Fallback: inspect _subscribe source text for known creation functions
    if (kind === 'Observable' && typeof current._subscribe === 'function') {
      const src = current._subscribe.toString();
      for (const [pattern, label] of RXJ_CREATION_PATTERNS) {
        if (pattern.test(src)) {
          kind = label;
          break;
        }
      }
      if (kind !== 'Observable') break;
    }
    current = current.source;
  }
  return kind;
}

export async function installPatch(): Promise<void> {
  if (installedFlag) return;
  const w = globalThis as any;
  let ObservableCtor: any = w.Observable;
  if (!ObservableCtor) {
    try {
      const mod = await import('rxjs');
      ObservableCtor = mod.Observable;
    } catch {
      return;
    }
  }
  const proto = ObservableCtor.prototype;
  if ((proto as any)[PATCHED]) {
    installedFlag = true;
    return;
  }
  Object.defineProperty(proto, PATCHED, { value: true, enumerable: false });
  const origSubscribe = proto.subscribe;
  proto.subscribe = function patchedSubscribe(this: any, ...args: any[]) {
    const subscription = origSubscribe.apply(this, args);
    const session = (globalThis as any).__rld_session;
    const recording = session?.isRecording === true;
    const meta: any = {
      id: makeId(),
      createdAtMs: Date.now(),
      route: recording ? session.currentRoute : '',
      stackRaw: recording ? new Error().stack ?? '' : '',
      observableKind: detectObservableKind(this),
      recordingId: recording ? session.recordingId : '',
      closed: false,
    };
    Object.defineProperty(subscription, '__sw_meta', {
      value: meta,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    const subProto = Object.getPrototypeOf(subscription);
    if (subProto && !(subProto as any)[UNSUB_PATCHED] && typeof subProto.unsubscribe === 'function') {
      Object.defineProperty(subProto, UNSUB_PATCHED, { value: true, enumerable: false });
      const origUnsub = subProto.unsubscribe;
      subProto.unsubscribe = function patchedUnsubscribe(this: any) {
        if (this.__sw_meta) this.__sw_meta.closed = true;
        return origUnsub.call(this);
      };
    }
    return subscription;
  };
  installedFlag = true;
}
