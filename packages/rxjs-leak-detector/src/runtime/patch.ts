import type { PatchableObservable } from './types.js';

export type Recorder = {
  onSubscribe(subscription: object, observable: object, stack: string): void;
  onUnsubscribe(subscription: object): void;
};

const PATCHED = Symbol.for('__rld_patched');
const UNSUB_PATCHED = Symbol.for('__rld_unsub_patched');

/** Mutable slot so tests can swap the active recorder without re-patching. */
const recorderSlot = { current: null as Recorder | null };

/**
 * Patch `Observable.prototype.subscribe` so every new Subscription is tagged
 * and reported to the active recorder. Safe to call more than once; only the
 * first call installs the patch, subsequent calls just update the recorder.
 */
export function installPatch(ObservableCtor: PatchableObservable, recorder: Recorder): void {
  recorderSlot.current = recorder;

  const proto = ObservableCtor.prototype as Record<PropertyKey, unknown>;
  if (proto[PATCHED]) return;
  Object.defineProperty(proto, PATCHED, { value: true, enumerable: false });

  const origSubscribe = proto.subscribe as (...args: unknown[]) => object;
  proto.subscribe = function patchedSubscribe(this: object, ...args: unknown[]) {
    const subscription = origSubscribe.apply(this, args);
    const stack = new Error().stack ?? '';
    recorderSlot.current?.onSubscribe(subscription, this, stack);
    patchUnsubscribe(subscription);
    return subscription;
  } as typeof proto.subscribe;
}

/**
 * Patch a Subscription's prototype `unsubscribe` exactly once. We do it
 * lazily — at the first subscribe that produces this Subscription subtype —
 * because rxjs ships several Subscription subclasses and we only know they
 * exist once we see one.
 */
function patchUnsubscribe(subscription: object): void {
  const proto = Object.getPrototypeOf(subscription) as Record<PropertyKey, unknown> | null;
  if (!proto || proto[UNSUB_PATCHED] || typeof proto.unsubscribe !== 'function') return;

  Object.defineProperty(proto, UNSUB_PATCHED, { value: true, enumerable: false });
  const origUnsub = proto.unsubscribe as (this: object) => unknown;
  proto.unsubscribe = function patchedUnsubscribe(this: object) {
    recorderSlot.current?.onUnsubscribe(this);
    return origUnsub.call(this);
  };
}
