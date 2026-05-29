import { describe, it, expect } from 'vitest';
import { createLiveBuffer, applyDelta, liveCandidateTags } from '../../src/dashboard/live-buffer.js';
import type { SubscriptionTag } from '../../src/runtime/types.js';

function tag(id: string, route: string, closed = false): SubscriptionTag {
  return { id, createdAtMs: 0, route, stackRaw: 'Error\n at f (http://localhost/src/x.ts:1:1)', observableKind: 'interval', recordingId: 'rec-1', closed };
}

describe('live-buffer', () => {
  it('applies added subs and navigations', () => {
    const buf = createLiveBuffer('/a');
    applyDelta(buf, { recordingId: 'rec-1', seq: 1, navigations: [{ fromRoute: '/a', toRoute: '/b', atMs: 1 }], added: [tag('s1', '/a')], closedIds: [], currentRoute: '/b' });
    expect(buf.subscriptions.size).toBe(1);
    expect(buf.currentRoute).toBe('/b');
  });

  it('marks closed subs from closedIds', () => {
    const buf = createLiveBuffer('/a');
    applyDelta(buf, { recordingId: 'rec-1', seq: 1, navigations: [], added: [tag('s1', '/a')], closedIds: [], currentRoute: '/a' });
    applyDelta(buf, { recordingId: 'rec-1', seq: 2, navigations: [], added: [], closedIds: ['s1'], currentRoute: '/a' });
    expect(buf.subscriptions.get('s1')!.closed).toBe(true);
  });

  it('liveCandidateTags = open subs whose route was left', () => {
    const buf = createLiveBuffer('/a');
    applyDelta(buf, {
      recordingId: 'rec-1', seq: 1,
      navigations: [{ fromRoute: '/a', toRoute: '/b', atMs: 1 }],
      added: [tag('s1', '/a'), tag('s2', '/b')], closedIds: [], currentRoute: '/b',
    });
    const candidates = liveCandidateTags(buf);
    expect(candidates.map(t => t.id)).toEqual(['s1']);
  });
});
