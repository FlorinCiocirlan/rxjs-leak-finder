import { describe, it, expect } from 'vitest';
import { classify } from '../src/classifier.js';
import type { SubscriptionTag, ResolvedStackFrame, RecordingMeta } from '../src/types.js';

const recording: RecordingMeta = {
  recordingId: 'rec-1',
  initialRoute: '/products',
  startedAtMs: 0,
  stoppedAtMs: 1000,
  navigations: [{ fromRoute: '/products', toRoute: '/about', atMs: 500 }],
};

function tag(over: Partial<SubscriptionTag>): SubscriptionTag {
  return {
    id: 'x', createdAtMs: 0, route: '/products', stackRaw: '',
    observableKind: 'interval', recordingId: 'rec-1', closed: false,
    ...over,
  };
}

function userFrame(): ResolvedStackFrame {
  return { rawFrame: '', file: 'src/app/x.ts', line: 1, column: 1, isFramework: false, functionName: 'ngOnInit' };
}

function fwFrame(): ResolvedStackFrame {
  return { rawFrame: '', file: 'node_modules/@angular/core/x.mjs', line: 1, column: 1, isFramework: true, functionName: 's' };
}

describe('classify', () => {
  it('classifies an open subscription from initial route with user frames as leak', () => {
    const result = classify({
      tag: tag({}),
      frames: [userFrame()],
      classification: { reachesApplicationRef: false, reachesWindow: true, passesThroughComponent: true },
      recording,
    });
    expect(result).toBe('leak');
  });

  it('skips subscriptions from a different route', () => {
    const result = classify({
      tag: tag({ route: '/about' }),
      frames: [userFrame()],
      classification: { reachesApplicationRef: false, reachesWindow: true, passesThroughComponent: true },
      recording,
    });
    expect(result).toBe('skip-different-route');
  });

  it('counts framework-only stacks as ignored', () => {
    const result = classify({
      tag: tag({}),
      frames: [fwFrame(), fwFrame()],
      classification: { reachesApplicationRef: false, reachesWindow: true, passesThroughComponent: false },
      recording,
    });
    expect(result).toBe('framework-noise');
  });

  it('classifies ApplicationRef-rooted subs without component as long-lived', () => {
    const result = classify({
      tag: tag({}),
      frames: [userFrame()],
      classification: { reachesApplicationRef: true, reachesWindow: true, passesThroughComponent: false },
      recording,
    });
    expect(result).toBe('long-lived');
  });

  it('classifies ApplicationRef-rooted sub that passes through a component as a leak', () => {
    const result = classify({
      tag: tag({}),
      frames: [userFrame()],
      classification: { reachesApplicationRef: true, reachesWindow: true, passesThroughComponent: true },
      recording,
    });
    expect(result).toBe('leak');
  });

  it('skips closed subscriptions even if otherwise leak-shaped', () => {
    const result = classify({
      tag: tag({ closed: true }),
      frames: [userFrame()],
      classification: { reachesApplicationRef: false, reachesWindow: true, passesThroughComponent: true },
      recording,
    });
    expect(result).toBe('skip-closed');
  });

  it('skips subscriptions from a different recording', () => {
    const result = classify({
      tag: tag({ recordingId: 'rec-2' }),
      frames: [userFrame()],
      classification: { reachesApplicationRef: false, reachesWindow: true, passesThroughComponent: true },
      recording,
    });
    expect(result).toBe('skip-different-recording');
  });
});
