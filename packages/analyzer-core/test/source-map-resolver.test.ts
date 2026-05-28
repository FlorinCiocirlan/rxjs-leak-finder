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

  it('keeps raw path for unresolvable frames and defaults to user code', async () => {
    const stack = 'Error\n    at mystery (http://elsewhere/unknown.js:5:5)';
    const frames = await resolveStack(stack, new Map());
    expect(frames).toHaveLength(1);
    expect(frames[0]!.file).toBe('http://elsewhere/unknown.js');
    // Without a source map, only known framework URL patterns (e.g.
    // /vite/deps/, polyfills-*, zone.js) are flagged as framework; arbitrary
    // unresolved URLs are treated as user code.
    expect(frames[0]!.isFramework).toBe(false);
  });

  it('flags unresolved frames as framework when URL matches a vendor pattern', async () => {
    const stack = 'Error\n    at boot (http://localhost:4200/vite/deps/rxjs.js?v=abc:1:0)';
    const frames = await resolveStack(stack, new Map());
    expect(frames[0]!.isFramework).toBe(true);
  });
});
