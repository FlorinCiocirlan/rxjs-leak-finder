import { describe, it, expect } from 'vitest';
import { Observable, Subject, interval } from 'rxjs';
import { installPatch, type Recorder } from '../../src/runtime/patch.js';

function mockRecorder(): Recorder & { events: string[] } {
  const events: string[] = [];
  return {
    events,
    onSubscribe(sub, observable, stack) {
      events.push(`sub:${observable.constructor?.name ?? 'Observable'}`);
    },
    onUnsubscribe(sub) {
      events.push('unsub');
    },
  };
}

describe('installPatch', () => {
  it('is idempotent', () => {
    const r = mockRecorder();
    installPatch(Observable, r);
    installPatch(Observable, r);
    // First install patches; second is no-op. No extra events.
    new Observable<number>(o => o.complete()).subscribe();
    expect(r.events.filter(e => e.startsWith('sub:'))).toHaveLength(1);
  });

  it('calls onSubscribe on new Subscription', () => {
    const r = mockRecorder();
    installPatch(Observable, r);
    new Subject<void>().subscribe();
    expect(r.events.some(e => e.startsWith('sub:'))).toBe(true);
  });

  it('calls onUnsubscribe when subscription is unsubscribed', () => {
    const r = mockRecorder();
    installPatch(Observable, r);
    const sub = new Subject<void>().subscribe();
    r.events.length = 0;
    sub.unsubscribe();
    expect(r.events).toContain('unsub');
  });
});
