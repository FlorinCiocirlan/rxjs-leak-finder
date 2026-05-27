import type { HeapGraph } from './heap-parser.js';

export type SubscriptionRef = {
  nodeIndex: number;
  constructorName: string;
  metaNodeIndex: number | null;
};

const SUBSCRIPTION_NAMES = new Set(['Subscription', 'Subscriber', 'SafeSubscriber']);

export function findSubscriptions(graph: HeapGraph): SubscriptionRef[] {
  const out: SubscriptionRef[] = [];
  for (let i = 0; i < graph.nodeCount; i++) {
    const name = graph.getNodeName(i);
    if (!SUBSCRIPTION_NAMES.has(name)) continue;
    let metaIdx: number | null = null;
    for (const edge of graph.outEdges(i)) {
      if (edge.name === '__sw_meta') {
        metaIdx = edge.toIndex;
        break;
      }
    }
    out.push({ nodeIndex: i, constructorName: name, metaNodeIndex: metaIdx });
  }
  return out;
}
