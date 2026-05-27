import type { HeapGraph } from './heap-parser.js';
import type { RetainerNode } from './types.js';

const DISPLAY_DEPTH = 8;
const CLASSIFY_DEPTH = 16;

const INTERESTING_HOLDER_SUFFIXES = ['Component', 'Directive', 'Service', 'Pipe'];

function isInteresting(name: string): boolean {
  if (name === 'Window' || name === 'ApplicationRef') return true;
  return INTERESTING_HOLDER_SUFFIXES.some((s) => name.endsWith(s));
}

function isComponentLike(name: string): boolean {
  return name.endsWith('Component') || name.endsWith('Directive');
}

export function walkDisplayChain(graph: HeapGraph, fromNodeIndex: number): RetainerNode[] {
  const chain: RetainerNode[] = [];
  const visited = new Set<number>([fromNodeIndex]);
  let current = fromNodeIndex;
  for (let depth = 0; depth < DISPLAY_DEPTH; depth++) {
    const retainers = [...graph.retainersOf(current)];
    if (retainers.length === 0) break;
    const parent = retainers[0]!.fromIndex;
    if (visited.has(parent)) break;
    visited.add(parent);
    const name = graph.getNodeName(parent);
    chain.push({ nodeId: parent, constructorName: name, displayName: name });
    if (isInteresting(name)) break;
    current = parent;
  }
  return chain;
}

export type ClassificationResult = {
  reachesApplicationRef: boolean;
  reachesWindow: boolean;
  passesThroughComponent: boolean;
};

export function walkClassification(graph: HeapGraph, fromNodeIndex: number): ClassificationResult {
  const result: ClassificationResult = {
    reachesApplicationRef: false,
    reachesWindow: false,
    passesThroughComponent: false,
  };
  const visited = new Set<number>([fromNodeIndex]);
  let frontier: number[] = [fromNodeIndex];
  for (let depth = 0; depth < CLASSIFY_DEPTH; depth++) {
    const next: number[] = [];
    for (const idx of frontier) {
      for (const edge of graph.retainersOf(idx)) {
        if (visited.has(edge.fromIndex)) continue;
        visited.add(edge.fromIndex);
        const name = graph.getNodeName(edge.fromIndex);
        if (name === 'ApplicationRef') result.reachesApplicationRef = true;
        if (name === 'Window') result.reachesWindow = true;
        if (isComponentLike(name)) result.passesThroughComponent = true;
        next.push(edge.fromIndex);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return result;
}
