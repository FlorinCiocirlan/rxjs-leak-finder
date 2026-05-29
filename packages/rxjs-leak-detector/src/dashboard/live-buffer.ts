import type { SubscriptionTag, NavigationEvent } from '../runtime/types.js';
import type { SessionDelta } from '../shared/live-protocol.js';

export type LiveBuffer = {
  subscriptions: Map<string, SubscriptionTag>;
  navigations: NavigationEvent[];
  currentRoute: string;
};

export function createLiveBuffer(initialRoute: string): LiveBuffer {
  return { subscriptions: new Map(), navigations: [], currentRoute: initialRoute };
}

export function applyDelta(buf: LiveBuffer, delta: SessionDelta): void {
  for (const t of delta.added) buf.subscriptions.set(t.id, t);
  for (const id of delta.closedIds) {
    const existing = buf.subscriptions.get(id);
    if (existing) buf.subscriptions.set(id, { ...existing, closed: true });
  }
  buf.navigations.push(...delta.navigations);
  buf.currentRoute = delta.currentRoute;
}

/** Open subscriptions whose creation route has been navigated away from. */
export function liveCandidateTags(buf: LiveBuffer): SubscriptionTag[] {
  const left = new Set<string>();
  for (const nav of buf.navigations) left.add(nav.fromRoute);
  const out: SubscriptionTag[] = [];
  for (const tag of buf.subscriptions.values()) {
    if (tag.closed) continue;
    if (!left.has(tag.route)) continue;
    out.push(tag);
  }
  return out;
}
