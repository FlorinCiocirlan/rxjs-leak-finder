import { describe, it, expectTypeOf } from 'vitest';
import type {
  LeakReport,
  LeakEntry,
  LongLivedEntry,
  RecordingMeta,
  SubscriptionTag,
  ResolvedStackFrame,
  RetainerNode,
} from '../src/types.js';

describe('shared types', () => {
  it('LeakReport has expected fields', () => {
    expectTypeOf<LeakReport>().toHaveProperty('leaks');
    expectTypeOf<LeakReport>().toHaveProperty('ignoredFrameworkSubscriptions');
    expectTypeOf<LeakReport>().toHaveProperty('longLivedServiceSubscriptions');
    expectTypeOf<LeakReport>().toHaveProperty('totalSubscriptionsScanned');
  });

  it('SubscriptionTag matches injected shape', () => {
    expectTypeOf<SubscriptionTag>().toHaveProperty('id');
    expectTypeOf<SubscriptionTag>().toHaveProperty('createdAtMs');
    expectTypeOf<SubscriptionTag>().toHaveProperty('route');
    expectTypeOf<SubscriptionTag>().toHaveProperty('stackRaw');
    expectTypeOf<SubscriptionTag>().toHaveProperty('observableKind');
    expectTypeOf<SubscriptionTag>().toHaveProperty('recordingId');
    expectTypeOf<SubscriptionTag>().toHaveProperty('closed');
  });
});
