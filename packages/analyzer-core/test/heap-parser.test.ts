import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseHeapSnapshot } from '../src/heap-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures/tiny-snapshot.json');

describe('parseHeapSnapshot', () => {
  it('parses node and edge counts', async () => {
    const raw = await readFile(FIXTURE, 'utf8');
    const graph = parseHeapSnapshot(raw);
    expect(graph.nodeCount).toBe(3);
    expect(graph.edgeCount).toBe(2);
  });

  it('exposes node name and constructor', async () => {
    const raw = await readFile(FIXTURE, 'utf8');
    const graph = parseHeapSnapshot(raw);
    expect(graph.getNodeName(0)).toBe('Window');
    expect(graph.getNodeName(1)).toBe('Subscription');
    expect(graph.getNodeName(2)).toBe('Object');
  });

  it('iterates outgoing edges of a node with name + target', async () => {
    const raw = await readFile(FIXTURE, 'utf8');
    const graph = parseHeapSnapshot(raw);
    const edges = [...graph.outEdges(0)];
    expect(edges).toHaveLength(1);
    expect(edges[0]!.name).toBe('child');
    expect(edges[0]!.toIndex).toBe(1);
    const subEdges = [...graph.outEdges(1)];
    expect(subEdges).toHaveLength(1);
    expect(subEdges[0]!.name).toBe('__sw_meta');
    expect(subEdges[0]!.toIndex).toBe(2);
  });

  it('iterates retainers (incoming edges) of a node', async () => {
    const raw = await readFile(FIXTURE, 'utf8');
    const graph = parseHeapSnapshot(raw);
    const retainers = [...graph.retainersOf(2)];
    expect(retainers).toHaveLength(1);
    expect(retainers[0]!.fromIndex).toBe(1);
    expect(retainers[0]!.name).toBe('__sw_meta');
  });
});
