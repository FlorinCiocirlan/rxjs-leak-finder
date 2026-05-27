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
});
