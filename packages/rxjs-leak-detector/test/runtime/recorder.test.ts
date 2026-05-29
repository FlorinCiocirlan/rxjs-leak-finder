import { describe, it, expect, beforeEach } from 'vitest';
import { createRecorder } from '../../src/runtime/recorder.js';

describe('createRecorder', () => {
  let recorder: ReturnType<typeof createRecorder>;

  beforeEach(() => {
    recorder = createRecorder();
  });

  it('starts a recording with current path as initial route', () => {
    window.history.replaceState({}, '', '/products');
    recorder.start();
    expect(recorder.isRecording).toBe(true);
  });

  it('tags new subscriptions with current recordingId and route', () => {
    window.history.replaceState({}, '', '/products');
    recorder.start();
    const fakeSub: any = {};
    const fakeObs: any = { constructor: { name: 'IntervalObservable' } };
    recorder.onSubscribe(fakeSub, fakeObs, 'Error: stack');
    expect(fakeSub.__sw_meta).toBeDefined();
    expect(fakeSub.__sw_meta.route).toBe('/products');
    expect(fakeSub.__sw_meta.recordingId).toBe(recorder.currentRecordingId);
    expect(fakeSub.__sw_meta.observableKind).toBe('IntervalObservable');
    expect(fakeSub.__sw_meta.closed).toBe(false);
  });

  it('flips closed=true when onUnsubscribe is called', () => {
    recorder.start();
    const fakeSub: any = {};
    recorder.onSubscribe(fakeSub, { constructor: { name: 'Observable' } }, 'Error');
    recorder.onUnsubscribe(fakeSub);
    expect(fakeSub.__sw_meta.closed).toBe(true);
  });

  it('stop() returns a report with all tagged subscriptions', () => {
    recorder.start();
    const fakeSub: any = {};
    recorder.onSubscribe(fakeSub, { constructor: { name: 'Observable' } }, 'Error');
    const report = recorder.stop();
    expect(report.subscriptions).toHaveLength(1);
    expect(report.subscriptions[0]!.id).toBe(fakeSub.__sw_meta.id);
  });

  it('does not tag when not recording', () => {
    const fakeSub: any = {};
    recorder.onSubscribe(fakeSub, { constructor: { name: 'Observable' } }, 'Error');
    expect(fakeSub.__sw_meta).toBeUndefined();
  });

  it('recordNavigation pushes a navigation and updates currentRoute', () => {
    window.history.replaceState({}, '', '/products');
    recorder.start();
    recorder.recordNavigation({ from: '/products', to: '/about' });
    const report = recorder.stop();
    expect(report.meta.navigations).toHaveLength(1);
    expect(report.meta.navigations[0]!.toRoute).toBe('/about');
  });

  it('drainDelta returns accumulated changes then clears them', () => {
    window.history.replaceState({}, '', '/a');
    recorder.start();
    const sub: any = {};
    recorder.onSubscribe(sub, { constructor: { name: 'Interval' } }, 'Error');
    recorder.recordNavigation({ from: '/a', to: '/b' });

    const d1 = recorder.drainDelta();
    expect(d1.added).toHaveLength(1);
    expect(d1.navigations).toHaveLength(1);
    expect(d1.currentRoute).toBe('/b');
    expect(d1.seq).toBe(1);

    const d2 = recorder.drainDelta(); // nothing new — heartbeat
    expect(d2.added).toHaveLength(0);
    expect(d2.navigations).toHaveLength(0);
    expect(d2.closedIds).toHaveLength(0);
    expect(d2.seq).toBe(2);
  });

  it('drainDelta reports unsubscribes via closedIds', () => {
    recorder.start();
    const sub: any = {};
    recorder.onSubscribe(sub, { constructor: { name: 'Observable' } }, 'Error');
    recorder.drainDelta(); // flush the add
    recorder.onUnsubscribe(sub);
    const d = recorder.drainDelta();
    expect(d.closedIds).toEqual([sub.__sw_meta.id]);
  });

  it('liveCandidateCount counts open subs on left routes with a user frame', () => {
    window.history.replaceState({}, '', '/a');
    recorder.start();
    const userStack = 'Error\n    at Foo (http://localhost/src/foo.ts:1:1)';
    const leaking: any = {};
    recorder.onSubscribe(leaking, { constructor: { name: 'Interval' } }, userStack);
    recorder.recordNavigation({ from: '/a', to: '/b' }); // /a is now "left"
    expect(recorder.liveCandidateCount()).toBe(1);

    recorder.onUnsubscribe(leaking); // cleaned up → no longer a candidate
    expect(recorder.liveCandidateCount()).toBe(0);
  });

  it('liveCandidateCount ignores framework-only stacks', () => {
    window.history.replaceState({}, '', '/a');
    recorder.start();
    const fwStack = 'Error\n    at x (http://localhost/zone.js:1:1)';
    const sub: any = {};
    recorder.onSubscribe(sub, { constructor: { name: 'Observable' } }, fwStack);
    recorder.recordNavigation({ from: '/a', to: '/b' });
    expect(recorder.liveCandidateCount()).toBe(0);
  });

  it('exposes initialRoute and startedAtMs after start', () => {
    window.history.replaceState({}, '', '/start-here');
    recorder.start();
    expect(recorder.initialRoute).toBe('/start-here');
    expect(typeof recorder.startedAtMs).toBe('number');
  });
});
