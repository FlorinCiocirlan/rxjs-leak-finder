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
