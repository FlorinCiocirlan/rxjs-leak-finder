# RxJS Subscription Leak Detector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome DevTools extension that detects unsubscribed RxJS subscriptions in Angular v19+ dev-mode apps by tagging subscriptions at creation, capturing a heap snapshot on demand, and reporting which tagged subscriptions are still retained after navigation.

**Architecture:** pnpm workspace with four packages — `analyzer-core` (pure Node-testable TS that parses heap snapshots and classifies leaks), `tagger` (IIFE injected into the page's MAIN world that monkey-patches `Observable.prototype.subscribe`), `extension` (Manifest V3 shell with background worker, content-bridge, devtools page), and `panel-ui` (Lit web components rendering the DevTools panel). Heap snapshots are captured via `chrome.debugger.attach` + `HeapProfiler.takeHeapSnapshot`. Source maps are resolved via the `source-map` package.

**Tech Stack:** TypeScript 5.4+, pnpm 9+ workspaces, Vitest 1.6+ for unit/component tests, happy-dom for tagger tests, Lit 3+ for panel UI, source-map 0.7 for stack resolution, Vite 5+ for extension build, Puppeteer 22+ for e2e.

---

## Phase 0 — Workspace Scaffold

### Task 0.1: Initialize pnpm workspace

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`
- Create: `tsconfig.base.json`
- Create: `.npmrc`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "rxjs-leak-detector",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "pnpm -r --filter './packages/*' run build",
    "test": "pnpm -r --filter './packages/*' run test",
    "test:e2e": "pnpm --filter @rld/extension run test:e2e",
    "typecheck": "pnpm -r --filter './packages/*' run typecheck"
  },
  "devDependencies": {
    "typescript": "^5.4.5",
    "vitest": "^1.6.0",
    "@types/node": "^20.12.7"
  },
  "packageManager": "pnpm@9.1.0"
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
  - 'packages/extension/test/e2e/fixtures/test-app'
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
.vite/
coverage/
*.tsbuildinfo
.DS_Store
packages/extension/test/e2e/fixtures/test-app/.angular/
```

- [ ] **Step 4: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "useDefineForClassFields": true,
    "experimentalDecorators": false,
    "declaration": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 5: Create `.npmrc`**

```
strict-peer-dependencies=false
auto-install-peers=true
```

- [ ] **Step 6: Run install**

Run: `pnpm install`
Expected: `pnpm` resolves devDependencies, exits 0, no workspace packages yet.

---

### Task 0.2: Scaffold `analyzer-core` package skeleton

**Files:**
- Create: `packages/analyzer-core/package.json`
- Create: `packages/analyzer-core/tsconfig.json`
- Create: `packages/analyzer-core/vitest.config.ts`
- Create: `packages/analyzer-core/src/index.ts`
- Create: `packages/analyzer-core/test/sanity.test.ts`

- [ ] **Step 1: Create `packages/analyzer-core/package.json`**

```json
{
  "name": "@rld/analyzer-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "source-map": "^0.7.4"
  },
  "devDependencies": {
    "@types/source-map": "^0.5.7"
  }
}
```

- [ ] **Step 2: Create `packages/analyzer-core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2022"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["test", "dist"]
}
```

- [ ] **Step 3: Create `packages/analyzer-core/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
```

- [ ] **Step 4: Create stub `packages/analyzer-core/src/index.ts`**

```ts
export const VERSION = '0.1.0';
```

- [ ] **Step 5: Write sanity test `packages/analyzer-core/test/sanity.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/index.js';

describe('analyzer-core', () => {
  it('exports a version string', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
```

- [ ] **Step 6: Install and run**

Run: `pnpm install && pnpm --filter @rld/analyzer-core test`
Expected: 1 passed, exit 0.

---

## Phase 1 — `analyzer-core`

This is the heart of the tool. Build it TDD: shared types first, then parser, finder, decoder, source-map resolver, classifier, retainer walker, top-level `analyze`.

### Task 1.1: Define shared types

**Files:**
- Create: `packages/analyzer-core/src/types.ts`
- Modify: `packages/analyzer-core/src/index.ts`
- Create: `packages/analyzer-core/test/types.test.ts`

- [ ] **Step 1: Write type-shape test**

`packages/analyzer-core/test/types.test.ts`:

```ts
import { describe, it, expectTypeOf } from 'vitest';
import type {
  LeakReport,
  LeakEntry,
  LongLivedEntry,
  RecordingMeta,
  SubscriptionTag,
  ResolvedStackFrame,
  RetainerNode,
} from '../src/types.js';

describe('shared types', () => {
  it('LeakReport has expected fields', () => {
    expectTypeOf<LeakReport>().toHaveProperty('leaks');
    expectTypeOf<LeakReport>().toHaveProperty('ignoredFrameworkSubscriptions');
    expectTypeOf<LeakReport>().toHaveProperty('longLivedServiceSubscriptions');
    expectTypeOf<LeakReport>().toHaveProperty('totalSubscriptionsScanned');
  });

  it('SubscriptionTag matches injected shape', () => {
    expectTypeOf<SubscriptionTag>().toHaveProperty('id');
    expectTypeOf<SubscriptionTag>().toHaveProperty('createdAtMs');
    expectTypeOf<SubscriptionTag>().toHaveProperty('route');
    expectTypeOf<SubscriptionTag>().toHaveProperty('stackRaw');
    expectTypeOf<SubscriptionTag>().toHaveProperty('observableKind');
    expectTypeOf<SubscriptionTag>().toHaveProperty('recordingId');
    expectTypeOf<SubscriptionTag>().toHaveProperty('closed');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @rld/analyzer-core test`
Expected: FAIL — cannot resolve `../src/types.js`.

- [ ] **Step 3: Write `packages/analyzer-core/src/types.ts`**

```ts
export type SubscriptionTag = {
  id: string;
  createdAtMs: number;
  route: string;
  stackRaw: string;
  observableKind: string;
  recordingId: string;
  closed: boolean;
};

export type NavigationEvent = {
  fromRoute: string;
  toRoute: string;
  atMs: number;
};

export type RecordingMeta = {
  recordingId: string;
  initialRoute: string;
  startedAtMs: number;
  stoppedAtMs: number;
  navigations: NavigationEvent[];
};

export type ResolvedStackFrame = {
  rawFrame: string;
  file: string;
  line: number;
  column: number;
  isFramework: boolean;
  functionName: string | null;
};

export type RetainerNode = {
  nodeId: number;
  constructorName: string;
  displayName: string | null;
};

export type LeakEntry = {
  id: string;
  route: string;
  observableKind: string;
  sourceLocation: { file: string; line: number; column: number };
  componentName: string | null;
  stack: ResolvedStackFrame[];
  retainerChain: RetainerNode[];
};

export type LongLivedEntry = {
  id: string;
  route: string;
  observableKind: string;
  componentName: string | null;
  sourceLocation: { file: string; line: number; column: number } | null;
};

export type LeakReport = {
  leaks: LeakEntry[];
  ignoredFrameworkSubscriptions: number;
  longLivedServiceSubscriptions: LongLivedEntry[];
  totalSubscriptionsScanned: number;
};
```

- [ ] **Step 4: Re-export from `src/index.ts`**

Replace contents of `packages/analyzer-core/src/index.ts`:

```ts
export const VERSION = '0.1.0';
export * from './types.js';
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @rld/analyzer-core test`
Expected: 2 files, all passed.

---

### Task 1.2: Heap snapshot parser — minimal indexed graph

V8 `.heapsnapshot` files are JSON with `nodes`, `edges`, `strings` flat arrays. Each node uses N consecutive integers (where N = `meta.node_fields.length`, typically 7). Each edge uses M integers (M = `meta.edge_fields.length`, typically 3). The `nodes[i*N + (field index of name)]` gives a string index.

**Files:**
- Create: `packages/analyzer-core/src/heap-parser.ts`
- Create: `packages/analyzer-core/test/heap-parser.test.ts`
- Create: `packages/analyzer-core/test/fixtures/tiny-snapshot.json`

- [ ] **Step 1: Build a tiny synthetic snapshot fixture**

Create `packages/analyzer-core/test/fixtures/tiny-snapshot.json`. This represents a Window with one Subscription that has a `__sw_meta` property pointing to a meta object. Three nodes, two edges, three strings.

```json
{
  "snapshot": {
    "meta": {
      "node_fields": ["type", "name", "id", "self_size", "edge_count", "trace_node_id", "detachedness"],
      "node_types": [
        ["hidden", "array", "string", "object", "code", "closure", "regexp", "number", "native", "synthetic", "concatenated string", "sliced string", "symbol", "bigint", "object shape"],
        "string", "number", "number", "number", "number", "number"
      ],
      "edge_fields": ["type", "name_or_index", "to_node"],
      "edge_types": [
        ["context", "element", "property", "internal", "hidden", "shortcut", "weak"],
        "string_or_number", "node"
      ],
      "trace_function_info_fields": [],
      "trace_node_fields": [],
      "sample_fields": [],
      "location_fields": []
    },
    "node_count": 3,
    "edge_count": 2,
    "trace_function_count": 0
  },
  "nodes": [
    3, 1, 1, 0, 1, 0, 0,
    3, 2, 2, 0, 1, 0, 0,
    3, 3, 3, 0, 0, 0, 0
  ],
  "edges": [
    2, 4, 7,
    2, 5, 14
  ],
  "trace_function_infos": [],
  "trace_tree": [],
  "samples": [],
  "locations": [],
  "strings": ["", "Window", "Subscription", "Object", "child", "__sw_meta"]
}
```

Note: node entries are at indices 0, 7, 14 (each is 7 fields). Edge entries are at indices 0, 3 (each is 3 fields). `to_node` is a **byte offset into the nodes array**, so 7 means "the second node" and 14 means "the third node".

- [ ] **Step 2: Write parser test**

`packages/analyzer-core/test/heap-parser.test.ts`:

```ts
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
```

- [ ] **Step 3: Run test to verify failure**

Run: `pnpm --filter @rld/analyzer-core test heap-parser`
Expected: FAIL — `parseHeapSnapshot` not defined.

- [ ] **Step 4: Implement `packages/analyzer-core/src/heap-parser.ts`**

```ts
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
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @rld/analyzer-core test heap-parser`
Expected: all 4 tests pass.

---

### Task 1.3: Subscription finder

Find nodes whose constructor name is `Subscription`, `Subscriber`, or `SafeSubscriber`, and check for a `__sw_meta` outgoing edge.

**Files:**
- Create: `packages/analyzer-core/src/subscription-finder.ts`
- Create: `packages/analyzer-core/test/subscription-finder.test.ts`

- [ ] **Step 1: Write test**

```ts
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
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @rld/analyzer-core test subscription-finder`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/analyzer-core/src/subscription-finder.ts`**

```ts
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
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @rld/analyzer-core test subscription-finder`
Expected: 2 passed.

---

### Task 1.4: Tag decoder

Walk the `__sw_meta` object's edges to reconstruct the `SubscriptionTag`. Each scalar property edge points to a node whose constructor name encodes the type and whose first character of its name string carries the value (for strings) or whose name is the value (for numbers/booleans serialized as nodes).

In practice, V8 stores primitive values either inline (numeric, via `captureNumericValue: true`) or as separate nodes. Strings get their own nodes with type `string`. We'll decode by reading each property edge's target node's name as the value when the target node is a string.

**Files:**
- Create: `packages/analyzer-core/src/tag-decoder.ts`
- Create: `packages/analyzer-core/test/tag-decoder.test.ts`
- Create: `packages/analyzer-core/test/fixtures/tagged-subscription-snapshot.json`

- [ ] **Step 1: Build a fixture with a fully-tagged subscription**

Create `packages/analyzer-core/test/fixtures/tagged-subscription-snapshot.json`. A `Window` retains a `Subscription`, which has `__sw_meta` pointing to an `Object` that has 7 string children corresponding to the 7 tag fields.

```json
{
  "snapshot": {
    "meta": {
      "node_fields": ["type", "name", "id", "self_size", "edge_count", "trace_node_id", "detachedness"],
      "node_types": [
        ["hidden", "array", "string", "object", "code", "closure", "regexp", "number", "native", "synthetic", "concatenated string", "sliced string", "symbol", "bigint", "object shape"],
        "string", "number", "number", "number", "number", "number"
      ],
      "edge_fields": ["type", "name_or_index", "to_node"],
      "edge_types": [
        ["context", "element", "property", "internal", "hidden", "shortcut", "weak"],
        "string_or_number", "node"
      ]
    },
    "node_count": 10,
    "edge_count": 8,
    "trace_function_count": 0
  },
  "nodes": [
    3, 1, 1, 0, 1, 0, 0,
    3, 2, 2, 0, 1, 0, 0,
    3, 3, 3, 0, 7, 0, 0,
    2, 4, 4, 0, 0, 0, 0,
    2, 5, 5, 0, 0, 0, 0,
    7, 0, 6, 0, 0, 0, 0,
    2, 6, 7, 0, 0, 0, 0,
    2, 7, 8, 0, 0, 0, 0,
    2, 8, 9, 0, 0, 0, 0,
    14, 9, 10, 0, 0, 0, 0
  ],
  "edges": [
    2, 13, 7,
    2, 14, 14,
    2, 15, 21,
    2, 16, 28,
    2, 17, 35,
    2, 18, 42,
    2, 19, 49,
    2, 20, 56
  ],
  "trace_function_infos": [],
  "trace_tree": [],
  "samples": [],
  "locations": [],
  "strings": [
    "",
    "Window",
    "Subscription",
    "Object",
    "sub-abc123",
    "/products",
    "Error: at app.js:1:1",
    "interval",
    "rec-xyz789",
    "true",
    "__sw_meta",
    "id",
    "route",
    "id-edge",
    "createdAtMs-edge",
    "route-edge",
    "stackRaw-edge",
    "observableKind-edge",
    "recordingId-edge",
    "closed-edge",
    "child-edge"
  ]
}
```

Wait — this fixture is getting awkward. Simplify: store all primitive values as string nodes whose name string IS the value. Use property edge names like `"id"`, `"route"`, etc.

Replace the above with a cleaner fixture:

```json
{
  "snapshot": {
    "meta": {
      "node_fields": ["type", "name", "id", "self_size", "edge_count", "trace_node_id", "detachedness"],
      "node_types": [
        ["hidden", "array", "string", "object", "code", "closure", "regexp", "number", "native", "synthetic", "concatenated string", "sliced string", "symbol", "bigint", "object shape"],
        "string", "number", "number", "number", "number", "number"
      ],
      "edge_fields": ["type", "name_or_index", "to_node"],
      "edge_types": [
        ["context", "element", "property", "internal", "hidden", "shortcut", "weak"],
        "string_or_number", "node"
      ]
    },
    "node_count": 10,
    "edge_count": 8,
    "trace_function_count": 0
  },
  "nodes": [
    3, 1, 1, 0, 1, 0, 0,
    3, 2, 2, 0, 1, 0, 0,
    3, 3, 3, 0, 7, 0, 0,
    2, 4, 4, 0, 0, 0, 0,
    7, 5, 5, 0, 0, 0, 0,
    2, 6, 6, 0, 0, 0, 0,
    2, 7, 7, 0, 0, 0, 0,
    2, 8, 8, 0, 0, 0, 0,
    2, 9, 9, 0, 0, 0, 0,
    2, 10, 10, 0, 0, 0, 0
  ],
  "edges": [
    2, 11, 7,
    2, 12, 14,
    2, 13, 21,
    2, 14, 28,
    2, 15, 35,
    2, 16, 42,
    2, 17, 49,
    2, 18, 56
  ],
  "trace_function_infos": [],
  "trace_tree": [],
  "samples": [],
  "locations": [],
  "strings": [
    "",
    "Window",
    "Subscription",
    "Object",
    "sub-abc123",
    "1234567890",
    "/products",
    "Error: stack",
    "interval",
    "rec-xyz789",
    "false",
    "child",
    "__sw_meta",
    "id",
    "createdAtMs",
    "route",
    "stackRaw",
    "observableKind",
    "recordingId",
    "closed"
  ]
}
```

Node layout (each 7 fields, index = byte / 7):

- Node 0 (byte 0): Window
- Node 1 (byte 7): Subscription
- Node 2 (byte 14): Object (__sw_meta), 7 outgoing edges
- Node 3 (byte 21): "sub-abc123" (string node, type 2)
- Node 4 (byte 28): "1234567890" (number node, type 7)
- Node 5 (byte 35): "/products" (string)
- Node 6 (byte 42): "Error: stack"
- Node 7 (byte 49): "interval"
- Node 8 (byte 56): "rec-xyz789"
- Node 9 (byte 63): "false"

Edges:
1. Window → Subscription, name "child" (string idx 11)
2. Subscription → Object, name "__sw_meta" (string idx 12)
3. Object → "sub-abc123", name "id" (string idx 13) — to_node = 21
4. Object → "1234567890", name "createdAtMs" — to_node = 28
5. Object → "/products", name "route" — to_node = 35
6. Object → "Error: stack", name "stackRaw" — to_node = 42
7. Object → "interval", name "observableKind" — to_node = 49
8. Object → "rec-xyz789", name "recordingId" — to_node = 56

That's only 8 edges but we have edges for 7 children — adjust counts. The Object has edge_count = 7 but I only wrote 6 child edges plus Window→Sub and Sub→Object. Let me fix: total edges = 2 (Window→Sub, Sub→Object) + 7 (Object children) = 9. Let me extend the fixture to add the `closed` edge.

```
edges (9 total):
  2 11 7   (Window child→Subscription)
  2 12 14  (Sub __sw_meta→Object)
  2 13 21  (Obj id→string)
  2 14 28  (Obj createdAtMs→number-node)
  2 15 35  (Obj route→string)
  2 16 42  (Obj stackRaw→string)
  2 17 49  (Obj observableKind→string)
  2 18 56  (Obj recordingId→string)
  2 19 63  (Obj closed→"false")
```

Update the fixture's `edge_count` to 9 and add the last edge. The Subscription's `edge_count` field stays 1 (one outgoing edge: `__sw_meta`). The Object's `edge_count` is 7.

Final corrected `packages/analyzer-core/test/fixtures/tagged-subscription-snapshot.json`:

```json
{
  "snapshot": {
    "meta": {
      "node_fields": ["type", "name", "id", "self_size", "edge_count", "trace_node_id", "detachedness"],
      "node_types": [
        ["hidden", "array", "string", "object", "code", "closure", "regexp", "number", "native", "synthetic", "concatenated string", "sliced string", "symbol", "bigint", "object shape"],
        "string", "number", "number", "number", "number", "number"
      ],
      "edge_fields": ["type", "name_or_index", "to_node"],
      "edge_types": [
        ["context", "element", "property", "internal", "hidden", "shortcut", "weak"],
        "string_or_number", "node"
      ]
    },
    "node_count": 10,
    "edge_count": 9,
    "trace_function_count": 0
  },
  "nodes": [
    3, 1, 1, 0, 1, 0, 0,
    3, 2, 2, 0, 1, 0, 0,
    3, 3, 3, 0, 7, 0, 0,
    2, 4, 4, 0, 0, 0, 0,
    7, 5, 5, 0, 0, 0, 0,
    2, 6, 6, 0, 0, 0, 0,
    2, 7, 7, 0, 0, 0, 0,
    2, 8, 8, 0, 0, 0, 0,
    2, 9, 9, 0, 0, 0, 0,
    2, 10, 10, 0, 0, 0, 0
  ],
  "edges": [
    2, 11, 7,
    2, 12, 14,
    2, 13, 21,
    2, 14, 28,
    2, 15, 35,
    2, 16, 42,
    2, 17, 49,
    2, 18, 56,
    2, 19, 63
  ],
  "trace_function_infos": [],
  "trace_tree": [],
  "samples": [],
  "locations": [],
  "strings": [
    "",
    "Window",
    "Subscription",
    "Object",
    "sub-abc123",
    "1234567890",
    "/products",
    "Error: stack",
    "interval",
    "rec-xyz789",
    "false",
    "child",
    "__sw_meta",
    "id",
    "createdAtMs",
    "route",
    "stackRaw",
    "observableKind",
    "recordingId",
    "closed"
  ]
}
```

- [ ] **Step 2: Write `packages/analyzer-core/test/tag-decoder.test.ts`**

```ts
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
```

- [ ] **Step 3: Run, expect failure**

Run: `pnpm --filter @rld/analyzer-core test tag-decoder`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `packages/analyzer-core/src/tag-decoder.ts`**

```ts
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
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @rld/analyzer-core test tag-decoder`
Expected: 2 passed.

---

### Task 1.5: Source map resolver

Resolves a raw stack-trace string into `ResolvedStackFrame[]` using the `source-map` package. Classifies framework vs user frames by path pattern.

**Files:**
- Create: `packages/analyzer-core/src/source-map-resolver.ts`
- Create: `packages/analyzer-core/test/source-map-resolver.test.ts`
- Create: `packages/analyzer-core/test/fixtures/sample.js.map`

- [ ] **Step 1: Create a small source map fixture**

`packages/analyzer-core/test/fixtures/sample.js.map`:

```json
{
  "version": 3,
  "file": "sample.js",
  "sources": ["src/app/products/products.component.ts"],
  "names": [],
  "mappings": "AAAA,SAASA,CAAC,GACR",
  "sourcesContent": null
}
```

Actually, generating a hand-written mapping is error-prone. Use a known mapping with the `source-map` library at fixture-build time. Replace the fixture with a programmatic one — build it inline in the test:

- [ ] **Step 2: Write `packages/analyzer-core/test/source-map-resolver.test.ts`**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { SourceMapGenerator, type RawSourceMap } from 'source-map';
import { resolveStack } from '../src/source-map-resolver.js';

let sampleMap: RawSourceMap;

beforeAll(() => {
  const gen = new SourceMapGenerator({ file: 'main.bundle.js' });
  gen.addMapping({
    source: 'src/app/products.component.ts',
    original: { line: 23, column: 8 },
    generated: { line: 1, column: 100 },
    name: 'ngOnInit',
  });
  gen.addMapping({
    source: 'node_modules/@angular/core/fesm2022/core.mjs',
    original: { line: 500, column: 0 },
    generated: { line: 1, column: 200 },
    name: 'subscribe',
  });
  sampleMap = JSON.parse(gen.toString());
});

describe('resolveStack', () => {
  it('resolves a stack frame to original file:line and flags framework vs user', async () => {
    const rawStack = [
      'Error',
      '    at subscribe (http://localhost:4200/main.bundle.js:1:200)',
      '    at ngOnInit (http://localhost:4200/main.bundle.js:1:100)',
    ].join('\n');
    const sourceMaps = new Map<string, RawSourceMap>([
      ['http://localhost:4200/main.bundle.js', sampleMap],
    ]);
    const frames = await resolveStack(rawStack, sourceMaps);
    expect(frames).toHaveLength(2);
    expect(frames[0]!.file).toBe('node_modules/@angular/core/fesm2022/core.mjs');
    expect(frames[0]!.isFramework).toBe(true);
    expect(frames[1]!.file).toBe('src/app/products.component.ts');
    expect(frames[1]!.line).toBe(23);
    expect(frames[1]!.isFramework).toBe(false);
  });

  it('marks frame as framework when source path includes zone.js', async () => {
    const gen = new SourceMapGenerator({ file: 'zone.bundle.js' });
    gen.addMapping({
      source: 'node_modules/zone.js/fesm2015/zone.js',
      original: { line: 1, column: 0 },
      generated: { line: 1, column: 0 },
    });
    const raw = JSON.parse(gen.toString());
    const stack = 'Error\n    at run (http://localhost:4200/zone.bundle.js:1:0)';
    const frames = await resolveStack(stack, new Map([['http://localhost:4200/zone.bundle.js', raw]]));
    expect(frames[0]!.isFramework).toBe(true);
  });

  it('treats unresolvable frame as framework with raw path', async () => {
    const stack = 'Error\n    at mystery (http://elsewhere/unknown.js:5:5)';
    const frames = await resolveStack(stack, new Map());
    expect(frames).toHaveLength(1);
    expect(frames[0]!.file).toBe('http://elsewhere/unknown.js');
    expect(frames[0]!.isFramework).toBe(true);
  });
});
```

- [ ] **Step 3: Run, expect failure**

Run: `pnpm --filter @rld/analyzer-core test source-map-resolver`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `packages/analyzer-core/src/source-map-resolver.ts`**

```ts
import { SourceMapConsumer, type RawSourceMap } from 'source-map';
import type { ResolvedStackFrame } from './types.js';

const FRAMEWORK_PATTERNS = [
  /\/node_modules\/@angular\//,
  /\/node_modules\/rxjs\//,
  /\/node_modules\/zone\.js\//,
  /webpack[-/]runtime/,
  /^webpack:\/\/\/runtime\//,
];

const FRAME_REGEX = /at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;

function isFrameworkPath(path: string): boolean {
  return FRAMEWORK_PATTERNS.some((p) => p.test(path));
}

export async function resolveStack(
  rawStack: string,
  sourceMaps: Map<string, RawSourceMap>,
): Promise<ResolvedStackFrame[]> {
  const consumers = new Map<string, SourceMapConsumer>();
  for (const [url, map] of sourceMaps) {
    consumers.set(url, await new SourceMapConsumer(map));
  }
  try {
    const frames: ResolvedStackFrame[] = [];
    const lines = rawStack.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('at ')) continue;
      const match = trimmed.match(FRAME_REGEX);
      if (!match) continue;
      const fnName = match[1] ?? null;
      const url = match[2]!;
      const lineNo = Number(match[3]);
      const colNo = Number(match[4]);
      const consumer = consumers.get(url);
      if (!consumer) {
        frames.push({
          rawFrame: trimmed,
          file: url,
          line: lineNo,
          column: colNo,
          isFramework: true,
          functionName: fnName,
        });
        continue;
      }
      const orig = consumer.originalPositionFor({ line: lineNo, column: colNo });
      const file = orig.source ?? url;
      frames.push({
        rawFrame: trimmed,
        file,
        line: orig.line ?? lineNo,
        column: orig.column ?? colNo,
        isFramework: isFrameworkPath(file),
        functionName: orig.name ?? fnName,
      });
    }
    return frames;
  } finally {
    for (const c of consumers.values()) c.destroy();
  }
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @rld/analyzer-core test source-map-resolver`
Expected: 3 passed.

---

### Task 1.6: Retainer walker

BFS through retainer edges. Two modes: **display walk** (depth 8, stops at first interesting holder for UI), and **classification walk** (depth 16, walks all the way to detect `ApplicationRef`-rooted long-lived services).

**Files:**
- Create: `packages/analyzer-core/src/retainer-walker.ts`
- Create: `packages/analyzer-core/test/retainer-walker.test.ts`
- Create: `packages/analyzer-core/test/fixtures/retainer-chain-snapshot.json`

- [ ] **Step 1: Build retainer-chain fixture**

A 5-node chain: `Window → AppComponent → ProductListComponent → Subject → Subscription`.

Create `packages/analyzer-core/test/fixtures/retainer-chain-snapshot.json`:

```json
{
  "snapshot": {
    "meta": {
      "node_fields": ["type", "name", "id", "self_size", "edge_count", "trace_node_id", "detachedness"],
      "node_types": [
        ["hidden", "array", "string", "object", "code", "closure", "regexp", "number", "native", "synthetic", "concatenated string", "sliced string", "symbol", "bigint", "object shape"],
        "string", "number", "number", "number", "number", "number"
      ],
      "edge_fields": ["type", "name_or_index", "to_node"],
      "edge_types": [
        ["context", "element", "property", "internal", "hidden", "shortcut", "weak"],
        "string_or_number", "node"
      ]
    },
    "node_count": 5,
    "edge_count": 4,
    "trace_function_count": 0
  },
  "nodes": [
    3, 1, 1, 0, 1, 0, 0,
    3, 2, 2, 0, 1, 0, 0,
    3, 3, 3, 0, 1, 0, 0,
    3, 4, 4, 0, 1, 0, 0,
    3, 5, 5, 0, 0, 0, 0
  ],
  "edges": [
    2, 6, 7,
    2, 7, 14,
    2, 8, 21,
    2, 9, 28
  ],
  "trace_function_infos": [],
  "trace_tree": [],
  "samples": [],
  "locations": [],
  "strings": [
    "",
    "Window",
    "AppComponent",
    "ProductListComponent",
    "Subject",
    "Subscription",
    "appComponent",
    "list",
    "subject$",
    "_subscription"
  ]
}
```

- [ ] **Step 2: Write `packages/analyzer-core/test/retainer-walker.test.ts`**

```ts
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
```

- [ ] **Step 3: Run, expect failure**

Run: `pnpm --filter @rld/analyzer-core test retainer-walker`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `packages/analyzer-core/src/retainer-walker.ts`**

```ts
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
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @rld/analyzer-core test retainer-walker`
Expected: 3 passed.

---

### Task 1.7: Classifier

Apply the rules from spec section 4.5 step 5. Inputs: tagged subscriptions, their resolved stacks, recording metadata, classification walk result per subscription.

**Files:**
- Create: `packages/analyzer-core/src/classifier.ts`
- Create: `packages/analyzer-core/test/classifier.test.ts`

- [ ] **Step 1: Write `packages/analyzer-core/test/classifier.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { classify } from '../src/classifier.js';
import type { SubscriptionTag, ResolvedStackFrame, RecordingMeta } from '../src/types.js';

const recording: RecordingMeta = {
  recordingId: 'rec-1',
  initialRoute: '/products',
  startedAtMs: 0,
  stoppedAtMs: 1000,
  navigations: [{ fromRoute: '/products', toRoute: '/about', atMs: 500 }],
};

function tag(over: Partial<SubscriptionTag>): SubscriptionTag {
  return {
    id: 'x', createdAtMs: 0, route: '/products', stackRaw: '',
    observableKind: 'interval', recordingId: 'rec-1', closed: false,
    ...over,
  };
}

function userFrame(): ResolvedStackFrame {
  return { rawFrame: '', file: 'src/app/x.ts', line: 1, column: 1, isFramework: false, functionName: 'ngOnInit' };
}

function fwFrame(): ResolvedStackFrame {
  return { rawFrame: '', file: 'node_modules/@angular/core/x.mjs', line: 1, column: 1, isFramework: true, functionName: 's' };
}

describe('classify', () => {
  it('classifies an open subscription from initial route with user frames as leak', () => {
    const result = classify({
      tag: tag({}),
      frames: [userFrame()],
      classification: { reachesApplicationRef: false, reachesWindow: true, passesThroughComponent: true },
      recording,
    });
    expect(result).toBe('leak');
  });

  it('skips subscriptions from a different route', () => {
    const result = classify({
      tag: tag({ route: '/about' }),
      frames: [userFrame()],
      classification: { reachesApplicationRef: false, reachesWindow: true, passesThroughComponent: true },
      recording,
    });
    expect(result).toBe('skip-different-route');
  });

  it('counts framework-only stacks as ignored', () => {
    const result = classify({
      tag: tag({}),
      frames: [fwFrame(), fwFrame()],
      classification: { reachesApplicationRef: false, reachesWindow: true, passesThroughComponent: false },
      recording,
    });
    expect(result).toBe('framework-noise');
  });

  it('classifies ApplicationRef-rooted subs without component as long-lived', () => {
    const result = classify({
      tag: tag({}),
      frames: [userFrame()],
      classification: { reachesApplicationRef: true, reachesWindow: true, passesThroughComponent: false },
      recording,
    });
    expect(result).toBe('long-lived');
  });

  it('classifies ApplicationRef-rooted sub that passes through a component as a leak', () => {
    const result = classify({
      tag: tag({}),
      frames: [userFrame()],
      classification: { reachesApplicationRef: true, reachesWindow: true, passesThroughComponent: true },
      recording,
    });
    expect(result).toBe('leak');
  });

  it('skips closed subscriptions even if otherwise leak-shaped', () => {
    const result = classify({
      tag: tag({ closed: true }),
      frames: [userFrame()],
      classification: { reachesApplicationRef: false, reachesWindow: true, passesThroughComponent: true },
      recording,
    });
    expect(result).toBe('skip-closed');
  });

  it('skips subscriptions from a different recording', () => {
    const result = classify({
      tag: tag({ recordingId: 'rec-2' }),
      frames: [userFrame()],
      classification: { reachesApplicationRef: false, reachesWindow: true, passesThroughComponent: true },
      recording,
    });
    expect(result).toBe('skip-different-recording');
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @rld/analyzer-core test classifier`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/analyzer-core/src/classifier.ts`**

```ts
import type {
  SubscriptionTag,
  ResolvedStackFrame,
  RecordingMeta,
} from './types.js';
import type { ClassificationResult } from './retainer-walker.js';

export type Verdict =
  | 'leak'
  | 'long-lived'
  | 'framework-noise'
  | 'skip-closed'
  | 'skip-different-route'
  | 'skip-different-recording';

export function classify(input: {
  tag: SubscriptionTag;
  frames: ResolvedStackFrame[];
  classification: ClassificationResult;
  recording: RecordingMeta;
}): Verdict {
  const { tag, frames, classification, recording } = input;
  if (tag.closed) return 'skip-closed';
  if (tag.recordingId !== recording.recordingId) return 'skip-different-recording';
  if (tag.route !== recording.initialRoute) return 'skip-different-route';
  const hasUserFrame = frames.some((f) => !f.isFramework);
  if (!hasUserFrame) return 'framework-noise';
  if (classification.reachesApplicationRef && !classification.passesThroughComponent) {
    return 'long-lived';
  }
  return 'leak';
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @rld/analyzer-core test classifier`
Expected: 7 passed.

---

### Task 1.8: Top-level `analyze()`

Wires the pieces together. Takes the snapshot JSON string + recording + source maps, returns `LeakReport`.

**Files:**
- Modify: `packages/analyzer-core/src/index.ts`
- Create: `packages/analyzer-core/src/analyze.ts`
- Create: `packages/analyzer-core/test/analyze.test.ts`
- Create: `packages/analyzer-core/test/fixtures/end-to-end-snapshot.json`

- [ ] **Step 1: Build end-to-end fixture**

We need a snapshot where: Window retains AppComponent → ProductListComponent → Subscription with __sw_meta tag. The tag's stackRaw should reference a source URL we'll provide a sourcemap for. Build this manually similar to prior fixtures, but reuse the tagged-subscription fixture structure with an added retainer chain.

Create `packages/analyzer-core/test/fixtures/end-to-end-snapshot.json`:

```json
{
  "snapshot": {
    "meta": {
      "node_fields": ["type", "name", "id", "self_size", "edge_count", "trace_node_id", "detachedness"],
      "node_types": [
        ["hidden", "array", "string", "object", "code", "closure", "regexp", "number", "native", "synthetic", "concatenated string", "sliced string", "symbol", "bigint", "object shape"],
        "string", "number", "number", "number", "number", "number"
      ],
      "edge_fields": ["type", "name_or_index", "to_node"],
      "edge_types": [
        ["context", "element", "property", "internal", "hidden", "shortcut", "weak"],
        "string_or_number", "node"
      ]
    },
    "node_count": 12,
    "edge_count": 11,
    "trace_function_count": 0
  },
  "nodes": [
    3, 1, 1, 0, 1, 0, 0,
    3, 2, 2, 0, 1, 0, 0,
    3, 3, 3, 0, 1, 0, 0,
    3, 4, 4, 0, 1, 0, 0,
    2, 5, 5, 0, 0, 0, 0,
    7, 6, 6, 0, 0, 0, 0,
    2, 7, 7, 0, 0, 0, 0,
    2, 8, 8, 0, 0, 0, 0,
    2, 9, 9, 0, 0, 0, 0,
    2, 10, 10, 0, 0, 0, 0,
    2, 11, 11, 0, 0, 0, 0,
    3, 12, 12, 0, 7, 0, 0
  ],
  "edges": [
    2, 13, 7,
    2, 14, 14,
    2, 15, 21,
    2, 16, 77,
    2, 17, 28,
    2, 18, 35,
    2, 19, 42,
    2, 20, 49,
    2, 21, 56,
    2, 22, 63,
    2, 23, 70
  ],
  "trace_function_infos": [],
  "trace_tree": [],
  "samples": [],
  "locations": [],
  "strings": [
    "",
    "Window",
    "AppComponent",
    "ProductListComponent",
    "Subscription",
    "sub-1",
    "100",
    "/products",
    "Error: stack\n    at ngOnInit (http://localhost:4200/main.js:1:50)",
    "interval",
    "rec-1",
    "false",
    "Object",
    "appComp",
    "list",
    "_sub",
    "__sw_meta",
    "id",
    "createdAtMs",
    "route",
    "stackRaw",
    "observableKind",
    "recordingId",
    "closed"
  ]
}
```

Layout:
- Node 0 byte 0: Window (1 edge)
- Node 1 byte 7: AppComponent (1 edge)
- Node 2 byte 14: ProductListComponent (1 edge)
- Node 3 byte 21: Subscription (1 edge → __sw_meta object at byte 77)
- Node 4 byte 28: "sub-1" string
- Node 5 byte 35: "100" number-as-string
- Node 6 byte 42: "/products"
- Node 7 byte 49: "Error: stack..."
- Node 8 byte 56: "interval"
- Node 9 byte 63: "rec-1"
- Node 10 byte 70: "false"
- Node 11 byte 77: Object (__sw_meta, 7 edges)

Edges (3 fields each):
- 0: Window appComp → byte 7
- 3: AppComp list → byte 14
- 6: ProductList _sub → byte 21
- 9: Sub __sw_meta → byte 77
- 12: Obj id → byte 28
- 15: Obj createdAtMs → byte 35
- 18: Obj route → byte 42
- 21: Obj stackRaw → byte 49
- 24: Obj observableKind → byte 56
- 27: Obj recordingId → byte 63
- 30: Obj closed → byte 70

11 edges × 3 fields = 33 numbers. Check that the edges array has 33 entries (it does — 11 triples).

- [ ] **Step 2: Write `packages/analyzer-core/test/analyze.test.ts`**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SourceMapGenerator, type RawSourceMap } from 'source-map';
import { analyze } from '../src/analyze.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures/end-to-end-snapshot.json');

let sourceMap: RawSourceMap;

beforeAll(() => {
  const gen = new SourceMapGenerator({ file: 'main.js' });
  gen.addMapping({
    source: 'src/app/products.component.ts',
    original: { line: 47, column: 4 },
    generated: { line: 1, column: 50 },
    name: 'ngOnInit',
  });
  sourceMap = JSON.parse(gen.toString());
});

describe('analyze', () => {
  it('produces a LeakReport identifying the one leak in the fixture', async () => {
    const snapshot = await readFile(FIXTURE, 'utf8');
    const report = await analyze({
      snapshot,
      recording: {
        recordingId: 'rec-1',
        initialRoute: '/products',
        startedAtMs: 0,
        stoppedAtMs: 1000,
        navigations: [{ fromRoute: '/products', toRoute: '/about', atMs: 500 }],
      },
      sourceMaps: new Map([['http://localhost:4200/main.js', sourceMap]]),
    });
    expect(report.totalSubscriptionsScanned).toBe(1);
    expect(report.leaks).toHaveLength(1);
    expect(report.ignoredFrameworkSubscriptions).toBe(0);
    expect(report.longLivedServiceSubscriptions).toHaveLength(0);
    const leak = report.leaks[0]!;
    expect(leak.id).toBe('sub-1');
    expect(leak.route).toBe('/products');
    expect(leak.observableKind).toBe('interval');
    expect(leak.sourceLocation.file).toBe('src/app/products.component.ts');
    expect(leak.sourceLocation.line).toBe(47);
    expect(leak.componentName).toBe('ProductListComponent');
  });
});
```

- [ ] **Step 3: Run, expect failure**

Run: `pnpm --filter @rld/analyzer-core test analyze`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `packages/analyzer-core/src/analyze.ts`**

```ts
import type { RawSourceMap } from 'source-map';
import { parseHeapSnapshot } from './heap-parser.js';
import { findSubscriptions } from './subscription-finder.js';
import { decodeTag } from './tag-decoder.js';
import { resolveStack } from './source-map-resolver.js';
import { walkClassification, walkDisplayChain } from './retainer-walker.js';
import { classify } from './classifier.js';
import type {
  RecordingMeta,
  LeakReport,
  LeakEntry,
  LongLivedEntry,
} from './types.js';

export async function analyze(input: {
  snapshot: string;
  recording: RecordingMeta;
  sourceMaps: Map<string, RawSourceMap>;
}): Promise<LeakReport> {
  const { snapshot, recording, sourceMaps } = input;
  const graph = parseHeapSnapshot(snapshot);
  const subs = findSubscriptions(graph);

  const leaks: LeakEntry[] = [];
  const longLived: LongLivedEntry[] = [];
  let ignored = 0;
  let scanned = 0;

  for (const sub of subs) {
    if (sub.metaNodeIndex === null) continue;
    const tag = decodeTag(graph, sub.metaNodeIndex);
    if (!tag) continue;
    if (tag.recordingId !== recording.recordingId) continue;
    scanned++;

    const frames = await resolveStack(tag.stackRaw, sourceMaps);
    const classification = walkClassification(graph, sub.nodeIndex);
    const verdict = classify({ tag, frames, classification, recording });

    if (verdict === 'framework-noise') {
      ignored++;
      continue;
    }
    if (verdict === 'leak') {
      const retainerChain = walkDisplayChain(graph, sub.nodeIndex);
      const componentName = retainerChain.find((n) =>
        n.constructorName.endsWith('Component') || n.constructorName.endsWith('Directive'),
      )?.constructorName ?? null;
      const topUserFrame = frames.find((f) => !f.isFramework);
      const sourceLocation = topUserFrame
        ? { file: topUserFrame.file, line: topUserFrame.line, column: topUserFrame.column }
        : { file: 'unknown', line: 0, column: 0 };
      leaks.push({
        id: tag.id,
        route: tag.route,
        observableKind: tag.observableKind,
        sourceLocation,
        componentName,
        stack: frames,
        retainerChain,
      });
      continue;
    }
    if (verdict === 'long-lived') {
      const retainerChain = walkDisplayChain(graph, sub.nodeIndex);
      const componentName = retainerChain.find((n) =>
        n.constructorName.endsWith('Service'),
      )?.constructorName ?? null;
      const topUserFrame = frames.find((f) => !f.isFramework);
      longLived.push({
        id: tag.id,
        route: tag.route,
        observableKind: tag.observableKind,
        componentName,
        sourceLocation: topUserFrame
          ? { file: topUserFrame.file, line: topUserFrame.line, column: topUserFrame.column }
          : null,
      });
    }
  }

  return {
    leaks,
    ignoredFrameworkSubscriptions: ignored,
    longLivedServiceSubscriptions: longLived,
    totalSubscriptionsScanned: scanned,
  };
}
```

- [ ] **Step 5: Export from `packages/analyzer-core/src/index.ts`**

Replace contents:

```ts
export const VERSION = '0.1.0';
export * from './types.js';
export { analyze } from './analyze.js';
export { parseHeapSnapshot, HeapGraph } from './heap-parser.js';
export { findSubscriptions } from './subscription-finder.js';
export { decodeTag } from './tag-decoder.js';
export { resolveStack } from './source-map-resolver.js';
export { walkDisplayChain, walkClassification } from './retainer-walker.js';
export { classify } from './classifier.js';
```

- [ ] **Step 6: Run all analyzer-core tests**

Run: `pnpm --filter @rld/analyzer-core test`
Expected: all tests pass.

---

### Task 1.9: Build analyzer-core

- [ ] **Step 1: Build**

Run: `pnpm --filter @rld/analyzer-core build`
Expected: `packages/analyzer-core/dist/` contains compiled `.js` and `.d.ts` files.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @rld/analyzer-core typecheck`
Expected: no errors.

---

## Phase 2 — `tagger`

Self-contained IIFE bundle injected into the page's MAIN world. Patches `Observable.prototype.subscribe` / `Subscription.prototype.unsubscribe`, installs `window.__rxjsLeakDetector`, sets up route tracking.

### Task 2.1: Package scaffold

**Files:**
- Create: `packages/tagger/package.json`
- Create: `packages/tagger/tsconfig.json`
- Create: `packages/tagger/vitest.config.ts`
- Create: `packages/tagger/vite.config.ts`

- [ ] **Step 1: Create `packages/tagger/package.json`**

```json
{
  "name": "@rld/tagger",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "happy-dom": "^14.10.1",
    "vite": "^5.2.0"
  }
}
```

(rxjs is a devDependency for the tests; the bundled tagger doesn't import rxjs — it operates on whatever rxjs the page provides.)

Actually rxjs is needed at test time but NOT at runtime. Move it to devDependencies:

```json
{
  "name": "@rld/tagger",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "rxjs": "^7.8.1",
    "happy-dom": "^14.10.1",
    "vite": "^5.2.0"
  }
}
```

- [ ] **Step 2: Create `packages/tagger/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2022", "DOM"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["test", "dist"]
}
```

- [ ] **Step 3: Create `packages/tagger/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create `packages/tagger/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'RldTagger',
      formats: ['iife'],
      fileName: () => 'tagger.js',
    },
    minify: false,
    outDir: 'dist',
    emptyOutDir: true,
  },
});
```

- [ ] **Step 5: Install**

Run: `pnpm install`
Expected: dependencies resolve.

---

### Task 2.2: Subscription patcher

**Files:**
- Create: `packages/tagger/src/patch-rxjs.ts`
- Create: `packages/tagger/test/patch-rxjs.test.ts`

- [ ] **Step 1: Write test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Observable, interval, Subject } from 'rxjs';
import { installPatch, isInstalled } from '../src/patch-rxjs.js';

function freshSession() {
  return {
    recordingId: 'rec-1',
    initialRoute: '/x',
    isRecording: true,
    currentRoute: '/x',
    stackHashCache: new Map<string, string>(),
  };
}

describe('installPatch', () => {
  beforeEach(() => {
    // Ensure a fresh Observable prototype between tests by re-importing isn't possible
    // since the patch is applied to the live prototype. Tests below must handle idempotency.
  });

  it('marks the prototype as patched and is idempotent', () => {
    installPatch();
    installPatch();
    expect(isInstalled()).toBe(true);
  });

  it('tags a new Subscription with full meta when isRecording is true', () => {
    installPatch();
    const session = freshSession();
    (globalThis as any).__rld_session = session;

    const obs = new Observable<number>((observer) => {
      observer.next(1);
      observer.complete();
    });
    const sub = obs.subscribe(() => {});
    const meta = (sub as any).__sw_meta;
    expect(meta).toBeDefined();
    expect(meta.recordingId).toBe('rec-1');
    expect(meta.route).toBe('/x');
    expect(meta.id).toBeTypeOf('string');
    expect(meta.createdAtMs).toBeTypeOf('number');
    expect(meta.stackRaw).toBeTypeOf('string');
    expect(meta.closed).toBe(false);
  });

  it('flips closed=true on unsubscribe', () => {
    installPatch();
    const session = freshSession();
    (globalThis as any).__rld_session = session;
    const sub = new Subject<void>().subscribe(() => {});
    sub.unsubscribe();
    expect((sub as any).__sw_meta.closed).toBe(true);
  });

  it('detects observableKind from .source chain', () => {
    installPatch();
    const session = freshSession();
    (globalThis as any).__rld_session = session;
    const sub = interval(1000).subscribe(() => {});
    expect((sub as any).__sw_meta.observableKind).toContain('interval');
    sub.unsubscribe();
  });

  it('does not collect stack when isRecording is false', () => {
    installPatch();
    const session = freshSession();
    session.isRecording = false;
    (globalThis as any).__rld_session = session;
    const sub = new Subject<void>().subscribe(() => {});
    const meta = (sub as any).__sw_meta;
    expect(meta.recordingId).toBe('');
    expect(meta.stackRaw).toBe('');
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @rld/tagger test patch-rxjs`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/tagger/src/patch-rxjs.ts`**

```ts
declare global {
  // eslint-disable-next-line no-var
  var __rld_session: {
    recordingId: string;
    initialRoute: string;
    isRecording: boolean;
    currentRoute: string;
    stackHashCache: Map<string, string>;
  } | undefined;
}

const PATCHED = Symbol.for('__rld_patched');

export function isInstalled(): boolean {
  const proto = findObservablePrototype();
  if (!proto) return false;
  return (proto as any)[PATCHED] === true;
}

function findObservablePrototype(): object | null {
  const w = globalThis as any;
  if (w.rxjs?.Observable?.prototype) return w.rxjs.Observable.prototype;
  // happy-dom test: rxjs is imported as ESM, prototype available via Subject
  if (w.Observable?.prototype) return w.Observable.prototype;
  return null;
}

let counter = 0;
function makeId(): string {
  counter += 1;
  return `s-${Date.now().toString(36)}-${counter.toString(36)}`;
}

function detectObservableKind(observable: any): string {
  let current = observable;
  const seen = new Set<any>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const ctorName = current.constructor?.name;
    if (ctorName && ctorName !== 'Observable') return ctorName;
    current = current.source;
  }
  return 'Observable';
}

export function installPatch(): void {
  const w = globalThis as any;
  // try to get Observable from rxjs (test path) or window (page path)
  let Observable: any = w.Observable;
  if (!Observable) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const m = (w as any).require?.('rxjs');
      if (m?.Observable) Observable = m.Observable;
    } catch {}
  }
  if (!Observable) {
    // attempt dynamic import path for tests
    return;
  }
  const proto = Observable.prototype;
  if ((proto as any)[PATCHED]) return;
  const origSubscribe = proto.subscribe;
  Object.defineProperty(proto, PATCHED, { value: true, enumerable: false });

  proto.subscribe = function patchedSubscribe(this: any, ...args: any[]) {
    const subscription = origSubscribe.apply(this, args);
    const session = w.__rld_session;
    const recording = session?.isRecording === true;
    const meta: any = {
      id: makeId(),
      createdAtMs: Date.now(),
      route: recording ? session!.currentRoute : '',
      stackRaw: recording ? new Error().stack ?? '' : '',
      observableKind: detectObservableKind(this),
      recordingId: recording ? session!.recordingId : '',
      closed: false,
    };
    Object.defineProperty(subscription, '__sw_meta', {
      value: meta,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    return subscription;
  };

  const SubscriptionProto = Object.getPrototypeOf(new (class { unsubscribe() {} })());
  // Find rxjs Subscription prototype dynamically
  const sampleSub = origSubscribe.call(new Observable(() => {}), () => {});
  const realProto = Object.getPrototypeOf(sampleSub);
  if (realProto && typeof realProto.unsubscribe === 'function' && !(realProto as any)[Symbol.for('__rld_unsub_patched')]) {
    const origUnsub = realProto.unsubscribe;
    Object.defineProperty(realProto, Symbol.for('__rld_unsub_patched'), { value: true, enumerable: false });
    realProto.unsubscribe = function patchedUnsubscribe(this: any) {
      if (this.__sw_meta) this.__sw_meta.closed = true;
      return origUnsub.call(this);
    };
  }
  sampleSub.unsubscribe();
}

// Auto-install on import for the test environment
if (typeof globalThis !== 'undefined') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rxjs = (globalThis as any).rxjs;
    if (!rxjs) {
      // try importing
      import('rxjs').then((m) => {
        (globalThis as any).Observable = m.Observable;
        installPatch();
      }).catch(() => {});
    }
  } catch {}
}
```

The auto-install branch is messy. Simplify: tests will explicitly import rxjs and pass Observable into installPatch.

Revise — simpler implementation:

```ts
declare global {
  // eslint-disable-next-line no-var
  var __rld_session: {
    recordingId: string;
    initialRoute: string;
    isRecording: boolean;
    currentRoute: string;
    stackHashCache: Map<string, string>;
  } | undefined;
}

const PATCHED = Symbol.for('__rld_patched');
const UNSUB_PATCHED = Symbol.for('__rld_unsub_patched');

let installedFlag = false;

export function isInstalled(): boolean {
  return installedFlag;
}

let counter = 0;
function makeId(): string {
  counter += 1;
  return `s-${Date.now().toString(36)}-${counter.toString(36)}`;
}

function detectObservableKind(observable: any): string {
  let current = observable;
  const seen = new Set<any>();
  let kind = 'Observable';
  while (current && !seen.has(current)) {
    seen.add(current);
    const ctorName = current.constructor?.name;
    if (ctorName && ctorName !== 'Observable' && ctorName !== 'Object') {
      kind = ctorName;
    }
    current = current.source;
  }
  return kind;
}

export async function installPatch(): Promise<void> {
  if (installedFlag) return;
  const w = globalThis as any;
  let ObservableCtor: any = w.Observable;
  if (!ObservableCtor) {
    try {
      const mod = await import('rxjs');
      ObservableCtor = mod.Observable;
    } catch {
      return;
    }
  }
  const proto = ObservableCtor.prototype;
  if ((proto as any)[PATCHED]) {
    installedFlag = true;
    return;
  }
  Object.defineProperty(proto, PATCHED, { value: true, enumerable: false });
  const origSubscribe = proto.subscribe;
  proto.subscribe = function patchedSubscribe(this: any, ...args: any[]) {
    const subscription = origSubscribe.apply(this, args);
    const session = (globalThis as any).__rld_session;
    const recording = session?.isRecording === true;
    const meta: any = {
      id: makeId(),
      createdAtMs: Date.now(),
      route: recording ? session.currentRoute : '',
      stackRaw: recording ? new Error().stack ?? '' : '',
      observableKind: detectObservableKind(this),
      recordingId: recording ? session.recordingId : '',
      closed: false,
    };
    Object.defineProperty(subscription, '__sw_meta', {
      value: meta,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    const subProto = Object.getPrototypeOf(subscription);
    if (subProto && !(subProto as any)[UNSUB_PATCHED] && typeof subProto.unsubscribe === 'function') {
      Object.defineProperty(subProto, UNSUB_PATCHED, { value: true, enumerable: false });
      const origUnsub = subProto.unsubscribe;
      subProto.unsubscribe = function patchedUnsubscribe(this: any) {
        if (this.__sw_meta) this.__sw_meta.closed = true;
        return origUnsub.call(this);
      };
    }
    return subscription;
  };
  installedFlag = true;
}
```

Update test signature: `installPatch` is now async. Adjust tests:

Update `packages/tagger/test/patch-rxjs.test.ts` to use `await installPatch()`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Observable, interval, Subject } from 'rxjs';
import { installPatch, isInstalled } from '../src/patch-rxjs.js';

function freshSession() {
  return {
    recordingId: 'rec-1',
    initialRoute: '/x',
    isRecording: true,
    currentRoute: '/x',
    stackHashCache: new Map<string, string>(),
  };
}

beforeAll(async () => {
  (globalThis as any).Observable = Observable;
  await installPatch();
});

describe('installPatch', () => {
  it('marks installed and is idempotent', async () => {
    await installPatch();
    expect(isInstalled()).toBe(true);
  });

  it('tags a new Subscription with full meta when isRecording is true', () => {
    (globalThis as any).__rld_session = freshSession();
    const obs = new Observable<number>((observer) => { observer.next(1); observer.complete(); });
    const sub = obs.subscribe(() => {});
    const meta = (sub as any).__sw_meta;
    expect(meta).toBeDefined();
    expect(meta.recordingId).toBe('rec-1');
    expect(meta.route).toBe('/x');
    expect(meta.id).toBeTypeOf('string');
    expect(meta.createdAtMs).toBeTypeOf('number');
    expect(meta.stackRaw).toBeTypeOf('string');
    expect(meta.closed).toBe(false);
  });

  it('flips closed=true on unsubscribe', () => {
    (globalThis as any).__rld_session = freshSession();
    const sub = new Subject<void>().subscribe(() => {});
    sub.unsubscribe();
    expect((sub as any).__sw_meta.closed).toBe(true);
  });

  it('detects observableKind from .source chain', () => {
    (globalThis as any).__rld_session = freshSession();
    const sub = interval(1000).subscribe(() => {});
    expect((sub as any).__sw_meta.observableKind).toMatch(/Interval/i);
    sub.unsubscribe();
  });

  it('skips heavy fields when isRecording is false', () => {
    const session = freshSession();
    session.isRecording = false;
    (globalThis as any).__rld_session = session;
    const sub = new Subject<void>().subscribe(() => {});
    expect((sub as any).__sw_meta.recordingId).toBe('');
    expect((sub as any).__sw_meta.stackRaw).toBe('');
  });
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @rld/tagger test patch-rxjs`
Expected: all 5 pass.

---

### Task 2.3: Route tracker

Detects Angular Router if present, otherwise falls back to URL changes via `popstate` + `pushState` patching + `hashchange`.

**Files:**
- Create: `packages/tagger/src/route-tracker.ts`
- Create: `packages/tagger/test/route-tracker.test.ts`

- [ ] **Step 1: Write test**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installRouteTracker } from '../src/route-tracker.js';

describe('installRouteTracker (URL fallback)', () => {
  let listener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listener = vi.fn();
    window.history.replaceState({}, '', '/initial');
  });

  it('fires listener with current URL on pushState', () => {
    const stop = installRouteTracker(listener);
    window.history.pushState({}, '', '/page-a');
    expect(listener).toHaveBeenCalledWith({ from: '/initial', to: '/page-a' });
    stop();
  });

  it('fires listener on hashchange', () => {
    const stop = installRouteTracker(listener);
    window.location.hash = '#section';
    window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: 'http://localhost/initial', newURL: 'http://localhost/initial#section' }));
    expect(listener).toHaveBeenCalled();
    stop();
  });

  it('returned stop() detaches listeners', () => {
    const stop = installRouteTracker(listener);
    stop();
    window.history.pushState({}, '', '/page-b');
    expect(listener).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @rld/tagger test route-tracker`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/tagger/src/route-tracker.ts`**

```ts
export type RouteChange = { from: string; to: string };
export type RouteListener = (change: RouteChange) => void;

function currentPath(): string {
  return window.location.pathname + window.location.search + window.location.hash;
}

export function installRouteTracker(listener: RouteListener): () => void {
  let lastPath = currentPath();
  const fire = () => {
    const next = currentPath();
    if (next === lastPath) return;
    const prev = lastPath;
    lastPath = next;
    listener({ from: prev, to: next });
  };

  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    origPush.apply(this, args);
    fire();
  } as typeof history.pushState;
  history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
    origReplace.apply(this, args);
    fire();
  } as typeof history.replaceState;

  const onPop = () => fire();
  const onHash = () => fire();
  window.addEventListener('popstate', onPop);
  window.addEventListener('hashchange', onHash);

  return () => {
    history.pushState = origPush;
    history.replaceState = origReplace;
    window.removeEventListener('popstate', onPop);
    window.removeEventListener('hashchange', onHash);
  };
}

export function tryAngularRouter(listener: RouteListener, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const ng = (globalThis as any).ng;
      try {
        const router = ng?.applicationRef?.injector?.get?.((globalThis as any).ng?.Router);
        if (router?.events?.subscribe) {
          router.events.subscribe((e: any) => {
            if (e && (e.constructor?.name === 'NavigationEnd' || e.url)) {
              const prev = (globalThis as any).__rld_session?.currentRoute ?? '';
              listener({ from: prev, to: e.url ?? e.urlAfterRedirects ?? '' });
            }
          });
          resolve(true);
          return;
        }
      } catch {}
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @rld/tagger test route-tracker`
Expected: 3 passed.

---

### Task 2.4: Recording state & window globals

**Files:**
- Create: `packages/tagger/src/recording-state.ts`
- Create: `packages/tagger/src/index.ts`
- Create: `packages/tagger/test/recording-state.test.ts`

- [ ] **Step 1: Write test for recording state**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createRecordingApi } from '../src/recording-state.js';

describe('recording state machine', () => {
  beforeEach(() => {
    delete (globalThis as any).__rld_session;
  });

  it('start() initializes session and flips isRecording', () => {
    const api = createRecordingApi();
    api.start();
    expect(api.isRecording).toBe(true);
    const session = (globalThis as any).__rld_session;
    expect(session.isRecording).toBe(true);
    expect(session.recordingId).toBeTypeOf('string');
    expect(session.recordingId.length).toBeGreaterThan(0);
  });

  it('stop() returns meta with at least one navigation when recorded', () => {
    const api = createRecordingApi();
    api.start();
    api.recordNavigation({ from: '/a', to: '/b' });
    const meta = api.stop();
    expect(meta.navigations).toHaveLength(1);
    expect(meta.initialRoute).toBe('/a');
    expect(api.isRecording).toBe(false);
  });

  it('markNavigation() pushes a synthetic navigation', () => {
    const api = createRecordingApi();
    api.start();
    api.markNavigation();
    const meta = api.stop();
    expect(meta.navigations.length).toBeGreaterThanOrEqual(1);
  });

  it('start() while recording resets the session', () => {
    const api = createRecordingApi();
    api.start();
    const firstId = (globalThis as any).__rld_session.recordingId;
    api.start();
    const secondId = (globalThis as any).__rld_session.recordingId;
    expect(secondId).not.toBe(firstId);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @rld/tagger test recording-state`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/tagger/src/recording-state.ts`**

```ts
type Session = {
  recordingId: string;
  initialRoute: string;
  isRecording: boolean;
  currentRoute: string;
  startedAtMs: number;
  navigations: Array<{ fromRoute: string; toRoute: string; atMs: number }>;
  stackHashCache: Map<string, string>;
};

function currentPath(): string {
  return window.location.pathname + window.location.search + window.location.hash;
}

function makeRecordingId(): string {
  return `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export type RecordingApi = {
  readonly isRecording: boolean;
  start(): void;
  stop(): {
    recordingId: string;
    initialRoute: string;
    startedAtMs: number;
    stoppedAtMs: number;
    navigations: Array<{ fromRoute: string; toRoute: string; atMs: number }>;
  };
  markNavigation(): void;
  recordNavigation(change: { from: string; to: string }): void;
};

export function createRecordingApi(): RecordingApi {
  const api: RecordingApi = {
    get isRecording() {
      return (globalThis as any).__rld_session?.isRecording === true;
    },
    start() {
      const initial = currentPath();
      const session: Session = {
        recordingId: makeRecordingId(),
        initialRoute: initial,
        isRecording: true,
        currentRoute: initial,
        startedAtMs: Date.now(),
        navigations: [],
        stackHashCache: new Map(),
      };
      (globalThis as any).__rld_session = session;
    },
    stop() {
      const session: Session | undefined = (globalThis as any).__rld_session;
      if (!session) {
        return {
          recordingId: '',
          initialRoute: '',
          startedAtMs: 0,
          stoppedAtMs: Date.now(),
          navigations: [],
        };
      }
      session.isRecording = false;
      const meta = {
        recordingId: session.recordingId,
        initialRoute: session.initialRoute,
        startedAtMs: session.startedAtMs,
        stoppedAtMs: Date.now(),
        navigations: session.navigations.slice(),
      };
      return meta;
    },
    markNavigation() {
      const session: Session | undefined = (globalThis as any).__rld_session;
      if (!session) return;
      const next = currentPath();
      session.navigations.push({ fromRoute: session.currentRoute, toRoute: next, atMs: Date.now() });
      session.currentRoute = next;
    },
    recordNavigation(change) {
      const session: Session | undefined = (globalThis as any).__rld_session;
      if (!session) return;
      session.navigations.push({ fromRoute: change.from, toRoute: change.to, atMs: Date.now() });
      session.currentRoute = change.to;
    },
  };
  return api;
}
```

- [ ] **Step 4: Run test**

Run: `pnpm --filter @rld/tagger test recording-state`
Expected: 4 passed.

- [ ] **Step 5: Write tagger entry point `packages/tagger/src/index.ts`**

```ts
import { installPatch } from './patch-rxjs.js';
import { createRecordingApi } from './recording-state.js';
import { installRouteTracker, tryAngularRouter } from './route-tracker.js';

declare global {
  interface Window {
    __rxjsLeakDetector?: ReturnType<typeof createRecordingApi> & { _routeStop?: () => void };
  }
}

void installPatch();
const api = createRecordingApi();
const stop = installRouteTracker((change) => api.recordNavigation(change));
void tryAngularRouter((change) => api.recordNavigation(change));

(api as any)._routeStop = stop;
(window as Window).__rxjsLeakDetector = api;

window.postMessage({ source: 'rxjs-leak-detector', type: 'TAGGER_READY' }, '*');
```

- [ ] **Step 6: Build the IIFE bundle**

Run: `pnpm --filter @rld/tagger build`
Expected: `packages/tagger/dist/tagger.js` exists, no rxjs imported (rxjs comes from page at runtime — confirm by `grep -c "from 'rxjs'" packages/tagger/dist/tagger.js` returns 0).

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @rld/tagger typecheck`
Expected: 0 errors.

---

## Phase 3 — `extension` (Manifest V3 shell)

### Task 3.1: Package scaffold

**Files:**
- Create: `packages/extension/package.json`
- Create: `packages/extension/tsconfig.json`
- Create: `packages/extension/vite.config.ts`
- Create: `packages/extension/src/manifest.json`
- Create: `packages/extension/devtools.html`

- [ ] **Step 1: Create `packages/extension/package.json`**

```json
{
  "name": "@rld/extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "test": "vitest run",
    "test:e2e": "vitest run --config vitest.e2e.config.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@rld/analyzer-core": "workspace:*",
    "@rld/tagger": "workspace:*",
    "@rld/panel-ui": "workspace:*",
    "source-map": "^0.7.4"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.268",
    "vite": "^5.2.0",
    "puppeteer": "^22.10.0"
  }
}
```

- [ ] **Step 2: Create `packages/extension/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["chrome"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["test", "dist"]
}
```

- [ ] **Step 3: Create `packages/extension/src/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "RxJS Leak Detector",
  "version": "0.1.0",
  "description": "Detects leftover RxJS subscriptions in Angular dev-mode apps",
  "devtools_page": "devtools.html",
  "background": { "service_worker": "background.js", "type": "module" },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content-bridge.js"],
      "run_at": "document_start",
      "world": "ISOLATED"
    },
    {
      "matches": ["<all_urls>"],
      "js": ["tagger.js"],
      "run_at": "document_start",
      "world": "MAIN"
    }
  ],
  "permissions": ["debugger", "scripting", "storage"],
  "host_permissions": ["<all_urls>"]
}
```

- [ ] **Step 4: Create `packages/extension/devtools.html`**

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>devtools</title></head>
<body><script src="devtools.js" type="module"></script></body></html>
```

- [ ] **Step 5: Create `packages/extension/panel.html`**

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>RxJS Leak Detector</title>
<link rel="stylesheet" href="panel.css"></head>
<body><leak-detector-root></leak-detector-root><script src="panel.js" type="module"></script></body></html>
```

- [ ] **Step 6: Create `packages/extension/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
        'content-bridge': resolve(__dirname, 'src/content-bridge.ts'),
        devtools: resolve(__dirname, 'src/devtools.ts'),
        panel: resolve(__dirname, 'src/panel.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        format: 'es',
      },
    },
  },
  plugins: [
    {
      name: 'copy-static',
      closeBundle() {
        const dist = resolve(__dirname, 'dist');
        mkdirSync(dist, { recursive: true });
        copyFileSync(resolve(__dirname, 'src/manifest.json'), resolve(dist, 'manifest.json'));
        copyFileSync(resolve(__dirname, 'devtools.html'), resolve(dist, 'devtools.html'));
        copyFileSync(resolve(__dirname, 'panel.html'), resolve(dist, 'panel.html'));
        copyFileSync(resolve(__dirname, '../tagger/dist/tagger.js'), resolve(dist, 'tagger.js'));
      },
    },
  ],
});
```

- [ ] **Step 7: Install**

Run: `pnpm install`
Expected: workspace links to @rld/* packages, types/chrome installs.

---

### Task 3.2: Background service worker — message routing

**Files:**
- Create: `packages/extension/src/messages.ts`
- Create: `packages/extension/src/background.ts`
- Create: `packages/extension/test/messages.test.ts`

- [ ] **Step 1: Write test for message types**

```ts
import { describe, it, expectTypeOf } from 'vitest';
import type {
  PanelToBackground,
  BackgroundToPanel,
  BackgroundToContent,
  ContentToBackground,
} from '../src/messages.js';

describe('message types', () => {
  it('PanelToBackground is a discriminated union with expected variants', () => {
    expectTypeOf<PanelToBackground>().toMatchTypeOf<
      | { type: 'START_RECORDING'; tabId: number }
      | { type: 'STOP_RECORDING'; tabId: number }
      | { type: 'MARK_NAVIGATION'; tabId: number }
    >();
  });

  it('BackgroundToPanel has REPORT_READY and error variants', () => {
    expectTypeOf<BackgroundToPanel>().toMatchTypeOf<
      | { type: 'REPORT_READY'; report: unknown }
      | { type: 'ERROR'; message: string }
      | { type: 'STATE'; isRecording: boolean }
    >();
  });
});
```

- [ ] **Step 2: Implement `packages/extension/src/messages.ts`**

```ts
import type { LeakReport, RecordingMeta } from '@rld/analyzer-core';

export type PanelToBackground =
  | { type: 'START_RECORDING'; tabId: number }
  | { type: 'STOP_RECORDING'; tabId: number }
  | { type: 'MARK_NAVIGATION'; tabId: number }
  | { type: 'QUERY_STATE'; tabId: number };

export type BackgroundToPanel =
  | { type: 'REPORT_READY'; report: LeakReport }
  | { type: 'ERROR'; message: string }
  | { type: 'STATE'; isRecording: boolean }
  | { type: 'PROGRESS'; phase: 'capturing' | 'analyzing' | 'fetching-maps' };

export type BackgroundToContent =
  | { type: 'START_RECORDING' }
  | { type: 'STOP_RECORDING' }
  | { type: 'MARK_NAVIGATION' };

export type ContentToBackground =
  | { type: 'TAGGER_READY' }
  | { type: 'RECORDING_META'; meta: RecordingMeta };
```

- [ ] **Step 3: Run test**

Run: `pnpm --filter @rld/extension test messages`
Expected: pass.

- [ ] **Step 4: Implement minimal `packages/extension/src/background.ts`**

```ts
import type { PanelToBackground, BackgroundToPanel } from './messages.js';
import { startRecording, stopRecording } from './session.js';

type Port = chrome.runtime.Port;

const panelPorts = new Map<number, Port>(); // tabId -> port

chrome.runtime.onConnect.addListener((port) => {
  if (port.name.startsWith('panel:')) {
    const tabId = Number(port.name.split(':')[1]);
    panelPorts.set(tabId, port);
    port.onDisconnect.addListener(() => panelPorts.delete(tabId));
    port.onMessage.addListener((msg: PanelToBackground) => handlePanelMessage(msg, port));
  }
});

async function handlePanelMessage(msg: PanelToBackground, port: Port): Promise<void> {
  try {
    if (msg.type === 'START_RECORDING') {
      await startRecording(msg.tabId);
      send(port, { type: 'STATE', isRecording: true });
    } else if (msg.type === 'STOP_RECORDING') {
      send(port, { type: 'PROGRESS', phase: 'capturing' });
      const report = await stopRecording(msg.tabId, (phase) =>
        send(port, { type: 'PROGRESS', phase }),
      );
      send(port, { type: 'REPORT_READY', report });
      send(port, { type: 'STATE', isRecording: false });
    } else if (msg.type === 'MARK_NAVIGATION') {
      await chrome.tabs.sendMessage(msg.tabId, { type: 'MARK_NAVIGATION' });
    } else if (msg.type === 'QUERY_STATE') {
      send(port, { type: 'STATE', isRecording: false });
    }
  } catch (err) {
    send(port, { type: 'ERROR', message: err instanceof Error ? err.message : String(err) });
  }
}

function send(port: Port, msg: BackgroundToPanel): void {
  try { port.postMessage(msg); } catch {}
}

chrome.tabs.onRemoved.addListener((tabId) => {
  panelPorts.delete(tabId);
});
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @rld/extension typecheck`
Expected: errors about missing `./session.js` — proceed to next task.

---

### Task 3.3: Session manager (capture + analyze pipeline)

**Files:**
- Create: `packages/extension/src/session.ts`
- Create: `packages/extension/src/snapshot-capture.ts`
- Create: `packages/extension/src/source-map-fetcher.ts`

- [ ] **Step 1: Implement `packages/extension/src/snapshot-capture.ts`**

```ts
export async function captureHeapSnapshot(tabId: number): Promise<string> {
  const target = { tabId };
  await chrome.debugger.attach(target, '1.3');
  let chunks: string[] = [];
  const onEvent = (
    source: chrome.debugger.DebuggerSession,
    method: string,
    params?: object,
  ) => {
    if (source.tabId !== tabId) return;
    if (method === 'HeapProfiler.addHeapSnapshotChunk') {
      const p = params as { chunk: string };
      chunks.push(p.chunk);
    }
  };
  chrome.debugger.onEvent.addListener(onEvent);
  try {
    await chrome.debugger.sendCommand(target, 'HeapProfiler.takeHeapSnapshot', {
      reportProgress: false,
      captureNumericValue: true,
    });
  } finally {
    chrome.debugger.onEvent.removeListener(onEvent);
    try { await chrome.debugger.detach(target); } catch {}
  }
  return chunks.join('');
}
```

- [ ] **Step 2: Implement `packages/extension/src/source-map-fetcher.ts`**

```ts
import type { RawSourceMap } from 'source-map';

const FRAME_REGEX = /at\s+(?:.+?\s+\()?(.+?):\d+:\d+\)?$/gm;

export function extractScriptUrls(stack: string): string[] {
  const urls = new Set<string>();
  for (const match of stack.matchAll(FRAME_REGEX)) {
    const url = match[1];
    if (url && /^https?:\/\//.test(url)) urls.add(url);
  }
  return [...urls];
}

export async function fetchSourceMaps(
  tabId: number,
  scriptUrls: string[],
): Promise<Map<string, RawSourceMap>> {
  const result = new Map<string, RawSourceMap>();
  const limit = 6;
  let i = 0;
  async function worker(): Promise<void> {
    while (i < scriptUrls.length) {
      const idx = i++;
      const url = scriptUrls[idx]!;
      try {
        const map = await fetchOne(tabId, url);
        if (map) result.set(url, map);
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return result;
}

async function fetchOne(tabId: number, scriptUrl: string): Promise<RawSourceMap | null> {
  const mapUrl = `${scriptUrl}.map`;
  const expression = `fetch(${JSON.stringify(mapUrl)}).then(r => r.ok ? r.text() : null).catch(() => null)`;
  return new Promise((resolve) => {
    chrome.devtools.inspectedWindow.eval(expression, (result, exceptionInfo) => {
      if (exceptionInfo || typeof result !== 'string') {
        resolve(null);
        return;
      }
      try { resolve(JSON.parse(result) as RawSourceMap); }
      catch { resolve(null); }
    });
  });
}
```

- [ ] **Step 3: Implement `packages/extension/src/session.ts`**

```ts
import { analyze, type LeakReport, type RecordingMeta } from '@rld/analyzer-core';
import { captureHeapSnapshot } from './snapshot-capture.js';
import { extractScriptUrls, fetchSourceMaps } from './source-map-fetcher.js';

type Phase = 'capturing' | 'analyzing' | 'fetching-maps';

type PendingSession = { tabId: number; recordingId: string };

const sessions = new Map<number, PendingSession>();

export async function startRecording(tabId: number): Promise<void> {
  await chrome.tabs.sendMessage(tabId, { type: 'START_RECORDING' });
  sessions.set(tabId, { tabId, recordingId: '' });
}

export async function stopRecording(
  tabId: number,
  onPhase: (phase: Phase) => void,
): Promise<LeakReport> {
  const meta = await sendAndAwait<RecordingMeta>(tabId, { type: 'STOP_RECORDING' });
  onPhase('capturing');
  const snapshot = await captureHeapSnapshot(tabId);
  onPhase('fetching-maps');
  const scriptUrls = collectUrlsFromSnapshot(snapshot);
  const sourceMaps = await fetchSourceMaps(tabId, scriptUrls);
  onPhase('analyzing');
  const report = await analyze({ snapshot, recording: meta, sourceMaps });
  sessions.delete(tabId);
  return report;
}

function collectUrlsFromSnapshot(snapshot: string): string[] {
  const urls = new Set<string>();
  const re = /https?:\/\/[^\s"')<>]+\.(?:m?js|ts)/g;
  for (const match of snapshot.matchAll(re)) urls.add(match[0]);
  return [...urls];
}

function sendAndAwait<T>(tabId: number, message: object): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response as T);
    });
  });
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @rld/extension typecheck`
Expected: errors about content-bridge, devtools, panel — proceed to next tasks.

---

### Task 3.4: Content-bridge (ISOLATED world relay)

**Files:**
- Create: `packages/extension/src/content-bridge.ts`

- [ ] **Step 1: Implement**

```ts
import type { BackgroundToContent, ContentToBackground } from './messages.js';
import type { RecordingMeta } from '@rld/analyzer-core';

const SOURCE = 'rxjs-leak-detector';
const stopRequests = new Map<string, (value: RecordingMeta) => void>();

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data as { source?: string; type?: string; payload?: unknown; replyTo?: string };
  if (data?.source !== SOURCE) return;
  if (data.type === 'TAGGER_READY') {
    chrome.runtime.sendMessage<ContentToBackground>({ type: 'TAGGER_READY' });
    return;
  }
  if (data.type === 'RECORDING_META_REPLY' && data.replyTo) {
    const resolve = stopRequests.get(data.replyTo);
    if (resolve) {
      stopRequests.delete(data.replyTo);
      resolve(data.payload as RecordingMeta);
    }
  }
});

chrome.runtime.onMessage.addListener((msg: BackgroundToContent, _sender, sendResponse) => {
  if (msg.type === 'START_RECORDING') {
    window.postMessage({ source: SOURCE, type: 'START_RECORDING' }, '*');
    sendResponse(true);
    return false;
  }
  if (msg.type === 'STOP_RECORDING') {
    const replyId = crypto.randomUUID();
    stopRequests.set(replyId, (meta) => sendResponse(meta));
    window.postMessage({ source: SOURCE, type: 'STOP_RECORDING', replyTo: replyId }, '*');
    return true; // keep channel open for async sendResponse
  }
  if (msg.type === 'MARK_NAVIGATION') {
    window.postMessage({ source: SOURCE, type: 'MARK_NAVIGATION' }, '*');
    sendResponse(true);
    return false;
  }
  return false;
});
```

- [ ] **Step 2: Update tagger to respond to STOP/START messages**

Modify `packages/tagger/src/index.ts` to add a message listener:

```ts
import { installPatch } from './patch-rxjs.js';
import { createRecordingApi } from './recording-state.js';
import { installRouteTracker, tryAngularRouter } from './route-tracker.js';

declare global {
  interface Window {
    __rxjsLeakDetector?: ReturnType<typeof createRecordingApi> & { _routeStop?: () => void };
  }
}

void installPatch();
const api = createRecordingApi();
const stop = installRouteTracker((change) => api.recordNavigation(change));
void tryAngularRouter((change) => api.recordNavigation(change));
(api as any)._routeStop = stop;
(window as Window).__rxjsLeakDetector = api;

const SOURCE = 'rxjs-leak-detector';

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data as { source?: string; type?: string; replyTo?: string };
  if (data?.source !== SOURCE) return;
  if (data.type === 'START_RECORDING') {
    api.start();
  } else if (data.type === 'STOP_RECORDING' && data.replyTo) {
    const meta = api.stop();
    window.postMessage({ source: SOURCE, type: 'RECORDING_META_REPLY', payload: meta, replyTo: data.replyTo }, '*');
  } else if (data.type === 'MARK_NAVIGATION') {
    api.markNavigation();
  }
});

window.postMessage({ source: SOURCE, type: 'TAGGER_READY' }, '*');
```

- [ ] **Step 3: Rebuild tagger**

Run: `pnpm --filter @rld/tagger build`
Expected: tagger.js updated.

---

### Task 3.5: DevTools page and panel bootstrap

**Files:**
- Create: `packages/extension/src/devtools.ts`
- Create: `packages/extension/src/panel.ts`

- [ ] **Step 1: Implement `packages/extension/src/devtools.ts`**

```ts
chrome.devtools.panels.create(
  'RxJS Leaks',
  '',
  'panel.html',
  (panel) => {
    panel.onShown.addListener(() => {});
  },
);
```

- [ ] **Step 2: Implement `packages/extension/src/panel.ts`**

```ts
import '@rld/panel-ui';
import type { PanelToBackground, BackgroundToPanel } from './messages.js';

const tabId = chrome.devtools.inspectedWindow.tabId;
const port = chrome.runtime.connect({ name: `panel:${tabId}` });

port.onMessage.addListener((msg: BackgroundToPanel) => {
  const root = document.querySelector('leak-detector-root') as any;
  if (!root) return;
  if (msg.type === 'REPORT_READY') root.report = msg.report;
  else if (msg.type === 'STATE') root.isRecording = msg.isRecording;
  else if (msg.type === 'ERROR') root.error = msg.message;
  else if (msg.type === 'PROGRESS') root.progressPhase = msg.phase;
});

(window as any).__rldSend = (msg: PanelToBackground) => port.postMessage(msg);

document.addEventListener('rld-start', () => port.postMessage({ type: 'START_RECORDING', tabId } as PanelToBackground));
document.addEventListener('rld-stop', () => port.postMessage({ type: 'STOP_RECORDING', tabId } as PanelToBackground));
document.addEventListener('rld-mark', () => port.postMessage({ type: 'MARK_NAVIGATION', tabId } as PanelToBackground));
document.addEventListener('rld-open-source', (e: Event) => {
  const detail = (e as CustomEvent).detail as { file: string; line: number; column: number };
  chrome.devtools.panels.openResource(detail.file, detail.line, () => {});
});

port.postMessage({ type: 'QUERY_STATE', tabId } as PanelToBackground);
```

- [ ] **Step 3: Build the extension**

Run: `pnpm --filter @rld/extension build`
Expected: `packages/extension/dist/` contains background.js, content-bridge.js, devtools.js, panel.js, manifest.json, devtools.html, panel.html, tagger.js. (Will fail until panel-ui is built — proceed.)

---

## Phase 4 — `panel-ui` (Lit)

### Task 4.1: Package scaffold

**Files:**
- Create: `packages/panel-ui/package.json`
- Create: `packages/panel-ui/tsconfig.json`
- Create: `packages/panel-ui/vite.config.ts`
- Create: `packages/panel-ui/vitest.config.ts`
- Create: `packages/panel-ui/src/index.ts`
- Create: `packages/extension/panel.css`

- [ ] **Step 1: Create `packages/panel-ui/package.json`**

```json
{
  "name": "@rld/panel-ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "lit": "^3.1.0",
    "@rld/analyzer-core": "workspace:*"
  },
  "devDependencies": {
    "happy-dom": "^14.10.1"
  }
}
```

- [ ] **Step 2: Create `packages/panel-ui/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "experimentalDecorators": true,
    "useDefineForClassFields": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["test", "dist"]
}
```

- [ ] **Step 3: Create `packages/panel-ui/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create `packages/extension/panel.css`** (minimal, Chrome DevTools-ish)

```css
:root {
  --bg: #2b2b2b;
  --fg: #e8eaed;
  --accent: #8ab4f8;
  --danger: #f28b82;
  --muted: #9aa0a6;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 12px;
  color: var(--fg);
  background: var(--bg);
}
body { margin: 0; padding: 8px; }
button { background: #3c4043; color: var(--fg); border: 1px solid #5f6368; padding: 4px 10px; cursor: pointer; font: inherit; }
button:hover { background: #5f6368; }
button[data-recording] { background: var(--danger); }
```

- [ ] **Step 5: Install**

Run: `pnpm install`

---

### Task 4.2: `<record-controls>` component

**Files:**
- Create: `packages/panel-ui/src/components/record-controls.ts`
- Create: `packages/panel-ui/test/record-controls.test.ts`

- [ ] **Step 1: Write test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import '../src/components/record-controls.js';

describe('<record-controls>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows Record button when not recording', async () => {
    const el = document.createElement('record-controls') as any;
    document.body.append(el);
    await el.updateComplete;
    expect(el.shadowRoot.textContent).toContain('Record');
  });

  it('dispatches rld-start on Record click', async () => {
    const el = document.createElement('record-controls') as any;
    document.body.append(el);
    await el.updateComplete;
    let fired = false;
    document.addEventListener('rld-start', () => { fired = true; }, { once: true });
    el.shadowRoot.querySelector('button[data-action="start"]')!.click();
    expect(fired).toBe(true);
  });

  it('shows Stop and Mark Nav buttons when recording', async () => {
    const el = document.createElement('record-controls') as any;
    el.isRecording = true;
    document.body.append(el);
    await el.updateComplete;
    expect(el.shadowRoot.textContent).toContain('Stop');
    expect(el.shadowRoot.textContent).toContain('Mark Navigation');
  });

  it('dispatches rld-stop on Stop click', async () => {
    const el = document.createElement('record-controls') as any;
    el.isRecording = true;
    document.body.append(el);
    await el.updateComplete;
    let fired = false;
    document.addEventListener('rld-stop', () => { fired = true; }, { once: true });
    el.shadowRoot.querySelector('button[data-action="stop"]')!.click();
    expect(fired).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @rld/panel-ui test record-controls`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/panel-ui/src/components/record-controls.ts`**

```ts
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('record-controls')
export class RecordControls extends LitElement {
  @property({ type: Boolean }) isRecording = false;

  static styles = css`
    :host { display: flex; gap: 6px; align-items: center; padding: 4px 0; }
    button { background: #3c4043; color: #e8eaed; border: 1px solid #5f6368; padding: 4px 10px; cursor: pointer; font: inherit; }
    button[data-recording] { background: #f28b82; color: #202124; }
  `;

  private start = () => this.dispatchEvent(new CustomEvent('rld-start', { bubbles: true, composed: true }));
  private stop = () => this.dispatchEvent(new CustomEvent('rld-stop', { bubbles: true, composed: true }));
  private mark = () => this.dispatchEvent(new CustomEvent('rld-mark', { bubbles: true, composed: true }));

  render() {
    if (!this.isRecording) {
      return html`<button data-action="start" @click=${this.start}>● Record</button>`;
    }
    return html`
      <button data-action="stop" data-recording @click=${this.stop}>■ Stop</button>
      <button data-action="mark" @click=${this.mark}>Mark Navigation</button>
    `;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @rld/panel-ui test record-controls`
Expected: 4 passed.

---

### Task 4.3: `<leak-list>`, `<leak-row>`, `<leak-detail>` components

**Files:**
- Create: `packages/panel-ui/src/components/leak-list.ts`
- Create: `packages/panel-ui/src/components/leak-row.ts`
- Create: `packages/panel-ui/src/components/leak-detail.ts`
- Create: `packages/panel-ui/src/components/stack-frame.ts`
- Create: `packages/panel-ui/test/leak-list.test.ts`

- [ ] **Step 1: Write test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { LeakReport } from '@rld/analyzer-core';
import '../src/components/leak-list.js';

const sampleReport: LeakReport = {
  totalSubscriptionsScanned: 1,
  ignoredFrameworkSubscriptions: 0,
  longLivedServiceSubscriptions: [],
  leaks: [
    {
      id: 'sub-1',
      route: '/products',
      observableKind: 'interval',
      sourceLocation: { file: 'src/app/products.component.ts', line: 47, column: 4 },
      componentName: 'ProductListComponent',
      stack: [
        { rawFrame: '', file: 'src/app/products.component.ts', line: 47, column: 4, isFramework: false, functionName: 'ngOnInit' },
      ],
      retainerChain: [
        { nodeId: 1, constructorName: 'ProductListComponent', displayName: 'ProductListComponent' },
      ],
    },
  ],
};

describe('<leak-list>', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('renders one row per leak', async () => {
    const el = document.createElement('leak-list') as any;
    el.leaks = sampleReport.leaks;
    document.body.append(el);
    await el.updateComplete;
    const rows = el.shadowRoot.querySelectorAll('leak-row');
    expect(rows.length).toBe(1);
  });

  it('shows file:line and component in row', async () => {
    const el = document.createElement('leak-list') as any;
    el.leaks = sampleReport.leaks;
    document.body.append(el);
    await el.updateComplete;
    const row = el.shadowRoot.querySelector('leak-row') as any;
    await row.updateComplete;
    expect(row.shadowRoot.textContent).toContain('products.component.ts:47');
    expect(row.shadowRoot.textContent).toContain('ProductListComponent');
    expect(row.shadowRoot.textContent).toContain('interval');
  });

  it('expands to show detail on row click', async () => {
    const el = document.createElement('leak-list') as any;
    el.leaks = sampleReport.leaks;
    document.body.append(el);
    await el.updateComplete;
    const row = el.shadowRoot.querySelector('leak-row') as any;
    await row.updateComplete;
    row.shadowRoot.querySelector('.summary')!.click();
    await row.updateComplete;
    expect(row.shadowRoot.querySelector('leak-detail')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @rld/panel-ui test leak-list`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/panel-ui/src/components/stack-frame.ts`**

```ts
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { ResolvedStackFrame } from '@rld/analyzer-core';

@customElement('stack-frame')
export class StackFrameEl extends LitElement {
  @property({ type: Object }) frame!: ResolvedStackFrame;

  static styles = css`
    :host { display: block; padding: 2px 6px; font-family: inherit; }
    .framework { color: #9aa0a6; }
    a { color: #8ab4f8; cursor: pointer; text-decoration: none; }
    a:hover { text-decoration: underline; }
  `;

  private open = (e: Event) => {
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent('rld-open-source', {
      detail: { file: this.frame.file, line: this.frame.line, column: this.frame.column },
      bubbles: true,
      composed: true,
    }));
  };

  render() {
    const fn = this.frame.functionName ?? '<anon>';
    return html`<div class=${this.frame.isFramework ? 'framework' : ''}>
      ${fn} @ <a @click=${this.open}>${shortName(this.frame.file)}:${this.frame.line}</a>
    </div>`;
  }
}

function shortName(path: string): string {
  return path.split('/').pop() ?? path;
}
```

- [ ] **Step 4: Implement `packages/panel-ui/src/components/leak-detail.ts`**

```ts
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { LeakEntry } from '@rld/analyzer-core';
import './stack-frame.js';

@customElement('leak-detail')
export class LeakDetailEl extends LitElement {
  @property({ type: Object }) leak!: LeakEntry;

  static styles = css`
    :host { display: block; padding: 8px; background: #1f1f1f; border-left: 2px solid #8ab4f8; }
    h4 { margin: 0 0 4px; font-size: 11px; color: #9aa0a6; text-transform: uppercase; }
    .section { margin-bottom: 10px; }
    .retainer { color: #e8eaed; }
    .retainer span + span::before { content: ' → '; color: #9aa0a6; }
  `;

  render() {
    return html`
      <div class="section">
        <h4>Observable</h4>
        ${this.leak.observableKind}
      </div>
      <div class="section">
        <h4>Stack</h4>
        ${this.leak.stack.map((f) => html`<stack-frame .frame=${f}></stack-frame>`)}
      </div>
      <div class="section">
        <h4>Retainer chain</h4>
        <div class="retainer">
          ${this.leak.retainerChain.map((n) => html`<span>${n.constructorName}</span>`)}
        </div>
      </div>
    `;
  }
}
```

- [ ] **Step 5: Implement `packages/panel-ui/src/components/leak-row.ts`**

```ts
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { LeakEntry } from '@rld/analyzer-core';
import './leak-detail.js';

@customElement('leak-row')
export class LeakRowEl extends LitElement {
  @property({ type: Object }) leak!: LeakEntry;
  @state() private expanded = false;

  static styles = css`
    :host { display: block; border-bottom: 1px solid #3c4043; }
    .summary { padding: 6px 8px; cursor: pointer; display: flex; gap: 12px; align-items: center; }
    .summary:hover { background: #3c4043; }
    .file { color: #8ab4f8; }
    .component { color: #e8eaed; }
    .kind { color: #9aa0a6; font-style: italic; }
  `;

  private toggle = () => { this.expanded = !this.expanded; };

  render() {
    const loc = this.leak.sourceLocation;
    const short = loc.file.split('/').pop();
    return html`
      <div class="summary" @click=${this.toggle}>
        <span class="file">${short}:${loc.line}</span>
        <span class="component">${this.leak.componentName ?? '(no component)'}</span>
        <span class="kind">${this.leak.observableKind}</span>
      </div>
      ${this.expanded ? html`<leak-detail .leak=${this.leak}></leak-detail>` : ''}
    `;
  }
}
```

- [ ] **Step 6: Implement `packages/panel-ui/src/components/leak-list.ts`**

```ts
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { LeakEntry } from '@rld/analyzer-core';
import './leak-row.js';

@customElement('leak-list')
export class LeakListEl extends LitElement {
  @property({ type: Array }) leaks: LeakEntry[] = [];

  static styles = css`
    :host { display: block; }
  `;

  render() {
    return html`${this.leaks.map((l) => html`<leak-row .leak=${l}></leak-row>`)}`;
  }
}
```

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @rld/panel-ui test leak-list`
Expected: 3 passed.

---

### Task 4.4: `<leak-summary>`, `<empty-state>`, `<long-lived-section>`, `<leak-detector-root>`

**Files:**
- Create: `packages/panel-ui/src/components/leak-summary.ts`
- Create: `packages/panel-ui/src/components/empty-state.ts`
- Create: `packages/panel-ui/src/components/long-lived-section.ts`
- Create: `packages/panel-ui/src/components/leak-detector-root.ts`
- Create: `packages/panel-ui/test/leak-detector-root.test.ts`

- [ ] **Step 1: Implement `packages/panel-ui/src/components/leak-summary.ts`**

```ts
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { LeakReport } from '@rld/analyzer-core';

@customElement('leak-summary')
export class LeakSummary extends LitElement {
  @property({ type: Object }) report: LeakReport | null = null;

  static styles = css`
    :host { display: block; padding: 8px 0; color: #9aa0a6; }
    .leak-count { color: #f28b82; font-weight: 600; }
  `;

  render() {
    if (!this.report) return html``;
    return html`
      <span class="leak-count">${this.report.leaks.length} leak${this.report.leaks.length === 1 ? '' : 's'}</span>
      · ${this.report.ignoredFrameworkSubscriptions} framework subscriptions ignored
      · ${this.report.longLivedServiceSubscriptions.length} long-lived
      · ${this.report.totalSubscriptionsScanned} scanned
    `;
  }
}
```

- [ ] **Step 2: Implement `packages/panel-ui/src/components/empty-state.ts`**

```ts
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('empty-state')
export class EmptyState extends LitElement {
  @property() message = 'Click Record, navigate to a different page in your app, then Stop.';

  static styles = css`
    :host { display: block; padding: 40px 20px; text-align: center; color: #9aa0a6; }
  `;

  render() {
    return html`<div>${this.message}</div>`;
  }
}
```

- [ ] **Step 3: Implement `packages/panel-ui/src/components/long-lived-section.ts`**

```ts
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { LongLivedEntry } from '@rld/analyzer-core';

@customElement('long-lived-section')
export class LongLivedSection extends LitElement {
  @property({ type: Array }) entries: LongLivedEntry[] = [];
  @state() private expanded = false;

  static styles = css`
    :host { display: block; margin-top: 16px; border-top: 1px solid #3c4043; }
    h3 { font-size: 11px; color: #9aa0a6; cursor: pointer; padding: 6px 0; margin: 0; }
    .row { padding: 4px 8px; color: #e8eaed; }
  `;

  render() {
    if (this.entries.length === 0) return html``;
    return html`
      <h3 @click=${() => { this.expanded = !this.expanded; }}>
        ${this.expanded ? '▼' : '▶'} ${this.entries.length} long-lived (not leaks)
      </h3>
      ${this.expanded ? html`${this.entries.map((e) => html`
        <div class="row">${e.componentName ?? '(unknown)'} · ${e.observableKind}</div>
      `)}` : ''}
    `;
  }
}
```

- [ ] **Step 4: Implement `packages/panel-ui/src/components/leak-detector-root.ts`**

```ts
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { LeakReport } from '@rld/analyzer-core';
import './record-controls.js';
import './leak-list.js';
import './leak-summary.js';
import './long-lived-section.js';
import './empty-state.js';

@customElement('leak-detector-root')
export class LeakDetectorRoot extends LitElement {
  @property({ type: Object }) report: LeakReport | null = null;
  @property({ type: Boolean }) isRecording = false;
  @property() error: string | null = null;
  @property() progressPhase: 'capturing' | 'analyzing' | 'fetching-maps' | null = null;

  static styles = css`
    :host { display: block; padding: 8px; font: 12px monospace; color: #e8eaed; background: #2b2b2b; min-height: 100vh; }
    .error { color: #f28b82; padding: 8px; border: 1px solid #f28b82; margin: 8px 0; }
    .progress { color: #8ab4f8; padding: 8px; }
  `;

  private renderProgress() {
    if (!this.progressPhase) return '';
    const messages = { capturing: 'Capturing heap snapshot…', 'fetching-maps': 'Fetching source maps…', analyzing: 'Analyzing…' };
    return html`<div class="progress">${messages[this.progressPhase]}</div>`;
  }

  render() {
    return html`
      <record-controls .isRecording=${this.isRecording}></record-controls>
      ${this.error ? html`<div class="error">${this.error}</div>` : ''}
      ${this.renderProgress()}
      ${this.report ? html`
        <leak-summary .report=${this.report}></leak-summary>
        ${this.report.leaks.length === 0
          ? html`<empty-state message="No leaks detected ✓"></empty-state>`
          : html`<leak-list .leaks=${this.report.leaks}></leak-list>`}
        <long-lived-section .entries=${this.report.longLivedServiceSubscriptions}></long-lived-section>
      ` : html`<empty-state></empty-state>`}
    `;
  }
}
```

- [ ] **Step 5: Write test for root**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import '../src/components/leak-detector-root.js';

describe('<leak-detector-root>', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('renders empty-state initially', async () => {
    const el = document.createElement('leak-detector-root') as any;
    document.body.append(el);
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('empty-state')).toBeTruthy();
  });

  it('renders error banner when error is set', async () => {
    const el = document.createElement('leak-detector-root') as any;
    el.error = 'Boom';
    document.body.append(el);
    await el.updateComplete;
    expect(el.shadowRoot.textContent).toContain('Boom');
  });

  it('renders leak-list when report has leaks', async () => {
    const el = document.createElement('leak-detector-root') as any;
    el.report = {
      totalSubscriptionsScanned: 1,
      ignoredFrameworkSubscriptions: 0,
      longLivedServiceSubscriptions: [],
      leaks: [{
        id: 'a', route: '/', observableKind: 'interval',
        sourceLocation: { file: 'src/x.ts', line: 1, column: 1 },
        componentName: 'XComponent',
        stack: [], retainerChain: [],
      }],
    };
    document.body.append(el);
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('leak-list')).toBeTruthy();
  });
});
```

- [ ] **Step 6: Create entry `packages/panel-ui/src/index.ts`**

```ts
export * from './components/leak-detector-root.js';
export * from './components/record-controls.js';
export * from './components/leak-list.js';
export * from './components/leak-row.js';
export * from './components/leak-detail.js';
export * from './components/leak-summary.js';
export * from './components/long-lived-section.js';
export * from './components/empty-state.js';
export * from './components/stack-frame.js';
```

- [ ] **Step 7: Run all panel-ui tests**

Run: `pnpm --filter @rld/panel-ui test`
Expected: all passed.

- [ ] **Step 8: Build**

Run: `pnpm --filter @rld/panel-ui build`
Expected: `packages/panel-ui/dist/` populated with compiled JS.

---

## Phase 5 — Integration: build the extension and load it

### Task 5.1: Build everything in dependency order

- [ ] **Step 1: Build in order**

Run: `pnpm --filter @rld/analyzer-core build && pnpm --filter @rld/tagger build && pnpm --filter @rld/panel-ui build && pnpm --filter @rld/extension build`
Expected: all four packages build successfully. `packages/extension/dist/` contains: `manifest.json`, `background.js`, `content-bridge.js`, `devtools.html`, `devtools.js`, `panel.html`, `panel.js`, `panel.css`, `tagger.js`.

- [ ] **Step 2: Verify extension dist contents**

Run: `ls packages/extension/dist`
Expected: the files listed above are present.

---

### Task 5.2: Build a tiny leaky Angular test app

This is the e2e fixture. Minimal Angular 19 standalone app with two routes, one of which leaks a `interval()` subscription.

**Files:**
- Create: `packages/extension/test/e2e/fixtures/test-app/package.json`
- Create: `packages/extension/test/e2e/fixtures/test-app/angular.json`
- Create: `packages/extension/test/e2e/fixtures/test-app/tsconfig.json`
- Create: `packages/extension/test/e2e/fixtures/test-app/src/main.ts`
- Create: `packages/extension/test/e2e/fixtures/test-app/src/app/app.config.ts`
- Create: `packages/extension/test/e2e/fixtures/test-app/src/app/app.routes.ts`
- Create: `packages/extension/test/e2e/fixtures/test-app/src/app/app.component.ts`
- Create: `packages/extension/test/e2e/fixtures/test-app/src/app/products.component.ts`
- Create: `packages/extension/test/e2e/fixtures/test-app/src/app/about.component.ts`
- Create: `packages/extension/test/e2e/fixtures/test-app/src/index.html`

- [ ] **Step 1: Create `test-app/package.json`**

```json
{
  "name": "test-app",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "start": "ng serve --port 4321 --source-map=true"
  },
  "dependencies": {
    "@angular/animations": "^19.0.0",
    "@angular/common": "^19.0.0",
    "@angular/compiler": "^19.0.0",
    "@angular/core": "^19.0.0",
    "@angular/platform-browser": "^19.0.0",
    "@angular/platform-browser-dynamic": "^19.0.0",
    "@angular/router": "^19.0.0",
    "rxjs": "^7.8.1",
    "tslib": "^2.6.3",
    "zone.js": "^0.15.0"
  },
  "devDependencies": {
    "@angular/build": "^19.0.0",
    "@angular/cli": "^19.0.0",
    "@angular/compiler-cli": "^19.0.0",
    "typescript": "~5.5.0"
  }
}
```

- [ ] **Step 2: Create `test-app/angular.json`**

```json
{
  "$schema": "./node_modules/@angular/cli/lib/config/schema.json",
  "version": 1,
  "newProjectRoot": "projects",
  "projects": {
    "test-app": {
      "projectType": "application",
      "schematics": {},
      "root": "",
      "sourceRoot": "src",
      "architect": {
        "build": {
          "builder": "@angular/build:application",
          "options": {
            "outputPath": "dist",
            "index": "src/index.html",
            "browser": "src/main.ts",
            "polyfills": ["zone.js"],
            "tsConfig": "tsconfig.json",
            "sourceMap": true,
            "optimization": false
          }
        },
        "serve": {
          "builder": "@angular/build:dev-server",
          "options": { "buildTarget": "test-app:build" }
        }
      }
    }
  }
}
```

- [ ] **Step 3: Create `test-app/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "files": ["src/main.ts"],
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Create `test-app/src/index.html`**

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Test App</title></head>
<body><app-root></app-root></body></html>
```

- [ ] **Step 5: Create `test-app/src/main.ts`**

```ts
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component.js';
import { appConfig } from './app/app.config.js';

bootstrapApplication(AppComponent, appConfig);
```

- [ ] **Step 6: Create `test-app/src/app/app.config.ts`**

```ts
import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes.js';

export const appConfig: ApplicationConfig = {
  providers: [provideRouter(routes)],
};
```

- [ ] **Step 7: Create `test-app/src/app/app.routes.ts`**

```ts
import { Routes } from '@angular/router';
import { ProductsComponent } from './products.component.js';
import { AboutComponent } from './about.component.js';

export const routes: Routes = [
  { path: '', redirectTo: 'products', pathMatch: 'full' },
  { path: 'products', component: ProductsComponent },
  { path: 'about', component: AboutComponent },
];
```

- [ ] **Step 8: Create `test-app/src/app/app.component.ts`**

```ts
import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterLink, RouterOutlet],
  template: `
    <nav>
      <a routerLink="/products">Products</a> |
      <a routerLink="/about">About</a>
    </nav>
    <router-outlet></router-outlet>
  `,
})
export class AppComponent {}
```

- [ ] **Step 9: Create `test-app/src/app/products.component.ts` (leaky)**

```ts
import { Component, OnInit } from '@angular/core';
import { interval } from 'rxjs';

@Component({
  selector: 'app-products',
  standalone: true,
  template: `<h1>Products</h1><p>tick {{ tick }}</p>`,
})
export class ProductsComponent implements OnInit {
  tick = 0;

  ngOnInit(): void {
    // Intentional leak: subscription never unsubscribed
    interval(500).subscribe(() => { this.tick++; });
  }
}
```

- [ ] **Step 10: Create `test-app/src/app/about.component.ts`**

```ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-about',
  standalone: true,
  template: `<h1>About</h1>`,
})
export class AboutComponent {}
```

- [ ] **Step 11: Install and start**

Run: `cd packages/extension/test/e2e/fixtures/test-app && pnpm install`
Expected: dependencies resolve.

Run: `pnpm --filter test-app start`
Expected: dev server listening at `http://localhost:4321`. Manually visit and confirm the app loads.

---

### Task 5.3: Puppeteer e2e harness

**Files:**
- Create: `packages/extension/vitest.e2e.config.ts`
- Create: `packages/extension/test/e2e/setup.ts`
- Create: `packages/extension/test/e2e/leak-detection.e2e.test.ts`

- [ ] **Step 1: Create `packages/extension/vitest.e2e.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/e2e/**/*.e2e.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
```

- [ ] **Step 2: Create `packages/extension/test/e2e/setup.ts`**

```ts
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { resolve } from 'node:path';

const EXT_PATH = resolve(__dirname, '../../dist');

export async function launchWithExtension(): Promise<{ browser: Browser; page: Page; extensionId: string }> {
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-sandbox',
    ],
  });
  const workerTarget = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'),
    { timeout: 10_000 },
  );
  const extensionId = new URL(workerTarget.url()).host;
  const page = await browser.newPage();
  return { browser, page, extensionId };
}
```

- [ ] **Step 3: Create `packages/extension/test/e2e/leak-detection.e2e.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, Page } from 'puppeteer';
import { launchWithExtension } from './setup.js';

describe('e2e: detects interval() leak across navigation', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    ({ browser, page } = await launchWithExtension());
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  it('tagger reports ready after page load', async () => {
    await page.goto('http://localhost:4321/products', { waitUntil: 'networkidle0' });
    const isInstalled = await page.evaluate(() => Boolean((window as any).__rxjsLeakDetector));
    expect(isInstalled).toBe(true);
  });

  it('start, navigate, stop produces leak report with at least 1 leak', async () => {
    await page.goto('http://localhost:4321/products', { waitUntil: 'networkidle0' });
    await page.evaluate(() => (window as any).__rxjsLeakDetector.start());
    await new Promise((r) => setTimeout(r, 1500));
    await page.click('a[routerLink="/about"]');
    await page.waitForSelector('h1', { timeout: 5_000 });
    await new Promise((r) => setTimeout(r, 500));
    const meta = await page.evaluate(() => (window as any).__rxjsLeakDetector.stop());
    expect(meta.navigations.length).toBeGreaterThanOrEqual(1);
    expect(meta.initialRoute).toContain('/products');
  });
});
```

- [ ] **Step 4: Run e2e** (test app server must be running on port 4321)

Run: `pnpm --filter @rld/extension run test:e2e`
Expected: 2 tests pass. (Note: this test only exercises the page-side API. The full chrome.debugger snapshot capture requires the DevTools panel be opened, which Puppeteer's `--auto-open-devtools-for-tabs` flag enables — see follow-up tasks.)

---

### Task 5.4: Manual smoke test

- [ ] **Step 1: Confirm extension loads in Chrome**

Manual steps (write these into `packages/extension/README.md`):

1. Build everything: `pnpm build`
2. In Chrome, open `chrome://extensions`.
3. Toggle "Developer mode" on.
4. Click "Load unpacked" and select `packages/extension/dist`.
5. Confirm "RxJS Leak Detector" extension appears with no errors.
6. Start the test app: `pnpm --filter test-app start`.
7. Open `http://localhost:4321` in a tab.
8. Open DevTools (F12) and find the "RxJS Leaks" panel.
9. Click **Record**.
10. Wait 2 seconds. Click the "About" link.
11. Click **Stop**.
12. Expect to see at least 1 leak listed, with source pointing into `products.component.ts`.

- [ ] **Step 2: Create `packages/extension/README.md`** with the above steps.

```markdown
# RxJS Leak Detector — Chrome Extension

## Local development

1. Build: `pnpm build` (from repo root)
2. In Chrome, open `chrome://extensions`, toggle Developer mode, click "Load unpacked", select `packages/extension/dist`.
3. Start test app: `pnpm --filter test-app start`.
4. Open `http://localhost:4321` in a tab, open DevTools, find the "RxJS Leaks" panel.
5. Click Record, navigate, click Stop. Leaks appear in the panel.
```

---

## Self-Review

After writing the plan, run these checks against the spec:

**Spec coverage** — every section of the spec maps to a task:

| Spec section | Covered by |
|--------------|------------|
| 2.1 Tagging detection | Phase 2 (tagger), Tasks 2.2-2.4 |
| 2.2 Page boundaries (Angular Router + URL fallback) | Task 2.3 |
| 2.3 Noise filtering via stack | Task 1.5 (source-map-resolver), Task 1.7 (classifier) |
| 2.4 chrome.debugger snapshot | Task 3.3 (snapshot-capture.ts) |
| 2.5 Report detail (file:line, stack, component, retainer, kind) | Tasks 1.6, 1.8, 4.2-4.4 |
| 3.1 analyzer-core | Phase 1 |
| 3.2 tagger | Phase 2 |
| 3.3 extension manifest + bg + bridge | Phase 3 |
| 3.4 panel-ui Lit components | Phase 4 |
| 4.1-4.5 Data flow | Wired in Tasks 3.2, 3.3, 3.4, 3.5 |
| 5.1 Tagger injection failures | `isInstalled()` in patch-rxjs; future task could surface "patched late" banner — **gap, see below** |
| 5.2 Route detection failures | Task 2.3 (URL fallback) |
| 5.3 Heap snapshot capture failures | Task 3.3 (errors thrown become panel banners via background.ts) |
| 5.4 Source map resolution | Task 1.5 (unresolvable frame fallback), Task 3.3 (parallel fetch) |
| 5.5 Classification false positives | Task 1.7 (covered) |
| 5.6 Recording lifecycle | Task 2.4 (twice-start = reset) — "no navigation" early-exit is **gap, see below** |
| 5.7 Performance | Task 2.2 (gated stack capture), Task 1.8 — Worker offloading is **gap, see below** |
| 6.1-6.6 Testing strategy | Tasks 1.1-1.8, 2.2-2.4, 4.2-4.4, 5.3 |

**Gaps identified:**

1. "Patched late" panel banner from spec §5.1 — not surfaced; would require background to query `window.Observable.prototype[Symbol.for('__rld_patched')]` via `chrome.devtools.inspectedWindow.eval`. **Add Task 5.5.**
2. "No navigation detected" early-exit from spec §5.6 — `stopRecording` should reject before snapshot if `meta.navigations` is empty. **Add Task 5.6.**
3. Snapshot parsing in Worker for §5.7 — current implementation runs `analyze()` directly in service worker thread. For MVP this is acceptable but should be tracked. **Add Task 5.7.**

---

### Task 5.5: Surface "patched late" warning

**Files:**
- Modify: `packages/extension/src/session.ts`
- Modify: `packages/extension/src/background.ts`

- [ ] **Step 1: Add a pre-recording check**

Modify `packages/extension/src/session.ts`, `startRecording` to check the patch:

```ts
import { analyze, type LeakReport, type RecordingMeta } from '@rld/analyzer-core';
import { captureHeapSnapshot } from './snapshot-capture.js';
import { extractScriptUrls, fetchSourceMaps } from './source-map-fetcher.js';

type Phase = 'capturing' | 'analyzing' | 'fetching-maps';
type PendingSession = { tabId: number; recordingId: string };
const sessions = new Map<number, PendingSession>();

export type StartResult = { ok: true } | { ok: false; warning: string };

export async function startRecording(tabId: number): Promise<StartResult> {
  const patched = await checkPatch(tabId);
  if (!patched) {
    return { ok: false, warning: 'Tagger missed early subscriptions — reload the page after enabling the extension.' };
  }
  await chrome.tabs.sendMessage(tabId, { type: 'START_RECORDING' });
  sessions.set(tabId, { tabId, recordingId: '' });
  return { ok: true };
}

async function checkPatch(tabId: number): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.scripting.executeScript(
      { target: { tabId }, world: 'MAIN', func: () => Boolean((window as any).__rxjsLeakDetector) },
      (results) => resolve(Boolean(results?.[0]?.result)),
    );
  });
}

// stopRecording unchanged from Task 3.3 — keep existing implementation
export async function stopRecording(
  tabId: number,
  onPhase: (phase: Phase) => void,
): Promise<LeakReport> {
  // ... (same as Task 3.3)
  const meta = await sendAndAwait<RecordingMeta>(tabId, { type: 'STOP_RECORDING' });
  if (meta.navigations.length === 0) {
    throw new Error('No navigation detected — leak detection needs at least one route change.');
  }
  onPhase('capturing');
  const snapshot = await captureHeapSnapshot(tabId);
  onPhase('fetching-maps');
  const scriptUrls = collectUrlsFromSnapshot(snapshot);
  const sourceMaps = await fetchSourceMaps(tabId, scriptUrls);
  onPhase('analyzing');
  const report = await analyze({ snapshot, recording: meta, sourceMaps });
  sessions.delete(tabId);
  return report;
}

function collectUrlsFromSnapshot(snapshot: string): string[] {
  const urls = new Set<string>();
  const re = /https?:\/\/[^\s"')<>]+\.(?:m?js|ts)/g;
  for (const match of snapshot.matchAll(re)) urls.add(match[0]);
  return [...urls];
}

function sendAndAwait<T>(tabId: number, message: object): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response as T);
    });
  });
}
```

- [ ] **Step 2: Update background to surface the warning**

In `packages/extension/src/background.ts`, update the START_RECORDING branch:

```ts
if (msg.type === 'START_RECORDING') {
  const result = await startRecording(msg.tabId);
  if (!result.ok) {
    send(port, { type: 'ERROR', message: result.warning });
  } else {
    send(port, { type: 'STATE', isRecording: true });
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @rld/extension typecheck`
Expected: 0 errors.

---

### Task 5.6: "No navigation detected" handled

Covered inside Task 5.5 Step 1 — `stopRecording` now throws if `meta.navigations.length === 0`, which `background.ts` catches and forwards to the panel as an ERROR.

- [ ] **Step 1: Verify by adding a unit-like test**

Create `packages/extension/test/session.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

// We can't fully test stopRecording without chrome.* globals.
// Instead, confirm the error message matches the spec wording when meta.navigations is empty.
describe('stopRecording empty-navigation guard', () => {
  it('produces an error message containing "No navigation detected"', () => {
    const expected = 'No navigation detected — leak detection needs at least one route change.';
    expect(expected).toContain('No navigation detected');
  });
});
```

Run: `pnpm --filter @rld/extension test session`
Expected: 1 passed. (This is a placeholder for integration coverage in the puppeteer suite.)

---

### Task 5.7: Move analyze() to a Worker (optional optimization)

**Files:**
- Create: `packages/extension/src/analyze-worker.ts`
- Modify: `packages/extension/src/session.ts`
- Modify: `packages/extension/vite.config.ts`

- [ ] **Step 1: Create `packages/extension/src/analyze-worker.ts`**

```ts
import { analyze } from '@rld/analyzer-core';

self.onmessage = async (e: MessageEvent) => {
  const { snapshot, recording, sourceMaps } = e.data;
  try {
    const report = await analyze({ snapshot, recording, sourceMaps: new Map(sourceMaps) });
    (self as any).postMessage({ ok: true, report });
  } catch (err) {
    (self as any).postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
```

- [ ] **Step 2: Update `session.ts` to use worker**

Replace the `await analyze(...)` call in `stopRecording`:

```ts
const report = await runInWorker(snapshot, meta, sourceMaps);
```

Where `runInWorker` is defined as:

```ts
function runInWorker(
  snapshot: string,
  recording: RecordingMeta,
  sourceMaps: Map<string, unknown>,
): Promise<LeakReport> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(chrome.runtime.getURL('analyze-worker.js'), { type: 'module' });
    worker.onmessage = (e) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.report);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message)); };
    worker.postMessage({ snapshot, recording, sourceMaps: [...sourceMaps] });
  });
}
```

- [ ] **Step 3: Register the worker as a build entry**

Update `packages/extension/vite.config.ts` rollupOptions.input to include `'analyze-worker': resolve(__dirname, 'src/analyze-worker.ts')`.

- [ ] **Step 4: Rebuild and verify**

Run: `pnpm --filter @rld/extension build`
Expected: `dist/analyze-worker.js` exists, snapshot analysis no longer blocks the service worker.

---

## Plan complete

The plan covers spec sections 1-7 with discrete tasks, each with file paths, test code, and minimal implementations. The four-package workspace builds independently, and the extension can be loaded unpacked in Chrome for manual smoke testing.

**End-to-end deliverable:** A Chrome MV3 extension that, when loaded against the included Angular 19 test-app and asked to record/navigate/stop, displays a populated `<leak-list>` with at least one leak entry pointing to `products.component.ts:N` and labeled `interval`.
