import type { HeapGraph } from './heap-parser.js';
import type { SubscriptionTag } from './types.js';

const REQUIRED_FIELDS = [
  'id',
  'createdAtMs',
  'route',
  'stackRaw',
  'observableKind',
  'recordingId',
  'closed',
] as const;

export function decodeTag(graph: HeapGraph, metaNodeIndex: number): SubscriptionTag | null {
  const fields: Record<string, string> = {};
  for (const edge of graph.outEdges(metaNodeIndex)) {
    if (edge.type !== 'property') continue;
    const value = graph.getNodeName(edge.toIndex);
    fields[edge.name] = value;
  }
  for (const required of REQUIRED_FIELDS) {
    if (!(required in fields)) return null;
  }
  return {
    id: fields.id!,
    createdAtMs: Number(fields.createdAtMs),
    route: fields.route!,
    stackRaw: fields.stackRaw!,
    observableKind: fields.observableKind!,
    recordingId: fields.recordingId!,
    closed: fields.closed === 'true',
  };
}
