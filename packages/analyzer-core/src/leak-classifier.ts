import type { LeakKind, ResolvedStackFrame } from './types.js';

/**
 * Single source of truth for the heuristics that turn a raw subscribe stack
 * into a human-friendly leak kind and a component name. Used by both the
 * heap-snapshot analyzer (analyze.ts) and the in-browser dashboard.
 */

const COMPONENT_NAME_RE = /\b_?([A-Z]\w*?(?:Component|Directive|Page|Dialog))\b/;

export function extractComponentName(frames: ResolvedStackFrame[]): string | null {
  for (const f of frames) {
    if (f.isFramework) continue;
    const candidates = [f.functionName, f.rawFrame];
    for (const c of candidates) {
      if (!c) continue;
      const m = c.match(COMPONENT_NAME_RE);
      if (m) return m[1]!;
    }
  }
  return null;
}

export function classifyLeakKind(
  rawStack: string,
  frames: ResolvedStackFrame[],
  observableKind: string,
): LeakKind {
  // Two or more patchedSubscribe frames means a subscribe ran inside another
  // subscribe — the classic nested-subscribe anti-pattern.
  const patchedCount = (rawStack.match(/patchedSubscribe/g) ?? []).length;
  if (patchedCount >= 2) return 'nested-subscribe';

  // TypeScript's async/await downleveling wraps the body in __async / a
  // ZoneAwarePromise. If that wrapper appears between the subscribe and
  // ngOnInit, the subscribe happened after an await.
  const hasAsyncWrapper = /\b__async\b|\bZoneAwarePromise\b|\basync_/.test(rawStack);
  if (hasAsyncWrapper && /ngOnInit/.test(rawStack)) return 'async-init';

  const topUser = frames.find((f) => !f.isFramework);
  const topMarker = `${topUser?.functionName ?? ''} ${topUser?.rawFrame ?? ''}`;
  if (/\.ngOnInit\b/.test(topMarker)) return 'ng-init';

  if (/fromEvent|addEventListener/.test(rawStack)) return 'global-event';
  if (observableKind.includes('Subject')) return 'subject';
  if (/\binterval\b|\btimer\b/.test(rawStack) || observableKind === 'Observable') return 'timer';

  return 'unknown';
}

/**
 * The detector's patched `subscribe` is always the first frame of every
 * captured stack. Strip it (and any other detector-internal frames) before
 * showing the stack to a user.
 */
export function stripDetectorFrames(frames: ResolvedStackFrame[]): ResolvedStackFrame[] {
  return frames.filter(
    (f) => !/runtime\/patch/.test(f.file) && f.functionName !== 'patchedSubscribe',
  );
}
