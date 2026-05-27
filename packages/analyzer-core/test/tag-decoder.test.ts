import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHeapSnapshot } from '../src/heap-parser.js';
import { decodeTag } from '../src/tag-decoder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures/tagged-subscription-snapshot.json');

describe('decodeTag', () => {
  it('extracts all SubscriptionTag fields from a __sw_meta object node', async () => {
    const graph = parseHeapSnapshot(await readFile(FIXTURE, 'utf8'));
    const tag = decodeTag(graph, 2);
    expect(tag).not.toBeNull();
    expect(tag!.id).toBe('sub-abc123');
    expect(tag!.createdAtMs).toBe(1234567890);
    expect(tag!.route).toBe('/products');
    expect(tag!.stackRaw).toBe('Error: stack');
    expect(tag!.observableKind).toBe('interval');
    expect(tag!.recordingId).toBe('rec-xyz789');
    expect(tag!.closed).toBe(false);
  });

  it('returns null when required fields missing', () => {
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
      strings: ['', 'Object'],
    });
    const graph = parseHeapSnapshot(minimal);
    expect(decodeTag(graph, 0)).toBeNull();
  });
});
