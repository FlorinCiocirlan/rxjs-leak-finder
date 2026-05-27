export type Recorder = {
  onSubscribe(subscription: object, observable: object, stack: string): void;
  onUnsubscribe(subscription: object): void;
};

const PATCHED = Symbol.for('__rld_patched');
const UNSUB_PATCHED = Symbol.for('__rld_unsub_patched');

// Mutable recorder slot — updated on every installPatch call so tests can swap recorders
const recorderSlot = { current: null as Recorder | null };

export function installPatch(ObservableCtor: any, recorder: Recorder): void {
  // Always update the active recorder (allows recorders to be swapped between tests)
  recorderSlot.current = recorder;

  const proto = ObservableCtor.prototype;
  if ((proto as any)[PATCHED]) return;
  Object.defineProperty(proto, PATCHED, { value: true, enumerable: false });

  const origSubscribe = proto.subscribe;
  proto.subscribe = function patchedSubscribe(this: any, ...args: any[]) {
    const subscription = origSubscribe.apply(this, args);
    const stack = new Error().stack ?? '';
    recorderSlot.current?.onSubscribe(subscription, this, stack);
    const subProto = Object.getPrototypeOf(subscription);
    if (subProto && !(subProto as any)[UNSUB_PATCHED] && typeof subProto.unsubscribe === 'function') {
      Object.defineProperty(subProto, UNSUB_PATCHED, { value: true, enumerable: false });
      const origUnsub = subProto.unsubscribe;
      subProto.unsubscribe = function patchedUnsubscribe(this: any) {
        recorderSlot.current?.onUnsubscribe(this);
        return origUnsub.call(this);
      };
    }
    return subscription;
  };
}
