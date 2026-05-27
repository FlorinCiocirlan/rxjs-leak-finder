export type EdgeRef = {
  edgeIndex: number;
  fromIndex: number;
  toIndex: number;
  type: string;
  name: string;
};

export class HeapGraph {
  readonly nodeCount: number;
  readonly edgeCount: number;
  private readonly nodes: number[];
  private readonly edges: number[];
  private readonly strings: string[];
  private readonly nodeFieldCount: number;
  private readonly edgeFieldCount: number;
  private readonly nameOffset: number;
  private readonly edgeCountOffset: number;
  private readonly edgeTypeOffset: number;
  private readonly edgeNameOffset: number;
  private readonly edgeToNodeOffset: number;
  private readonly nodeEdgeOffsets: number[]; // node index -> first edge index in edges array
  private readonly nodeTypeNames: string[];
  private readonly edgeTypeNames: string[];
  private readonly retainerIndex: number[][]; // node index -> retainer edge indices

  constructor(raw: {
    snapshot: {
      meta: {
        node_fields: string[];
        node_types: unknown[];
        edge_fields: string[];
        edge_types: unknown[];
      };
      node_count: number;
      edge_count: number;
    };
    nodes: number[];
    edges: number[];
    strings: string[];
  }) {
    const meta = raw.snapshot.meta;
    this.nodes = raw.nodes;
    this.edges = raw.edges;
    this.strings = raw.strings;
    this.nodeCount = raw.snapshot.node_count;
    this.edgeCount = raw.snapshot.edge_count;
    this.nodeFieldCount = meta.node_fields.length;
    this.edgeFieldCount = meta.edge_fields.length;
    this.nameOffset = meta.node_fields.indexOf('name');
    this.edgeCountOffset = meta.node_fields.indexOf('edge_count');
    this.edgeTypeOffset = meta.edge_fields.indexOf('type');
    this.edgeNameOffset = meta.edge_fields.indexOf('name_or_index');
    this.edgeToNodeOffset = meta.edge_fields.indexOf('to_node');
    this.nodeTypeNames = (meta.node_types[0] as string[]) ?? [];
    this.edgeTypeNames = (meta.edge_types[0] as string[]) ?? [];

    this.nodeEdgeOffsets = new Array(this.nodeCount + 1);
    let edgeOffset = 0;
    for (let i = 0; i < this.nodeCount; i++) {
      this.nodeEdgeOffsets[i] = edgeOffset;
      const ec = this.nodes[i * this.nodeFieldCount + this.edgeCountOffset]!;
      edgeOffset += ec * this.edgeFieldCount;
    }
    this.nodeEdgeOffsets[this.nodeCount] = edgeOffset;

    this.retainerIndex = Array.from({ length: this.nodeCount }, () => [] as number[]);
    for (let from = 0; from < this.nodeCount; from++) {
      const start = this.nodeEdgeOffsets[from]!;
      const end = this.nodeEdgeOffsets[from + 1]!;
      for (let e = start; e < end; e += this.edgeFieldCount) {
        const toByte = this.edges[e + this.edgeToNodeOffset]!;
        const toNodeIdx = toByte / this.nodeFieldCount;
        this.retainerIndex[toNodeIdx]!.push(e);
      }
    }
  }

  getNodeName(nodeIndex: number): string {
    const strIdx = this.nodes[nodeIndex * this.nodeFieldCount + this.nameOffset]!;
    return this.strings[strIdx] ?? '';
  }

  *outEdges(nodeIndex: number): IterableIterator<EdgeRef> {
    const start = this.nodeEdgeOffsets[nodeIndex]!;
    const end = this.nodeEdgeOffsets[nodeIndex + 1]!;
    for (let e = start; e < end; e += this.edgeFieldCount) {
      yield this.readEdgeAt(e, nodeIndex);
    }
  }

  *retainersOf(nodeIndex: number): IterableIterator<EdgeRef> {
    const list = this.retainerIndex[nodeIndex]!;
    for (const edgeIdx of list) {
      const fromIdx = this.findFromIndex(edgeIdx);
      yield this.readEdgeAt(edgeIdx, fromIdx);
    }
  }

  private readEdgeAt(edgeIdx: number, fromIndex: number): EdgeRef {
    const type = this.edgeTypeNames[this.edges[edgeIdx + this.edgeTypeOffset]!] ?? 'unknown';
    const nameOrIdx = this.edges[edgeIdx + this.edgeNameOffset]!;
    const toIdx = this.edges[edgeIdx + this.edgeToNodeOffset]! / this.nodeFieldCount;
    const isNamed = type === 'property' || type === 'internal' || type === 'shortcut';
    const name = isNamed ? (this.strings[nameOrIdx] ?? '') : String(nameOrIdx);
    return { edgeIndex: edgeIdx, fromIndex, toIndex: toIdx, type, name };
  }

  private findFromIndex(edgeIdx: number): number {
    // binary search nodeEdgeOffsets for the slot containing edgeIdx
    let lo = 0;
    let hi = this.nodeCount;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.nodeEdgeOffsets[mid + 1]! <= edgeIdx) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

export function parseHeapSnapshot(raw: string): HeapGraph {
  const parsed = JSON.parse(raw);
  return new HeapGraph(parsed);
}
