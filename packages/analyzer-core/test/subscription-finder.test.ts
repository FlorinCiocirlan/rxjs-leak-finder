import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHeapSnapshot } from '../src/heap-parser.js';
import { findSubscriptions } from '../src/subscription-finder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures/tiny-snapshot.json');

describe('findSubscriptions', () => {
  it('finds nodes named Subscription with __sw_meta edge', async () => {
    const graph = parseHeapSnapshot(await readFile(FIXTURE, 'utf8'));
    const found = findSubscriptions(graph);
    expect(found).toHaveLength(1);
    expect(found[0]!.nodeIndex).toBe(1);
    expect(found[0]!.metaNodeIndex).toBe(2);
  });

  it('returns empty array when no subscriptions in graph', async () => {
    const minimal = JSON.stringify({
      snapshot: {
        meta: {
          node_fields: ['type', 'name', 'id', 'self_size', 'edge_count', 'trace_node_id', 'detachedness'],
          node_types: [['hidden', 'object'], 'string', 'number', 'number', 'number', 'number', 'number'],
          edge_fields: ['type', 'name_or_index', 'to_node'],
          edge_types: [['property'], 'string_or_number', 'node'],
        },
        node_count: 1,
        edge_count: 0,
        trace_function_count: 0,
      },
      nodes: [1, 1, 1, 0, 0, 0, 0],
      edges: [],
      trace_function_infos: [],
      trace_tree: [],
      samples: [],
      locations: [],
      strings: ['', 'PlainObject'],
    });
    const graph = parseHeapSnapshot(minimal);
    expect(findSubscriptions(graph)).toEqual([]);
  });
});
