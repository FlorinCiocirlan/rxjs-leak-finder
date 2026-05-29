// Mirrors the heuristic in dashboard/app.ts for URLs without source maps:
// pre-bundled deps, polyfills, runtime/zone bundles are framework code.
export const FRAMEWORK_URL_PATTERNS = [
  /\/vite\/deps\//,
  /\/polyfills[-.]/,
  /\/runtime[-.]/,
  /\/zone\.js/,
  /^webpack:/,
];

export function isFrameworkUrl(url: string): boolean {
  return FRAMEWORK_URL_PATTERNS.some(p => p.test(url));
}

const FRAME_REGEX = /at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;

/**
 * First stack-frame URL that is not a framework URL, scanning top-down.
 * Used page-side (no source maps) as a cheap "does this look like a user leak?"
 * signal. Returns null when every frame is framework code.
 */
export function topUserFrameUrl(stackRaw: string): string | null {
  for (const line of stackRaw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('at ')) continue;
    const m = trimmed.match(FRAME_REGEX);
    if (!m) continue;
    const url = m[2]!;
    if (isFrameworkUrl(url)) continue;
    return url;
  }
  return null;
}
