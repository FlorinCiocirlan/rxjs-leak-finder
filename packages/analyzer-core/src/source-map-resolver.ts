import { SourceMapConsumer, type RawSourceMap } from 'source-map';
import type { ResolvedStackFrame } from './types.js';

const FRAMEWORK_PATTERNS = [
  /(?:^|\/)node_modules\//,
  /webpack[-/]runtime/,
  /^webpack:\/\/\/runtime\//,
];

// Heuristics for unresolved bundle URLs (when source maps are unavailable).
// Vite pre-bundles all dependencies under `/vite/deps/` and ships polyfills
// as `polyfills-*.js`, `runtime-*.js`, etc. Anything else under the dev server
// root is treated as user code.
const FRAMEWORK_URL_PATTERNS = [
  /\/vite\/deps\//,
  /\/polyfills[-.]/,
  /\/runtime[-.]/,
  /\/zone\.js/,
  /^webpack:/,
];

const FRAME_REGEX = /at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;

function isFrameworkPath(path: string): boolean {
  return FRAMEWORK_PATTERNS.some((p) => p.test(path));
}

function isFrameworkUrl(url: string): boolean {
  return FRAMEWORK_URL_PATTERNS.some((p) => p.test(url));
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
      // Try to find a consumer for this URL, accounting for query strings
      // (Vite appends `?v=hash` for cache-busting).
      const baseUrl = url.split('?')[0]!;
      const consumer = consumers.get(url) ?? consumers.get(baseUrl);
      if (!consumer) {
        frames.push({
          rawFrame: trimmed,
          file: url,
          line: lineNo,
          column: colNo,
          isFramework: isFrameworkUrl(url),
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
