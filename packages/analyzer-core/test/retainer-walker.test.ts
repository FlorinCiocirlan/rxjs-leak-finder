import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHeapSnapshot } from '../src/heap-parser.js';
import { walkDisplayChain, walkClassification } from '../src/retainer-walker.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures/retainer-chain-snapshot.json');

describe('walkDisplayChain', () => {
  it('walks back to the first interesting holder', async () => {
    const graph = parseHeapSnapshot(await readFile(FIXTURE, 'utf8'));
    const chain = walkDisplayChain(graph, 4); // Subscription is node index 4
    // Should stop at first Component/Service/Window
    expect(chain.length).toBeGreaterThan(0);
    expect(chain[0]!.constructorName).toBe('Subject');
    expect(chain.at(-1)!.constructorName).toBe('ProductListComponent');
  });
});

describe('walkClassification', () => {
  it('reports whether retainer chain reaches Window via a Component', async () => {
    const graph = parseHeapSnapshot(await readFile(FIXTURE, 'utf8'));
    const result = walkClassification(graph, 4);
    expect(result.reachesApplicationRef).toBe(false);
    expect(result.passesThroughComponent).toBe(true);
    expect(result.reachesWindow).toBe(true);
  });

  it('reports ApplicationRef rooting for service-style chain', () => {
    const minimal = JSON.stringify({
      snapshot: {
        meta: {
          node_fields: ['type', 'name', 'id', 'self_size', 'edge_count', 'trace_node_id', 'detachedness'],
          node_types: [['hidden', 'object'], 'string', 'number', 'number', 'number', 'number', 'number'],
          edge_fields: ['type', 'name_or_index', 'to_node'],
          edge_types: [['property'], 'string_or_number', 'node'],
        },
        node_count: 3,
        edge_count: 2,
        trace_function_count: 0,
      },
      nodes: [
        1, 1, 1, 0, 1, 0, 0,
        1, 2, 2, 0, 1, 0, 0,
        1, 3, 3, 0, 0, 0, 0,
      ],
      edges: [0, 4, 7, 0, 5, 14],
      trace_function_infos: [],
      trace_tree: [],
      samples: [],
      locations: [],
      strings: ['', 'ApplicationRef', 'AnalyticsService', 'Subscription', 'service', '_sub'],
    });
    const graph = parseHeapSnapshot(minimal);
    const result = walkClassification(graph, 2);
    expect(result.reachesApplicationRef).toBe(true);
    expect(result.passesThroughComponent).toBe(false);
  });
});
